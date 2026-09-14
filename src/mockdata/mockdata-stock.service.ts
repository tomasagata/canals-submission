import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Stock } from '../inventory/schemas/stock.schema.js';
import { AddStockDto } from './dto/index.js';

export interface StockDto {
  warehouseId: string;
  productId: string;
  quantity: number;
}

function toDto(stock: { warehouseId: { toString(): string }; productId: { toString(): string }; quantity: number }): StockDto {
  return { warehouseId: stock.warehouseId.toString(), productId: stock.productId.toString(), quantity: stock.quantity };
}

/**
 * Manages the SAME `stock` collection InventoryService reserves/releases
 * against - adding stock here is immediately usable by the real order flow.
 */
@Injectable()
export class MockDataStockService {
  constructor(@InjectModel(Stock.name) private readonly stockModel: Model<Stock>) {}

  async list(): Promise<StockDto[]> {
    const stock = await this.stockModel.find().lean().exec();
    return stock.map(toDto);
  }

  /** Adds to the existing quantity for this product/warehouse pair, creating the row if none exists yet. */
  async addStock(dto: AddStockDto): Promise<StockDto> {
    const stock = await this.stockModel
      .findOneAndUpdate(
        { warehouseId: dto.warehouseId, productId: dto.productId },
        { $inc: { quantity: dto.quantity } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
    return toDto(stock);
  }
}
