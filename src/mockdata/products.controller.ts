import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MockDataProductsService, ProductDto } from './mockdata-products.service.js';
import { CreateProductDto } from './dto/index.js';

/**
 * Doubles as the mock catalogue's external management API and the internal
 * lookup CatalogService calls over HTTP in place of a real product-catalogue
 * provider. `?ids=` is how CatalogService prices an order's items in one
 * round trip instead of one request per product.
 */
@Controller('products')
export class MockDataProductsController {
  constructor(private readonly products: MockDataProductsService) {}

  @Get()
  list(@Query('ids') ids?: string): Promise<ProductDto[]> {
    return this.products.list(ids ? ids.split(',').filter(Boolean) : undefined);
  }

  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductDto> {
    return this.products.create(dto);
  }
}
