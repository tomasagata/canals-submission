import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto, ListOrdersQueryDto, OrderResponseDto, PaginatedOrdersDto } from './dto/index.js';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Accepts an order. Always 202: the order is durably recorded, but stock
   * reservation and payment happen asynchronously, so no outcome is available
   * yet. Poll the `self` link for the settled result.
   *
   * A retry with the same Idempotency-Key returns the same 202 and the same
   * orderId, whatever state the order has since reached. That sameness is the
   * whole contract - a client's retry path should look exactly like its first
   * attempt, so returning 409 or 200 on a replay (as is sometimes suggested)
   * would force every caller to branch on the path they test least.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateOrderDto, @IdempotencyKey() idempotencyKey: string): Promise<OrderResponseDto> {
    return this.ordersService.acceptOrder(dto, idempotencyKey);
  }

  @Get(':id')
  getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<OrderResponseDto> {
    return this.ordersService.getOrder(id);
  }

  @Get()
  list(@Query() query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    return this.ordersService.listOrders(query);
  }
}
