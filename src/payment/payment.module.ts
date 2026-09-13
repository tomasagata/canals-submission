import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentService } from './payment.service.js';
import { PspCharge, PspChargeSchema } from './schemas/psp-charge.schema.js';
import { paymentConfig } from '../config/payment.config.js';

@Module({
  imports: [
    ConfigModule.forFeature(paymentConfig),
    MongooseModule.forFeature([{ name: PspCharge.name, schema: PspChargeSchema }]),
  ],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
