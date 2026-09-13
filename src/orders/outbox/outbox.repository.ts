import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ORDER_CREATED_EVENT, OutboxEvent, OutboxEventDocument, OutboxStatus } from './outbox-event.schema.js';

@Injectable()
export class OutboxRepository {
  constructor(@InjectModel(OutboxEvent.name) private readonly model: Model<OutboxEvent>) {}

  /**
   * Writes the ORDER_CREATED event. Always called with the session of the
   * transaction that inserts the order, so the two commit atomically.
   */
  async createOrderCreatedEvent(orderId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.model.create(
      [
        {
          eventType: ORDER_CREATED_EVENT,
          aggregateId: orderId,
          payload: { orderId: orderId.toString() },
          status: OutboxStatus.NEW,
          nextRetryAt: new Date(),
        },
      ],
      { session },
    );
  }

  /**
   * Atomically claims the next dispatchable event.
   *
   * One findOneAndUpdate means exactly one relay instance can win a given row,
   * with no lock and no coordination between instances. The claim is a lease
   * (`claimedAt` + claimTimeoutMs), so a relay that dies mid-dispatch releases
   * the row by expiry rather than stranding it forever.
   *
   * `attempts` increments on claim, not on failure: a process that crashes
   * after claiming still burns an attempt, so a row that reliably kills its
   * handler eventually reaches maxAttempts instead of looping forever.
   */
  async claimNext(claimTimeoutMs: number): Promise<OutboxEventDocument | null> {
    const now = new Date();
    const staleClaim = new Date(now.getTime() - claimTimeoutMs);
    return this.model
      .findOneAndUpdate(
        {
          status: OutboxStatus.NEW,
          nextRetryAt: { $lte: now },
          $or: [{ claimedAt: { $exists: false } }, { claimedAt: { $lte: staleClaim } }],
        },
        { $set: { claimedAt: now }, $inc: { attempts: 1 } },
        { sort: { nextRetryAt: 1 }, new: true },
      )
      .exec();
  }

  async markDispatched(id: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $set: { status: OutboxStatus.DISPATCHED, dispatchedAt: new Date() } })
      .exec();
  }

  /** Returns the row to NEW with a backoff, for another pass to pick up. */
  async markRetry(id: Types.ObjectId, error: string, backoffMs: number): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        {
          $set: { status: OutboxStatus.NEW, lastError: error, nextRetryAt: new Date(Date.now() + backoffMs) },
          $unset: { claimedAt: 1 },
        },
      )
      .exec();
  }

  /** Terminal dispatch failure. An alertable condition: no worker will ever see this event. */
  async markDead(id: Types.ObjectId, error: string): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $set: { status: OutboxStatus.FAILED, lastError: error }, $unset: { claimedAt: 1 } })
      .exec();
  }

  /**
   * Re-arms a dead or dispatched event so the saga can be re-driven. Used by
   * the reconciliation sweeper when it finds an order whose event never made
   * it to a worker.
   */
  async requeueForAggregate(aggregateId: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne(
        { aggregateId, eventType: ORDER_CREATED_EVENT },
        { $set: { status: OutboxStatus.NEW, nextRetryAt: new Date() }, $unset: { claimedAt: 1 } },
      )
      .exec();
  }
}
