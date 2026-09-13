import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** The mock geocoder's address book: a free-text address mapped to a fixed point. */
@Schema({ collection: 'mock_addresses' })
export class MockAddress {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  address: string;

  @Prop({ type: Number, required: true })
  latitude: number;

  @Prop({ type: Number, required: true })
  longitude: number;
}

export const MockAddressSchema = SchemaFactory.createForClass(MockAddress);
