import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/index.js';

@Injectable()
export class OrdersService {
  getHello(): string {
    return 'Hello World!';
  }

  createOrder(orderData: CreateOrderDto): void {
    // Here you would implement the logic to create an order.
    // For example, you might save the order data to a database.
    console.log('Order created:', orderData);
  }
}
