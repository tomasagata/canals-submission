import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product } from './schemas/product.schema.js';
import { CreateProductDto } from './dto/index.js';

export interface ProductDto {
  id: string;
  name: string;
  description?: string;
  price: number;
}

function toDto(product: { _id: Types.ObjectId; name: string; description?: string; price: number }): ProductDto {
  return { id: product._id.toString(), name: product.name, description: product.description, price: product.price };
}

@Injectable()
export class MockDataProductsService {
  constructor(@InjectModel(Product.name) private readonly productModel: Model<Product>) {}

  /** Lists the whole catalogue, or just the given ids when `ids` is provided - this is what CatalogService calls to price an order. */
  async list(ids?: string[]): Promise<ProductDto[]> {
    const filter = ids ? { _id: { $in: ids.filter((id) => Types.ObjectId.isValid(id)) } } : {};
    const products = await this.productModel.find(filter).lean().exec();
    return products.map(toDto);
  }

  async create(dto: CreateProductDto): Promise<ProductDto> {
    const product = await this.productModel.create(dto);
    return toDto(product);
  }
}
