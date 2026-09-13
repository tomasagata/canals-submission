import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

/**
 * The mock catalogue's own record. Lives here rather than in the inventory
 * module because CatalogService no longer touches Mongo directly - it calls
 * this module's HTTP API, the same way it would call a real product-catalogue
 * provider.
 */
@Schema()
export class Product {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({ type: Number, required: true })
  price: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
