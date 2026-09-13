import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { MockDataWarehousesService, WarehouseDto } from './mockdata-warehouses.service.js';
import { CreateWarehouseDto } from './dto/index.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';

/** External management API: add or remove the warehouses the real order flow reserves stock against. */
@Controller('warehouses')
export class MockDataWarehousesController {
  constructor(private readonly warehouses: MockDataWarehousesService) {}

  @Get()
  list(): Promise<WarehouseDto[]> {
    return this.warehouses.list();
  }

  @Post()
  create(@Body() dto: CreateWarehouseDto): Promise<WarehouseDto> {
    return this.warehouses.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<void> {
    await this.warehouses.remove(id);
  }
}
