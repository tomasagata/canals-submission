import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsMongoId, IsNotEmpty, IsPositive, IsString, Min, ValidateNested } from 'class-validator';

export class ItemDto {
  @IsMongoId()
  productId: string;

  @IsInt()
  @IsPositive()
  @Min(1)
  quantity: number;
}


export class CreateOrderDto {
  @IsMongoId()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  shippingAddress: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: Array<ItemDto>;
}