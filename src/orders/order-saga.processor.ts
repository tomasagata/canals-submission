import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Types } from 'mongoose';
import { OrdersRepository } from './orders.repository.js';
import { OrderSagaJobData, ORDER_SAGA_QUEUE } from './queue/order-queue.constants.js';
import { FailureCode, OrderStatus, isTerminal } from './order-status.js';
import { OrderDocument } from './schemas/order.schema.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { InsufficientStockError, NoWarehouseAvailableError } from '../inventory/inventory.errors.js';
import { PaymentService } from '../payment/payment.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { getErrorMessage } from '../common/mongo.util.js';

/**
 * Drives an accepted order through the saga:
 *
 *   reserve stock  ->  authorize payment  ->  complete
 *
 * The order's own id is passed as the idempotency key to BOTH the warehouse
 * and the payment provider, which is what makes a redelivered job safe: each
 * downstream step recognises the repeat and returns its original outcome
 * instead of performing the action again.
 */
@Processor(ORDER_SAGA_QUEUE)
export class OrderSagaProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderSagaProcessor.name);

  constructor(
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryService,
    private readonly payment: PaymentService,
    private readonly customers: CustomersService,
  ) {
    super();
  }

  async process(job: Job<OrderSagaJobData>): Promise<void> {
    const orderId = new Types.ObjectId(job.data.orderId);

    // Drive the order as far as it will go in this one delivery, re-reading
    // between every step. Re-reading is not an optimisation: the reconciliation
    // sweeper (or another delivery) may have advanced or terminated this order
    // while we were mid-step, and acting on a stale status is exactly the class
    // of bug this design exists to prevent.
    for (;;) {
      const order = await this.orders.findById(orderId);
      if (!order) {
        this.logger.warn(`Order ${job.data.orderId} no longer exists; dropping job.`);
        return;
      }

      if (isTerminal(order.status)) {
        // FAILED specifically means "finished with nothing reserved". If a
        // reservation nonetheless exists, this order was timed out by the
        // sweeper in the instant after our reserve committed, and those units
        // would otherwise be stranded - so hand them back. Release is
        // idempotent and a no-op when nothing was reserved.
        //
        // COMPLETED and COMPENSATED must NOT be touched: the former has
        // legitimately consumed its stock, and the latter has already returned
        // it. Releasing here would be a double-credit in one case and a
        // spontaneous refund of inventory in the other.
        if (order.status === OrderStatus.FAILED) {
          await this.inventory.releaseForOrder(orderId);
        }
        return;
      }

      switch (order.status) {
        case OrderStatus.PENDING:
          await this.reserve(order);
          break;
        case OrderStatus.STOCK_RESERVED:
          await this.authorize(order);
          break;
        case OrderStatus.PAYMENT_AUTHORIZED:
          await this.complete(order);
          break;
        case OrderStatus.COMPENSATING:
          await this.compensate(order);
          return;
        default:
          return;
      }
    }
  }

  private async reserve(order: OrderDocument): Promise<void> {
    try {
      const { warehouseId, replayed } = await this.inventory.reserveForOrder(
        order._id, // our order id IS the warehouse's idempotency key
        order.shippingCoordinates,
        order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      );
      if (replayed) {
        this.logger.debug(`Order ${order._id.toString()} was already reserved; continuing from the ledger.`);
      }
      // If this CAS matches nothing, the sweeper terminated the order while we
      // were reserving. The loop re-reads, sees a terminal status, and releases.
      await this.orders.transition(order._id, OrderStatus.PENDING, OrderStatus.STOCK_RESERVED, { warehouseId });
    } catch (error) {
      if (error instanceof NoWarehouseAvailableError || error instanceof InsufficientStockError) {
        // A business failure: retrying will not create stock, and nothing was
        // reserved, so there is nothing to compensate.
        await this.orders.transition(order._id, OrderStatus.PENDING, OrderStatus.FAILED, {
          failureCode: FailureCode.OUT_OF_STOCK,
          errorMessage: error.message,
        });
        return;
      }
      throw error; // infrastructure failure - let the queue retry with backoff
    }
  }

  private async authorize(order: OrderDocument): Promise<void> {
    const customer = await this.customers.getCustomerById(order.customerId.toString());
    if (!customer) {
      // The customer disappeared between accept and processing. Nothing can be
      // charged, so unwind the reservation.
      await this.orders.transition(order._id, OrderStatus.STOCK_RESERVED, OrderStatus.COMPENSATING, {
        failureCode: FailureCode.PAYMENT_DECLINED,
        errorMessage: `Customer ${order.customerId.toString()} no longer exists.`,
      });
      return;
    }

    const result = await this.payment.authorize({
      idempotencyKey: order._id.toString(), // our order id IS the PSP's idempotency key
      creditCard: customer.creditCard,
      amount: order.totalAmount,
      description: `ORDER ${order._id.toString()}`,
    });

    if (result.success) {
      await this.orders.transition(order._id, OrderStatus.STOCK_RESERVED, OrderStatus.PAYMENT_AUTHORIZED, {
        paymentResult: result,
      });
      return;
    }

    await this.orders.transition(order._id, OrderStatus.STOCK_RESERVED, OrderStatus.COMPENSATING, {
      failureCode: FailureCode.PAYMENT_DECLINED,
      errorMessage: result.errorMessage ?? 'Payment declined.',
      paymentResult: result,
    });
  }

  private async complete(order: OrderDocument): Promise<void> {
    await this.orders.transition(order._id, OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.COMPLETED);
  }

  private async compensate(order: OrderDocument): Promise<void> {
    await this.inventory.releaseForOrder(order._id); // idempotent
    await this.orders.transition(order._id, OrderStatus.COMPENSATING, OrderStatus.COMPENSATED);
  }

  /**
   * Note what this does NOT do: it does not fail or compensate the order.
   *
   * A job that has exhausted its retries has failed repeatedly against a
   * backend we evidently cannot reach - which makes this worker the component
   * least qualified to decide the order's final outcome. The order is left in a
   * non-terminal state on purpose, for the reconciliation sweeper to resolve
   * against the payment provider's actual record.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OrderSagaJobData>, error: Error): void {
    this.logger.error(
      `Saga job for order ${job?.data?.orderId} failed on attempt ${job?.attemptsMade}: ${getErrorMessage(error)}`,
    );
  }
}
