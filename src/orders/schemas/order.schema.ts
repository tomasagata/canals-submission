import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { PaymentResultDto } from "../../payment/dto/index.js";
import { ORDER_STATUSES, OrderStatus } from "../order-status.js";

@Schema({ _id: false })
export class OrderCoordinates {
    @Prop({ type: Number, required: true })
    latitude: number;

    @Prop({ type: Number, required: true })
    longitude: number;
}

export const OrderCoordinatesSchema = SchemaFactory.createForClass(OrderCoordinates);

@Schema({ _id: false })
export class OrderItem {
    @Prop({ type: Types.ObjectId, required: true })
    productId: Types.ObjectId;

    @Prop({ type: Number, required: true })
    quantity: number;

    // Price snapshot taken at accept time, in integer minor units. The saga
    // runs minutes later; without a snapshot a price change between accept and
    // charge would silently alter what the customer pays.
    @Prop({ type: Number, required: true })
    unitPrice: number;
}

export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true, collection: "orders" })
export class Order {
    _id: Types.ObjectId;

    // Deduplicates client retries. Enforced by a unique index (see below)
    // rather than an app-level check, because two concurrent requests can both
    // pass a read-then-write check; only the database can arbitrate.
    @Prop({ type: String, required: true })
    idempotencyKey: string;

    // sha256 over the canonicalised request body. Lets a replay of the SAME key
    // with a DIFFERENT body be rejected loudly (422) instead of silently
    // handing the caller an unrelated order.
    @Prop({ type: String, required: true })
    requestFingerprint: string;

    @Prop({ type: Types.ObjectId, required: true })
    customerId: Types.ObjectId;

    @Prop({ type: String, required: true })
    shippingAddress: string;

    // Frozen at accept time so the saga is deterministic on every replay and
    // never re-geocodes (which could resolve differently, or fail, later).
    @Prop({ type: OrderCoordinatesSchema, required: true })
    shippingCoordinates: OrderCoordinates;

    @Prop({ type: [OrderItemSchema], required: true })
    items: OrderItem[];

    /** Integer minor units (e.g. cents) - never a float. */
    @Prop({ type: Number, required: true })
    totalAmount: number;

    // Optional: at accept time no warehouse has been chosen yet. Warehouse
    // selection depends on stock levels at execution time, which is a
    // worker-side decision made minutes later. It is written by, and only by,
    // the PENDING -> STOCK_RESERVED transition, which makes its presence a
    // reliable marker that stock was actually taken.
    @Prop({ type: Types.ObjectId, required: false })
    warehouseId?: Types.ObjectId;

    @Prop({ type: String, enum: ORDER_STATUSES, required: true, default: OrderStatus.PENDING })
    status: OrderStatus;

    @Prop({ type: Object, required: false })
    paymentResult?: PaymentResultDto;

    @Prop({ type: String, required: false })
    errorMessage?: string;

    @Prop({ type: String, required: false })
    failureCode?: string;

    // Reconciliation claim. This is NOT the correctness mechanism - the CAS
    // transitions and the two movement ledgers are. It exists so N instances
    // don't all redundantly work (and re-query the PSP for) the same order
    // every sweep interval. It is a lease, not a lock: it expires so a crashed
    // holder cannot strand an order.
    @Prop({ type: Date, required: false })
    sweepLeaseUntil?: Date;

    @Prop({ type: Number, default: 0 })
    sweepAttempts: number;

    createdAt?: Date;
    updatedAt?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// The idempotency scope. In a system with authentication this would be keyed
// on the authenticated principal; customerId is the closest honest equivalent
// here. This index is what makes concurrent same-key requests safe.
OrderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
// Sweeper staleness scan. updatedAt rather than createdAt: an order that just
// advanced a step is progressing, not stranded.
OrderSchema.index({ status: 1, updatedAt: 1 });
// Sweeper claim scan: unclaimed or expired-lease orders in a given status.
OrderSchema.index({ status: 1, sweepLeaseUntil: 1 });
// Listing endpoint.
OrderSchema.index({ customerId: 1, createdAt: -1 });

export type OrderDocument = HydratedDocument<Order>;
