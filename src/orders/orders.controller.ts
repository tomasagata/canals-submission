import { Controller, Get, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/index.js';
import type { Response } from 'express';

@Controller("orders")
export class OrdersController {
  constructor(private readonly appService: OrdersService) {}

  @Get()
  getOrders(): string {
    return this.appService.getHello();
  }

  @Post()
  createOrder(
    @Body() body: CreateOrderDto, 
    @Res({ passthrough: true }) res: Response
  ): void {
    try {
      this.appService.createOrder(body);
    } catch (error) {
      console.error(error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      res.write(JSON.stringify({ error: 'Failed to create order' }));
      res.end();
      return;
    }
    res.status(HttpStatus.CREATED);
    res.write(JSON.stringify({ message: 'Order created successfully' }));
    res.end();
    return;
  }
}
