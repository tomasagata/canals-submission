import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Types } from 'mongoose';
import { vi } from 'vitest';

import { OrdersModule } from '../../src/orders/orders.module.js';
import { ORDER_SAGA_QUEUE } from '../../src/orders/queue/order-queue.constants.js';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter.js';
import { Product } from '../../src/inventory/schemas/product.schema.js';
import { Stock } from '../../src/inventory/schemas/stock.schema.js';
import { Warehouse } from '../../src/inventory/schemas/warehouses.schema.js';
import { Customer } from '../../src/customers/schemas/customers.schema.js';
import { OrderSagaProcessor } from '../../src/orders/order-saga.processor.js';
import { OrderReconciliationService } from '../../src/orders/order-reconciliation.service.js';
import { OutboxRelayService } from '../../src/orders/outbox/outbox-relay.service.js';
import { OrdersRepository } from '../../src/orders/orders.repository.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { PaymentService } from '../../src/payment/payment.service.js';
import { CustomersService } from '../../src/customers/customers.service.js';
import type { Job } from 'bullmq';
import type { OrderSagaJobData } from '../../src/orders/queue/order-queue.constants.js';

/**
 * Builds the real application graph against the in-memory replica set, with
 * two deliberate substitutions:
 *
 *  - The BullMQ queue is replaced by a recording stub, so tests never need a
 *    Redis broker. The saga processor is an ordinary class whose `process()`
 *    can be invoked directly, which is both faster and more precise than
 *    waiting for a real worker to pick a job up.
 *  - The relay and sweeper timers are disabled, so tests drive them explicitly
 *    rather than racing a background interval.
 */
export interface TestHarness {
  app: INestApplication;
  moduleRef: TestingModule;
  connection: Connection;
  queue: { add: ReturnType<typeof vi.fn> };
  /** The real saga processor, wired to the real services. Call process() directly. */
  saga: OrderSagaProcessor;
  sweeper: OrderReconciliationService;
  relay: OutboxRelayService;
  close: () => Promise<void>;
}

/** Invokes the saga exactly as a queue delivery would, without a broker. */
export function deliver(orderId: string): Job<OrderSagaJobData> {
  return { data: { orderId, outboxId: 'outbox-test' }, attemptsMade: 0 } as unknown as Job<OrderSagaJobData>;
}

export async function createTestHarness(envOverrides: Record<string, string> = {}): Promise<TestHarness> {
  Object.assign(process.env, {
    // Stops the relay's polling interval from starting. tick() is still called
    // directly by tests, so the logic is exercised, just not on a timer.
    ORDER_OUTBOX_ENABLED: 'false',
    // The sweeper's LOGIC stays enabled - tests call sweep() explicitly. Its
    // cron timer is unregistered below instead, so a background tick can never
    // mutate an order mid-assertion.
    ORDER_SWEEPER_ENABLED: 'true',
    PAYMENT_LATENCY_MS: '0',
    PAYMENT_FAILURE_RATE: '0',
    PAYMENT_LOST_RESPONSE_RATE: '0',
    ...envOverrides,
  });

  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) };

  const moduleRef = await Test.createTestingModule({
    imports: [
      // `ignoreEnvFile` keeps a developer's local .env out of the test run.
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ScheduleModule.forRoot(),
      MongooseModule.forRoot(process.env.MONGO_URI as string),
      OrdersModule,
    ],
  })
    .overrideProvider(getQueueToken(ORDER_SAGA_QUEUE))
    .useValue(queue)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  // Listen on an ephemeral port rather than relying on supertest to spin up a
  // server per request: the concurrency tests fire ten requests at once, and
  // per-request servers reset connections under that load.
  await app.listen(0);

  // Unregister the reconciliation cron. Tests invoke sweep() themselves; a
  // timer firing mid-test would rewrite order state under an assertion.
  const scheduler = moduleRef.get(SchedulerRegistry, { strict: false });
  if (scheduler.doesExist('cron', 'order-reconciliation')) {
    scheduler.deleteCronJob('order-reconciliation');
  }

  const connection = moduleRef.get<Connection>(getConnectionToken());
  // Indexes are what enforce idempotency and the ledger guarantees, so tests
  // are meaningless until they exist. syncIndexes is explicit about that.
  await Promise.all(Object.values(connection.models).map((model) => model.syncIndexes()));

  // Built by hand from the real providers, because registering it in the module
  // would make @nestjs/bullmq open a Redis connection for it.
  const saga = new OrderSagaProcessor(
    moduleRef.get(OrdersRepository, { strict: false }),
    moduleRef.get(InventoryService, { strict: false }),
    moduleRef.get(PaymentService, { strict: false }),
    moduleRef.get(CustomersService, { strict: false }),
  );

  return {
    app,
    moduleRef,
    connection,
    queue,
    saga,
    sweeper: moduleRef.get(OrderReconciliationService, { strict: false }),
    relay: moduleRef.get(OutboxRelayService, { strict: false }),
    close: async () => {
      await app.close();
    },
  };
}

export async function resetDatabase(connection: Connection): Promise<void> {
  await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
}

export interface SeedResult {
  customerId: string;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  unitPriceMinor: number;
}

/** One customer, one product, one warehouse in Chicago with `quantity` in stock. */
export async function seedCatalogue(harness: TestHarness, quantity = 10, price = 25): Promise<SeedResult> {
  const customerModel = harness.moduleRef.get(getModelToken(Customer.name));
  const productModel = harness.moduleRef.get(getModelToken(Product.name));
  const warehouseModel = harness.moduleRef.get(getModelToken(Warehouse.name));
  const stockModel = harness.moduleRef.get(getModelToken(Stock.name));

  const customer = await customerModel.create({
    name: 'Ada Lovelace',
    address: 'Chicago',
    creditCard: '4111111111111111',
  });
  const product = await productModel.create({ name: 'Widget', description: 'A widget', price });
  const warehouse = await warehouseModel.create({
    location: { type: 'Point', coordinates: [-87.6298, 41.8781] }, // Chicago
  });
  await stockModel.create({ productId: product._id, warehouseId: warehouse._id, quantity });

  return {
    customerId: customer._id.toString(),
    productId: product._id,
    warehouseId: warehouse._id,
    unitPriceMinor: Math.round(price * 100),
  };
}

export async function stockLevel(harness: TestHarness, warehouseId: Types.ObjectId, productId: Types.ObjectId) {
  const stockModel = harness.moduleRef.get(getModelToken(Stock.name));
  const row = await stockModel.findOne({ warehouseId, productId }).lean().exec();
  return row?.quantity as number;
}
