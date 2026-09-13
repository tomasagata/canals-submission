import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { CustomersModule } from './customers/customers.module.js';
import { validateEnv } from './config/env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.get<string>('REDIS_URI', 'redis://127.0.0.1:6379') },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    CustomersModule,
    OrdersModule,
    GeocodingModule,
    PaymentModule,
    InventoryModule,
  ],
  providers: [],
  controllers: [],
})
export class AppModule {}
