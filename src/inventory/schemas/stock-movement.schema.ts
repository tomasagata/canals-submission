import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum MovementKind {
  RESERVE = 'RESERVE',
  RELEASE = 'RELEASE',
}

@Schema({ _id: false })
export class MovementItem {
  @Prop({ type: Types.ObjectId, required: true })
  productId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  quantity: number;
}

export const MovementItemSchema = SchemaFactory.createForClass(MovementItem);

/**
 * The reservation ledger - the mechanism that makes the saga worker safe under
 * at-least-once delivery.
 *
 * A queue redelivers; `$inc` is not idempotent; therefore the *decision* to
 * move stock is recorded as a uniquely-indexed document written inside the
 * same transaction as the `$inc` itself. A replayed job attempting the same
 * movement collides with the unique index, which aborts its transaction before
 * any quantity changes. The stock and the ledger can therefore never disagree.
 *
 * It is also the audit trail: every quantity change in the system has exactly
 * one row here explaining which order caused it.
 */
@Schema({ timestamps: true, collection: 'stock_movements' })
export class StockMovement {
  _id: Types.ObjectId;

  /** Our internal order id - the idempotency key for the warehouse side of the saga. */
  @Prop({ type: Types.ObjectId, required: true })
  orderId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(MovementKind), required: true })
  kind: MovementKind;

  @Prop({ type: Types.ObjectId, required: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: [MovementItemSchema], required: true })
  items: MovementItem[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);

// At most ONE reserve and ONE release per order, ever. This single index is
// what turns a redelivered job from a double-decrement into a no-op.
StockMovementSchema.index({ orderId: 1, kind: 1 }, { unique: true });

export type StockMovementDocument = HydratedDocument<StockMovement>;
