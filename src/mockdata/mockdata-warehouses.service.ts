import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Warehouse } from '../inventory/schemas/warehouses.schema.js';
import { CreateWarehouseDto } from './dto/index.js';

export interface WarehouseDto {
  id: string;
  latitude: number;
  longitude: number;
}

function toDto(warehouse: { _id: Types.ObjectId; location: { coordinates: number[] } }): WarehouseDto {
  const [longitude, latitude] = warehouse.location.coordinates;
  return { id: warehouse._id.toString(), latitude, longitude };
}

/**
 * Manages the SAME `warehouses` collection InventoryService reserves stock
 * against - a warehouse added here is immediately usable by the real order
 * flow, not a disconnected copy of "mock" data.
 */
@Injectable()
export class MockDataWarehousesService {
  constructor(@InjectModel(Warehouse.name) private readonly warehouseModel: Model<Warehouse>) {}

  async list(): Promise<WarehouseDto[]> {
    const warehouses = await this.warehouseModel.find().lean().exec();
    return warehouses.map(toDto);
  }

  async create(dto: CreateWarehouseDto): Promise<WarehouseDto> {
    const warehouse = await this.warehouseModel.create({
      location: { type: 'Point', coordinates: [dto.longitude, dto.latitude] },
    });
    return toDto(warehouse);
  }

  async remove(id: Types.ObjectId): Promise<void> {
    const result = await this.warehouseModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Warehouse ${id.toString()} not found.`);
    }
  }
}
