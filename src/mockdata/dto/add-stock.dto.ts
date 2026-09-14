import { IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';

export class AddStockDto {
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}
