import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema.js';
import { OrderStatus } from './order-status.js';
import { PaymentResultDto } from '../payment/dto/index.js';

/** Fields a transition is allowed to write alongside the status change. */
export interface TransitionPatch {
  warehouseId?: Types.ObjectId;
  paymentResult?: PaymentResultDto;
  errorMessage?: string;
  failureCode?: string;
}

export interface ListOrdersFilter {
  customerId?: string;
  status?: OrderStatus;
  page: number;
  limit: number;
}

@Injectable()
export class OrdersRepository {
  constructor(@InjectModel(Order.name) private readonly model: Model<Order>) {}

  findById(orderId: Types.ObjectId): Promise<OrderDocument | null> {
    return this.model.findById(orderId).exec();
  }

  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<OrderDocument | null> {
    return this.model.findOne({ customerId: new Types.ObjectId(customerId), idempotencyKey }).exec();
  }

  async list(filter: ListOrdersFilter): Promise<{ items: OrderDocument[]; total: number }> {
    const query: QueryFilter<Order> = {};
    if (filter.customerId) query.customerId = new Types.ObjectId(filter.customerId);
    if (filter.status) query.status = filter.status;

    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /**
   * The one transition primitive, shared by the saga worker and the sweeper.
   *
   * This is a compare-and-swap: the update only applies if the order is still
   * in `from`. A null return is not an error - it means another actor (the
   * other of those two, or a concurrent redelivery) already advanced this
   * order, and therefore owns finishing it. Callers must treat null as "do
   * nothing further", which is what makes it safe for several processes to
   * work the same order at once without coordination.
   *
   * Keeping this in one place matters: three callers must have byte-identical
   * CAS semantics, and a single one of them doing a bare update would reopen
   * every race this design closes.
   */
  async transition(
    orderId: Types.ObjectId,
    from: OrderStatus,
    to: OrderStatus,
    patch: TransitionPatch = {},
  ): Promise<OrderDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: orderId, status: from },
        {
          $set: { status: to, ...patch },
          // A terminal order will never be swept again; clear the claim so it
          // doesn't linger and confuse operators reading the collection.
          $unset: { sweepLeaseUntil: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Atomically claims one stale order in `status` for reconciliation.
   *
   * A single findOneAndUpdate, so exactly one instance wins each order per
   * lease window even with every instance sweeping simultaneously. Correctness
   * does not depend on this (the CAS transitions and the movement ledgers
   * provide that); it exists to stop N instances redundantly hammering the PSP
   * for the same order.
   */
  async claimStale(status: OrderStatus, staleAfterMs: number, leaseMs: number): Promise<OrderDocument | null> {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        {
          status,
          updatedAt: { $lte: new Date(now.getTime() - staleAfterMs) },
          $or: [{ sweepLeaseUntil: { $exists: false } }, { sweepLeaseUntil: { $lte: now } }],
        },
        {
          $set: { sweepLeaseUntil: new Date(now.getTime() + leaseMs) },
          $inc: { sweepAttempts: 1 },
        },
        // timestamps:false deliberately. Taking a claim is not progress on the
        // order, and letting it bump updatedAt would mean a failed sweep had to
        // wait a full staleAfterMs (minutes) to be retried instead of a lease
        // (seconds). It also keeps updatedAt meaning "last real state change",
        // which is what the staleness scan is asking about.
        { sort: { updatedAt: 1 }, returnDocument: 'after', timestamps: false },
      )
      .exec();
  }
}
