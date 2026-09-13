import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { CreateOrderDto, ListOrdersQueryDto, OrderResponseDto, PaginatedOrdersDto } from './dto/index.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { GeocodingService } from '../geocoding/geocoding.service.js';
import { Product } from '../inventory/schemas/product.schema.js';
import { Order, OrderDocument } from './schemas/order.schema.js';
import { OrderStatus } from './order-status.js';
import { OrdersRepository } from './orders.repository.js';
import { OutboxRepository } from './outbox/outbox.repository.js';
import { isDuplicateKeyError, getErrorMessage } from '../common/mongo.util.js';
import {
  ConcurrentRequestError,
  IdempotencyKeyReuseError,
  OrderNotFoundError,
  UnprocessableOrderError,
} from '../common/errors/domain.errors.js';

/**
 * Canonicalises the request so that two logically identical bodies hash the
 * same regardless of key order or item order, and two different bodies never
 * do. Used to detect an Idempotency-Key replayed with different content.
 */
function fingerprintRequest(dto: CreateOrderDto): string {
  const canonical = JSON.stringify({
    customerId: dto.customerId,
    shippingAddress: dto.shippingAddress.trim(),
    items: [...dto.items]
      .map((item) => ({ productId: item.productId, quantity: item.quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Prices in integer minor units, so no float arithmetic ever touches money. */
function toMinorUnits(price: number): number {
  return Math.round(price * 100);
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    private readonly orders: OrdersRepository,
    private readonly outbox: OutboxRepository,
    private readonly customersService: CustomersService,
    private readonly inventoryService: InventoryService,
    private readonly geocodingService: GeocodingService,
  ) {}

  /**
   * Accepts an order for processing. This is the entire write path: it does
   * not reserve stock and does not talk to the payment provider.
   *
   * Two writes happen in ONE transaction - the order itself, and an outbox
   * event announcing it. Because they commit together, it is impossible to end
   * up with an order nothing will ever process, or with a dispatched event for
   * an order that was rolled back. Once this returns, the order is guaranteed
   * to be driven to a terminal state eventually, by the worker or by the
   * reconciliation sweeper.
   */
  async acceptOrder(dto: CreateOrderDto, idempotencyKey: string): Promise<OrderResponseDto> {
    const fingerprint = fingerprintRequest(dto);

    // Fast path: an obvious replay should not open a transaction at all.
    const existing = await this.orders.findByIdempotencyKey(dto.customerId, idempotencyKey);
    if (existing) {
      return this.resolveReplay(existing, fingerprint);
    }

    // Reads only, with no side effects - so if we lose the insert race below,
    // redoing this work costs nothing and changes nothing.
    const customer = await this.customersService.getCustomerById(dto.customerId);
    if (!customer) {
      throw new UnprocessableOrderError('CUSTOMER_NOT_FOUND', `Customer ${dto.customerId} not found.`);
    }

    const products = await this.loadProducts(dto);
    const coordinates = await this.resolveCoordinates(dto.shippingAddress);
    const { items, totalAmount } = this.priceOrder(dto, products);

    const orderId = new Types.ObjectId();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(
        async () => {
          await this.orderModel.create(
            [
              {
                _id: orderId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                customerId: new Types.ObjectId(dto.customerId),
                shippingAddress: dto.shippingAddress,
                shippingCoordinates: coordinates,
                items,
                totalAmount,
                status: OrderStatus.PENDING,
              },
            ],
            { session },
          );

          // The transactional outbox. Same session, same transaction: the
          // order and the intent to process it are one atomic fact.
          await this.outbox.createOrderCreatedEvent(orderId, session);
        },
        { writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      // A concurrent request used the same key and committed first. Our
      // transaction aborted, so this request created nothing at all - no order,
      // no event, no stock moved, no money touched. Return the winner's order.
      //
      // The field check matters: a duplicate on the outbox index would mean
      // something quite different (an aggregate with two ORDER_CREATED events)
      // and must not be quietly reinterpreted as "someone else won".
      if (!isDuplicateKeyError(error, 'idempotencyKey')) throw error;

      const winner = await this.awaitWinner(dto.customerId, idempotencyKey);
      return this.resolveReplay(winner, fingerprint);
    } finally {
      await session.endSession();
    }

    const created = await this.orders.findById(orderId);
    if (!created) {
      // Would mean the transaction reported success but the document is absent.
      throw new Error(`Order ${orderId.toString()} vanished immediately after being committed.`);
    }
    this.logger.log(`Accepted order ${orderId.toString()} (key=${idempotencyKey}).`);
    return OrderResponseDto.from(created);
  }

  async getOrder(orderId: Types.ObjectId): Promise<OrderResponseDto> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId.toString());
    return OrderResponseDto.from(order);
  }

  async listOrders(query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    const { items, total } = await this.orders.list({
      customerId: query.customerId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: items.map((order) => OrderResponseDto.from(order)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * A replay returns the existing order unchanged - in whatever state it has
   * reached - so a retry is indistinguishable from the original request. The
   * one exception is a key reused for different content, which is a client bug
   * we refuse loudly rather than answering with somebody else's order.
   */
  /**
   * Waits briefly for the request that beat us to become visible.
   *
   * There is a real gap between the two events here: a unique index rejects a
   * duplicate as soon as the winning transaction *holds* the key, which is
   * before that transaction *commits*. So a naive read straight after catching
   * E11000 can legitimately find nothing, even though the winner is about to
   * appear. Reading immediately and giving up would turn the most common
   * concurrency case - a client firing simultaneous retries - into a 500.
   *
   * A short bounded wait covers the commit window. If the order still isn't
   * there afterwards the winner most likely aborted, so we tell the caller to
   * retry rather than inventing an outcome.
   */
  private async awaitWinner(customerId: string, idempotencyKey: string): Promise<OrderDocument> {
    let delayMs = 20;
    for (let attempt = 0; attempt < 5; attempt++) {
      const winner = await this.orders.findByIdempotencyKey(customerId, idempotencyKey);
      if (winner) return winner;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
    this.logger.warn(
      `Idempotency key '${idempotencyKey}' collided for customer ${customerId}, ` +
        `but the winning order never became visible. The winning transaction probably aborted.`,
    );
    throw new ConcurrentRequestError();
  }

  private resolveReplay(order: OrderDocument, fingerprint: string): OrderResponseDto {
    if (order.requestFingerprint !== fingerprint) {
      throw new IdempotencyKeyReuseError(order._id.toString());
    }
    return OrderResponseDto.from(order);
  }

  private async loadProducts(dto: CreateOrderDto): Promise<Product[]> {
    try {
      return await this.inventoryService.getProductsById(dto.items.map((item) => new Types.ObjectId(item.productId)));
    } catch (error) {
      throw new UnprocessableOrderError('PRODUCT_NOT_FOUND', getErrorMessage(error));
    }
  }

  private async resolveCoordinates(address: string) {
    try {
      return await this.geocodingService.getCoordinates(address);
    } catch {
      throw new UnprocessableOrderError(
        'ADDRESS_NOT_GEOCODABLE',
        `Could not resolve coordinates for shipping address '${address}'.`,
      );
    }
  }

  /**
   * Snapshots unit prices onto the order. The saga charges minutes later; the
   * customer must be charged the price they were quoted, not whatever the
   * catalogue says by then.
   */
  private priceOrder(dto: CreateOrderDto, products: Product[]) {
    const items = dto.items.map((item) => {
      const product = products.find((p: Product) => p._id.equals(item.productId));
      if (!product) {
        throw new UnprocessableOrderError('PRODUCT_NOT_FOUND', `Product ${item.productId} not found.`);
      }
      return {
        productId: new Types.ObjectId(item.productId),
        quantity: item.quantity,
        unitPrice: toMinorUnits(product.price),
      };
    });
    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return { items, totalAmount };
  }
}
