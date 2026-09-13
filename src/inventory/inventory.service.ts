import { Injectable } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Warehouse } from "./schemas/warehouses.schema.js";
import { Stock } from "./schemas/stock.schema.js";
import mongoose, { Model, Types } from "mongoose";
import { Coordinates } from "../geocoding/interfaces/index.js";
import { MovementKind, StockMovement } from "./schemas/stock-movement.schema.js";
import { InsufficientStockError, NoWarehouseAvailableError } from "./inventory.errors.js";
import { isDuplicateKeyError } from "../common/mongo.util.js";

export { InsufficientStockError, NoWarehouseAvailableError };

/** A quantity of a product to move. Ids are already ObjectIds - callers convert at the boundary. */
export interface ReservationItem {
    productId: Types.ObjectId;
    quantity: number;
}

export interface ReservationResult {
    warehouseId: Types.ObjectId;
    /** True when a prior delivery of this same order already reserved; no stock moved on this call. */
    replayed: boolean;
}

interface WarehouseWithStock extends Warehouse {
    _id: Types.ObjectId;
    stock: Pick<Stock, "productId" | "quantity">[];
}

@Injectable()
export class InventoryService {
    constructor(
        @InjectConnection() private readonly connection: mongoose.Connection,
        @InjectModel(Stock.name) private readonly stockModel: Model<Stock>,
        @InjectModel(Warehouse.name) private readonly warehouseModel: Model<Warehouse>,
        @InjectModel(StockMovement.name) private readonly movementModel: Model<StockMovement>,
    ) {}

    /**
     * Reserves stock for an order at the nearest warehouse that can fulfil it.
     *
     * `orderId` is the idempotency key: at most one RESERVE movement can ever
     * exist for it, enforced by a unique index. A redelivered job therefore
     * either finds the prior movement (fast path) or collides with the index
     * and aborts its transaction before changing any quantity. Stock can never
     * be decremented twice for one order, no matter how often this is called
     * or how many workers call it at once.
     */
    async reserveForOrder(
        orderId: Types.ObjectId,
        loc: Coordinates,
        items: ReservationItem[],
    ): Promise<ReservationResult> {
        // Fast path: a previous delivery of this job already reserved.
        const prior = await this.movementModel.findOne({ orderId, kind: MovementKind.RESERVE }).lean().exec();
        if (prior) {
            return { warehouseId: prior.warehouseId, replayed: true };
        }

        // Ranking happens OUTSIDE the transaction. $geoNear is not permitted
        // inside a multi-document transaction, and it does not need to be: this
        // is a read-only ordering hint. Every correctness guarantee lives in the
        // conditional decrement below, which refuses to apply if the stock it
        // was promised has moved in the meantime.
        const candidates = await this.findCandidateWarehouses(loc, items);

        for (const candidate of candidates) {
            const outcome = await this.tryReserveAt(orderId, candidate._id, items);
            if (outcome) return outcome;
            // This warehouse could not serve the order (stock moved under us, or
            // the pre-filter was stale). Try the next-nearest.
        }

        throw new NoWarehouseAvailableError();
    }

    /**
     * Returns reserved stock. The compensating action for a saga that failed
     * after reserving.
     *
     * Idempotent by the same mechanism as reserve: at most one RELEASE movement
     * per order. Calling this on an order that never reserved, or that has
     * already been released, is a no-op rather than an error - which is what
     * lets both the worker and the sweeper call it freely without coordinating.
     */
    async releaseForOrder(orderId: Types.ObjectId): Promise<"released" | "noop"> {
        const session = await this.connection.startSession();
        try {
            return await session.withTransaction(
                async (): Promise<"released" | "noop"> => {
                    const reserve = await this.movementModel
                        .findOne({ orderId, kind: MovementKind.RESERVE })
                        .session(session)
                        .exec();
                    if (!reserve) return "noop"; // nothing was ever taken

                    // Read-then-insert, deliberately. A duplicate-key error raised
                    // INSIDE an open transaction aborts it server-side, so it cannot
                    // be caught and recovered from here; a genuine concurrent release
                    // surfaces as an abort that the catch below handles.
                    const already = await this.movementModel
                        .findOne({ orderId, kind: MovementKind.RELEASE })
                        .session(session)
                        .exec();
                    if (already) return "noop"; // replay

                    await this.movementModel.create(
                        [
                            {
                                orderId,
                                kind: MovementKind.RELEASE,
                                warehouseId: reserve.warehouseId,
                                items: reserve.items,
                            },
                        ],
                        { session },
                    );

                    for (const item of reserve.items) {
                        await this.stockModel.updateOne(
                            { warehouseId: reserve.warehouseId, productId: item.productId },
                            { $inc: { quantity: item.quantity } },
                            { session },
                        );
                    }
                    return "released";
                },
                { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
            );
        } catch (error) {
            if (isDuplicateKeyError(error, "orderId")) {
                // A concurrent release won the race; its transaction did the work.
                return "noop";
            }
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * One atomic attempt at a specific warehouse. Returns null if this
     * warehouse cannot serve the order, so the caller can fall through to the
     * next candidate.
     */
    private async tryReserveAt(
        orderId: Types.ObjectId,
        warehouseId: Types.ObjectId,
        items: ReservationItem[],
    ): Promise<ReservationResult | null> {
        const session = await this.connection.startSession();
        try {
            const reserved = await session.withTransaction(
                async (): Promise<boolean> => {
                    // The ledger row goes FIRST: a replayed or concurrent reserve for
                    // this order collides with the unique index here and aborts before
                    // any quantity is touched.
                    await this.movementModel.create(
                        [{ orderId, kind: MovementKind.RESERVE, warehouseId, items }],
                        { session },
                    );

                    for (const item of items) {
                        // Conditional decrement: `quantity: { $gte }` is the oversell
                        // guard. If another transaction took these units between the
                        // ranking query and now, this matches nothing and we abort.
                        const result = await this.stockModel.updateOne(
                            { warehouseId, productId: item.productId, quantity: { $gte: item.quantity } },
                            { $inc: { quantity: -item.quantity } },
                            { session },
                        );
                        if (result.matchedCount !== 1) {
                            throw new InsufficientStockError(item.productId.toString());
                        }
                    }
                    return true;
                },
                { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
            );

            return reserved ? { warehouseId, replayed: false } : null;
        } catch (error) {
            if (isDuplicateKeyError(error, "orderId")) {
                // Another delivery of this same job committed first. Its transaction
                // did the work; ours aborted, so nothing was double-decremented.
                const won = await this.movementModel.findOne({ orderId, kind: MovementKind.RESERVE }).lean().exec();
                if (won) return { warehouseId: won.warehouseId, replayed: true };
            }
            if (error instanceof InsufficientStockError) {
                return null; // try the next warehouse
            }
            throw error; // infrastructure failure - let the queue retry the job
        } finally {
            await session.endSession();
        }
    }

    private async findCandidateWarehouses(loc: Coordinates, items: ReservationItem[]): Promise<WarehouseWithStock[]> {
        const productIds = items.map((item) => item.productId);
        const stockCollectionName = this.stockModel.collection.name;

        const candidates = await this.warehouseModel.aggregate<WarehouseWithStock>([
            {
                $geoNear: {
                    near: { type: "Point", coordinates: [loc.longitude, loc.latitude] },
                    distanceField: "distance",
                    spherical: true,
                },
            },
            {
                $lookup: {
                    from: stockCollectionName,
                    let: { warehouseId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$warehouseId", "$$warehouseId"] },
                                productId: { $in: productIds },
                            },
                        },
                    ],
                    as: "stock",
                },
            },
        ]);

        // A pre-filter only - the authoritative check is the conditional
        // decrement inside the transaction. Filtering here just avoids opening
        // transactions against warehouses that obviously cannot serve the order.
        return candidates.filter((candidate) => this.hasSufficientStock(candidate, items));
    }

    private hasSufficientStock(warehouse: WarehouseWithStock, items: ReservationItem[]): boolean {
        return items.every((item) =>
            warehouse.stock.some(
                (stock) => stock.productId.equals(item.productId) && stock.quantity >= item.quantity,
            ),
        );
    }
}
