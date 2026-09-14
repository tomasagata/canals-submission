import { IsMongoId, IsNumber, IsPositive } from 'class-validator';

export class AddStockDto {
  @IsMongoId()
  warehouseId: string;

  @IsMongoId()
  productId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}
