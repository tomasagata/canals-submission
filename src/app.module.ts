import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    OrdersModule, 
    GeocodingModule, 
    PaymentModule,
    ConfigModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
  ],
  providers: [],
  controllers: [],
})
export class AppModule {}
