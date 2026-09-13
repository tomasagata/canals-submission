import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

@Schema()
export class Warehouse {
    _id: Types.ObjectId;

    @Prop({
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], required: true, minLength: 2, maxLength: 2 },
    })
    location: {
        type: string;
        coordinates: number[];
    };
}

export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
WarehouseSchema.index({ location: "2dsphere" });