import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { PaymentModule } from './payment/payment.module.js';

@Module({
  imports: [OrdersModule, GeocodingModule, PaymentModule],
  providers: [],
  controllers: [],
})
export class AppModule {}
