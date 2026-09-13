import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum CreditCardStatus {
  APPROVE = 'APPROVE',
  DECLINE = 'DECLINE',
}

/**
 * Pins a specific card number to a deterministic PSP outcome, overriding the
 * mock PSP's random `failureRate` for that card only. Lets a caller set up a
 * "this card always declines" scenario without touching the global fault
 * -injection knobs, which affect every card.
 */
@Schema({ collection: 'mock_credit_cards' })
export class MockCreditCard {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  cardNumber: string;

  @Prop({ type: String, enum: Object.values(CreditCardStatus), required: true })
  status: CreditCardStatus;

  @Prop({ type: String, required: false })
  declineReason?: string;
}

export const MockCreditCardSchema = SchemaFactory.createForClass(MockCreditCard);
