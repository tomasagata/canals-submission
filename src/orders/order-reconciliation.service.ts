import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';
import { OrdersRepository } from './orders.repository.js';
import { FailureCode, OrderStatus } from './order-status.js';
import { OrderDocument } from './schemas/order.schema.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentService } from '../payment/payment.service.js';
import { ordersConfig } from '../config/orders.config.js';
import { getErrorMessage } from '../common/mongo.util.js';

export interface ReconciliationResult {
  markedFailed: number;
  authorized: number;
  completed: number;
  compensated: number;
  errors: number;
}

/**
 * Active reconciliation.
 *
 * A saga worker can die at any point, a queue can lose a job, and a payment
 * call can succeed while its response is lost. Nothing in the happy path
 * detects those; this does. It scans for orders sitting in a non-terminal state
 * longer than they should and drives each to a terminal one - crucially, by
 * asking the payment provider what actually happened rather than assuming.
 *
 * Safe on every instance simultaneously. Each order is claimed with a single
 * atomic findOneAndUpdate, and every state change is a CAS on the exact
 * expected prior status, so a sweeper racing the worker on the same order
 * yields one winner and one no-op. Even if a claim were bypassed entirely
 * (clock skew, a lease expiring mid-work), the reserve/release/charge ledgers
 * make the duplicated work a no-op. The claim is rate limiting and defence in
 * depth; it is not the correctness boundary.
 */
@Injectable()
export class OrderReconciliationService {
  private readonly logger = new Logger(OrderReconciliationService.name);

  constructor(
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryService,
    private readonly payment: PaymentService,
    @Inject(ordersConfig.KEY) private readonly config: ConfigType<typeof ordersConfig>,
  ) {}

  /**
   * The schedule is fixed rather than configurable because @Cron's arguments
   * are evaluated at class-definition time, before any config exists. The
   * tunables that actually matter - staleness, lease, batch size - are in
   * config. (SchedulerRegistry would allow a dynamic schedule, at the cost of
   * hand-rolled lifecycle code that buys nothing here.)
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'order-reconciliation' })
  async sweep(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = { markedFailed: 0, authorized: 0, completed: 0, compensated: 0, errors: 0 };
    if (!this.config.sweeper.enabled) return result;

    await this.sweepState(OrderStatus.PENDING, (order) => this.resolvePending(order, result), result);
    await this.sweepState(OrderStatus.STOCK_RESERVED, (order) => this.resolveReserved(order, result), result);
    await this.sweepState(OrderStatus.PAYMENT_AUTHORIZED, (order) => this.resolveAuthorized(order, result), result);
    await this.sweepState(OrderStatus.COMPENSATING, (order) => this.resolveCompensating(order, result), result);

    if (result.markedFailed || result.authorized || result.completed || result.compensated || result.errors) {
      this.logger.log(
        `Reconciliation sweep: markedFailed=${result.markedFailed} authorized=${result.authorized} ` +
          `completed=${result.completed} compensated=${result.compensated} errors=${result.errors}`,
      );
    }
    return result;
  }

  private async sweepState(
    status: OrderStatus,
    handler: (order: OrderDocument) => Promise<void>,
    result: ReconciliationResult,
  ): Promise<void> {
    for (let i = 0; i < this.config.sweeper.batchSize; i++) {
      const order = await this.orders.claimStale(
        status,
        this.config.sweeper.staleAfterMs,
        this.config.sweeper.leaseMs,
      );
      if (!order) return; // nothing left stale in this state

      try {
        await handler(order);
      } catch (error) {
        // The lease simply expires and a later pass retries. Nothing is left in
        // an inconsistent state, because every action taken by the handlers is
        // individually idempotent.
        result.errors++;
        this.logger.error(
          `Failed to reconcile order ${order._id.toString()} in state ${status}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * PENDING means nothing was reserved and nothing was charged, so this is the
   * cheapest state to resolve: fail it.
   *
   * Trade-off worth being explicit about: an order is failed here purely
   * because it aged out, which means a worker outage or queue backlog lasting
   * longer than staleAfterMs will fail orders that nothing was actually wrong
   * with. staleAfterMs must therefore stay comfortably above the worker's whole
   * retry budget (ORDER_SAGA_ATTEMPTS x exponential ORDER_SAGA_BACKOFF_MS).
   * Failing closed is the safe direction here - the customer can retry, and
   * nothing has been reserved or charged to unwind.
   */
  private async resolvePending(order: OrderDocument, result: ReconciliationResult): Promise<void> {
    const failed = await this.orders.transition(order._id, OrderStatus.PENDING, OrderStatus.FAILED, {
      failureCode: FailureCode.RECONCILED_TIMEOUT,
      errorMessage:
        'Reconciliation: the order was still pending past the processing deadline and was never reserved or charged.',
    });
    if (!failed) return; // the worker got to it first; it owns the outcome

    // Defensive, and not merely belt-and-braces: a worker's reservation can
    // commit microseconds before the CAS above lands. Release is a no-op when
    // no reservation exists, and closes that window when one does.
    const released = await this.inventory.releaseForOrder(order._id);
    if (released === 'released') {
      this.logger.warn(
        `Order ${order._id.toString()} was timed out while a reservation was in flight; the stock was returned.`,
      );
    }
    result.markedFailed++;
  }

  /**
   * STOCK_RESERVED is the state that justifies this whole service. The worker
   * may have charged the card and died before recording it, so we ask the
   * provider what really happened instead of guessing.
   */
  private async resolveReserved(order: OrderDocument, result: ReconciliationResult): Promise<void> {
    const charge = await this.payment.getByIdempotencyKey(order._id.toString());

    if (charge?.success) {
      // The money moved. Recording it here is the difference between a customer
      // who is charged and served, and one who is charged and restocked.
      const advanced = await this.orders.transition(
        order._id,
        OrderStatus.STOCK_RESERVED,
        OrderStatus.PAYMENT_AUTHORIZED,
        { paymentResult: charge },
      );
      if (advanced) {
        this.logger.warn(
          `Order ${order._id.toString()} was charged (${charge.transactionId}) but never recorded as authorized; ` +
            `reconciled forward.`,
        );
        result.authorized++;
        // Settle it immediately rather than waiting a whole sweep interval.
        if (await this.orders.transition(order._id, OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.COMPLETED)) {
          result.completed++;
        }
      }
      return;
    }

    // Either the provider declined, or it has no record of this order at all -
    // meaning the charge was never made. Both outcomes owe the stock back.
    const compensating = await this.orders.transition(
      order._id,
      OrderStatus.STOCK_RESERVED,
      OrderStatus.COMPENSATING,
      {
        failureCode: charge ? FailureCode.PAYMENT_DECLINED : FailureCode.RECONCILED_NO_CHARGE,
        errorMessage: charge
          ? (charge.errorMessage ?? 'Payment was declined.')
          : 'Reconciliation: no charge was ever recorded for this order past the processing deadline.',
        ...(charge ? { paymentResult: charge } : {}),
      },
    );
    if (!compensating) return;

    await this.releaseAndSettle(order, result);
  }

  /** Money taken and stock reserved: there is nothing left to decide. */
  private async resolveAuthorized(order: OrderDocument, result: ReconciliationResult): Promise<void> {
    if (await this.orders.transition(order._id, OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.COMPLETED)) {
      result.completed++;
    }
  }

  /** A release was owed and something interrupted it. Releasing again is a no-op. */
  private async resolveCompensating(order: OrderDocument, result: ReconciliationResult): Promise<void> {
    await this.releaseAndSettle(order, result);
  }

  private async releaseAndSettle(order: OrderDocument, result: ReconciliationResult): Promise<void> {
    await this.inventory.releaseForOrder(order._id);
    if (await this.orders.transition(order._id, OrderStatus.COMPENSATING, OrderStatus.COMPENSATED)) {
      result.compensated++;
    }
  }
}
