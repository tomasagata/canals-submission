import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum OutboxStatus {
  NEW = 'NEW',
  DISPATCHED = 'DISPATCHED',
  /** Exhausted its dispatch attempts. Requires operator attention. */
  FAILED = 'FAILED',
}

export const ORDER_CREATED_EVENT = 'ORDER_CREATED';

/**
 * The transactional outbox.
 *
 * An event here is written in the SAME database transaction as the order it
 * describes, which is the entire point: the order and the intent to process it
 * commit together or not at all. There is no window in which an order exists
 * that nothing will ever pick up, and no window in which we publish an intent
 * for an order that was rolled back.
 */
@Schema({ timestamps: true, collection: 'order_outbox' })
export class OutboxEvent {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  eventType: string;

  @Prop({ type: Types.ObjectId, required: true })
  aggregateId: Types.ObjectId;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({ type: String, enum: Object.values(OutboxStatus), required: true, default: OutboxStatus.NEW })
  status: OutboxStatus;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Date, required: true, default: () => new Date() })
  nextRetryAt: Date;

  /** Set when a relay claims this row; expires so a crashed relay can't strand it. */
  @Prop({ type: Date, required: false })
  claimedAt?: Date;

  @Prop({ type: Date, required: false })
  dispatchedAt?: Date;

  @Prop({ type: String, required: false })
  lastError?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

// The relay's only query - kept fully covered so polling stays cheap.
OutboxEventSchema.index({ status: 1, nextRetryAt: 1, claimedAt: 1 });
// One event per aggregate per type, which makes writing the event exactly as
// safe to retry as writing the order itself.
OutboxEventSchema.index({ aggregateId: 1, eventType: 1 }, { unique: true });

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;
