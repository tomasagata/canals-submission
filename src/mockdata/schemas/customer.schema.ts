import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

/**
 * The mock customer directory's own record. Moved here from the customers
 * module because CustomersService no longer touches Mongo directly - it calls
 * this module's HTTP API, the same way it would call a real customer-data
 * provider.
 */
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
