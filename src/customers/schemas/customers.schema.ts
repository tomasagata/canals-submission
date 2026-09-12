import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

@Schema()
export class Customer {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;
  
  @Prop({ type: String, required: true })
  address: string;

  @Prop({ type: String, required: true})
  creditCard: string;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);