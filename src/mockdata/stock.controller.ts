import { Body, Controller, Get, Post } from '@nestjs/common';
import { MockDataStockService, StockDto } from './mockdata-stock.service.js';
import { AddStockDto } from './dto/index.js';

/** External management API: top up the stock the real order flow reserves against. */
@Controller('stock')
export class MockDataStockController {
  constructor(private readonly stock: MockDataStockService) {}

  @Get()
  list(): Promise<StockDto[]> {
    return this.stock.list();
  }

  @Post()
  create(@Body() dto: AddStockDto): Promise<StockDto> {
    return this.stock.addStock(dto);
  }
}
