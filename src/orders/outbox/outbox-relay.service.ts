import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Types } from 'mongoose';
import type { ConfigType } from '@nestjs/config';
import { OutboxRepository } from './outbox.repository.js';
import { ORDER_SAGA_JOB, ORDER_SAGA_QUEUE, OrderSagaJobData } from '../queue/order-queue.constants.js';
import { ordersConfig } from '../../config/orders.config.js';
import { queueConfig } from '../../config/queue.config.js';
import { getErrorMessage } from '../../common/mongo.util.js';

/**
 * Moves committed outbox events onto the queue.
 *
 * Polling rather than a change stream, deliberately: the relay must retry
 * failed dispatches with backoff and must pick up anything written while it was
 * down. A change stream provides neither - it would need a persisted resume
 * token and *still* need a polling fallback for the window where that token
 * ages out of the oplog. That is two mechanisms to do one job, and a change
 * stream needs a replica set anyway, so it buys no deployment simplification.
 *
 * Safe to run on every instance: claims are atomic, so each event is dispatched
 * by exactly one relay per lease window.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;

  constructor(
    private readonly outbox: OutboxRepository,
    @InjectQueue(ORDER_SAGA_QUEUE) private readonly queue: Queue<OrderSagaJobData>,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(ordersConfig.KEY) private readonly config: ConfigType<typeof ordersConfig>,
    @Inject(queueConfig.KEY) private readonly queueSettings: ConfigType<typeof queueConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.config.outbox.enabled) {
      this.logger.warn('Outbox relay is disabled; orders will not be dispatched automatically.');
      return;
    }
    // Registered programmatically rather than with @Interval so the period is
    // configurable - decorator arguments are fixed at class-definition time.
    const interval = setInterval(() => void this.tick(), this.config.outbox.pollIntervalMs);
    this.schedulerRegistry.addInterval('outbox-relay', interval);
  }

  /**
   * One polling pass. Re-entrancy is guarded so a slow pass cannot overlap
   * itself; overlapping passes would still be *correct* (claims are atomic),
   * just wasteful.
   */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let dispatched = 0;
    try {
      for (let i = 0; i < this.config.outbox.batchSize; i++) {
        const event = await this.outbox.claimNext(this.config.outbox.claimTimeoutMs);
        if (!event) break;
        if (await this.dispatch(event._id, event.aggregateId.toString(), event.attempts)) {
          dispatched++;
        }
      }
    } catch (error) {
      this.logger.error(`Outbox relay pass failed: ${getErrorMessage(error)}`);
    } finally {
      this.running = false;
    }
    return dispatched;
  }

  private async dispatch(eventId: Types.ObjectId, orderId: string, attempts: number): Promise<boolean> {
    try {
      await this.queue.add(
        ORDER_SAGA_JOB,
        { orderId, outboxId: eventId.toString() },
        {
          // Deduplicates the common case only. NOT a correctness mechanism:
          // removeOnComplete eventually frees the id, so the same job id can be
          // added again. Correctness comes from the saga's terminal-status
          // check and the reserve/charge ledgers.
          jobId: orderId,
          attempts: this.queueSettings.attempts,
          backoff: { type: 'exponential', delay: this.queueSettings.backoffMs },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 24 * 3600 },
        },
      );
      await this.outbox.markDispatched(eventId);
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      if (attempts >= this.config.outbox.maxAttempts) {
        this.logger.error(
          `Outbox event ${eventId.toString()} for order ${orderId} exhausted ${attempts} dispatch attempts ` +
            `and will not be retried. This order will be resolved by reconciliation. Last error: ${message}`,
        );
        await this.outbox.markDead(eventId, message);
        return false;
      }
      // Exponential backoff on the row itself, so a broker outage doesn't turn
      // into a hot loop against Redis.
      const backoff = this.queueSettings.backoffMs * 2 ** Math.max(0, attempts - 1);
      this.logger.warn(`Failed to dispatch outbox event ${eventId.toString()} (attempt ${attempts}): ${message}`);
      await this.outbox.markRetry(eventId, message, backoff);
      return false;
    }
  }
}
