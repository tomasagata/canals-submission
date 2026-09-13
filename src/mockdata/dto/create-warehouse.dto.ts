import { IsLatitude, IsLongitude } from 'class-validator';

export class CreateWarehouseDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
