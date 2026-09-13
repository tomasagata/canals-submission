import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';
import { OrderSagaProcessor } from './order-saga.processor.js';
import { OrderReconciliationService } from './order-reconciliation.service.js';
import { OutboxRepository } from './outbox/outbox.repository.js';
import { OutboxRelayService } from './outbox/outbox-relay.service.js';
import { GeocodingModule } from '../geocoding/geocoding.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { Order, OrderSchema } from './schemas/order.schema.js';
import { OutboxEvent, OutboxEventSchema } from './outbox/outbox-event.schema.js';
import { ORDER_SAGA_QUEUE } from './queue/order-queue.constants.js';
import { ordersConfig } from '../config/orders.config.js';
import { queueConfig } from '../config/queue.config.js';

/**
 * Whether this process runs the saga worker, decided at module-definition time
 * because @nestjs/bullmq opens a real Redis connection for every @Processor it
 * discovers - so the switch has to be "is the provider registered at all",
 * not a runtime flag inside it.
 *
 * Two uses: it lets API and worker processes scale independently off the same
 * image, and it keeps tests from needing a broker (they invoke
 * OrderSagaProcessor.process() directly, which is more precise anyway).
 */
const workerEnabled = (process.env.ORDER_SAGA_WORKER_ENABLED ?? 'true').toLowerCase() === 'true';

@Module({
  imports: [
    ConfigModule.forFeature(ordersConfig),
    ConfigModule.forFeature(queueConfig),
    GeocodingModule,
    CustomersModule,
    PaymentModule,
    InventoryModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
    BullModule.registerQueue({ name: ORDER_SAGA_QUEUE }),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrdersRepository,
    OutboxRepository,
    OutboxRelayService,
    OrderReconciliationService,
    ...(workerEnabled ? [OrderSagaProcessor] : []),
  ],
})
export class OrdersModule {}
