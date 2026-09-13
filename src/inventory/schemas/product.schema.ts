import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

@Schema()
export class Product {
    _id: Types.ObjectId;

    @Prop({ type: String, required: true })
    name: string;

    @Prop({ type: String, required: false })
    description: string;

    @Prop({ type: Number, required: true })
    price: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);