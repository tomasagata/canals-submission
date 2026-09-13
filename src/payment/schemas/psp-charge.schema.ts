import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum ChargeStatus {
  SUCCEEDED = 'SUCCEEDED',
  DECLINED = 'DECLINED',
}

/**
 * The mock PSP's own ledger. This models storage that belongs to the *external*
 * payment provider, not to us: it is written and read only by PaymentService,
 * and never participates in an order transaction - joining it transactionally
 * would model something that cannot exist across a network boundary.
 *
 * It is persisted rather than held in memory because the scenario worth
 * demonstrating is "the worker charged the card and then died". An in-memory
 * ledger dies with the process, which would make the reconciliation sweeper's
 * PSP lookup untestable.
 */
@Schema({ timestamps: true, collection: 'psp_charges' })
export class PspCharge {
  _id: Types.ObjectId;

  /** The caller's idempotency key. Our saga always passes the internal orderId. */
  @Prop({ type: String, required: true })
  idempotencyKey: string;

  @Prop({ type: String, required: true })
  transactionId: string;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: String, enum: Object.values(ChargeStatus), required: true })
  status: ChargeStatus;

  @Prop({ type: String, required: false })
  errorMessage?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PspChargeSchema = SchemaFactory.createForClass(PspCharge);

// One charge per idempotency key. This is what makes a retried authorize()
// return the original outcome instead of charging the card a second time.
PspChargeSchema.index({ idempotencyKey: 1 }, { unique: true });

export type PspChargeDocument = HydratedDocument<PspCharge>;
