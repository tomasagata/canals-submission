import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { Warehouse } from "./warehouses.schema.js";

@Schema()
export class Stock {
    // Not a local ref: products live in the catalog microservice now, reached
    // over HTTP via CatalogService. This id is only ever compared against ids
    // that service returns.
    @Prop({ type: mongoose.Schema.Types.ObjectId })
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