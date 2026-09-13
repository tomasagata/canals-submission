import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Product } from "./product.schema.js";
import mongoose from "mongoose";
import { Warehouse } from "./warehouses.schema.js";

@Schema()
export class Stock {
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Product.name })
    productId: mongoose.Types.ObjectId;
    
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Warehouse.name })
    warehouseId: mongoose.Types.ObjectId;
    
    @Prop({ type: Number, required: true })
    quantity: number;
}

export const StockSchema = SchemaFactory.createForClass(Stock);
// Exactly one stock row per product per warehouse. Without this, duplicate
// rows would silently break both the conditional decrement (which matches a
// single document) and the restock accounting.
StockSchema.index({ warehouseId: 1, productId: 1 }, { unique: true });