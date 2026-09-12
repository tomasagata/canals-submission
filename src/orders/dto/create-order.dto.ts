import { IsArray, IsInt, IsString, IsUUID } from 'class-validator';

export class ItemDto {
  @IsString()
  productId: string;

  @IsInt()
  quantity: number;
}

export class CreateOrderDto {
  @IsUUID()
  customer: string;

  @IsString()
  shippingAddress: string;

  @IsArray()
  items: Array<ItemDto>;
}