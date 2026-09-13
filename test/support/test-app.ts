import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Types } from 'mongoose';
import { vi } from 'vitest';

import { OrdersModule } from '../../src/orders/orders.module.js';
import { MockDataModule } from '../../src/mockdata/mockdata.module.js';
import { ORDER_SAGA_QUEUE } from '../../src/orders/queue/order-queue.constants.js';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter.js';
import { Stock } from '../../src/inventory/schemas/stock.schema.js';
import { Warehouse } from '../../src/inventory/schemas/warehouses.schema.js';
import { Customer } from '../../src/mockdata/schemas/customer.schema.js';
import { Product } from '../../src/mockdata/schemas/product.schema.js';
import { MockAddress } from '../../src/mockdata/schemas/mock-address.schema.js';
import { OrderSagaProcessor } from '../../src/orders/order-saga.processor.js';
import { OrderReconciliationService } from '../../src/orders/order-reconciliation.service.js';
import { OutboxRelayService } from '../../src/orders/outbox/outbox-relay.service.js';
import { OrdersRepository } from '../../src/orders/orders.repository.js';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { PaymentService, PSP_LOCATION } from '../../src/payment/payment.service.js';
import { CustomersService, CUSTOMER_LOCATION } from '../../src/customers/customers.service.js';
import { GEOCODING_LOCATION } from '../../src/geocoding/geocoding.service.js';
import { CATALOG_LOCATION } from '../../src/catalog/catalog.service.js';
import type { RemoteServiceLocation } from '../../src/common/remote-location.js';
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
      // OrdersModule has no dependency on this - it's here because the app
      // needs MockDataModule's controllers mounted for Payment/Customers/
      // Geocoding's real HTTP calls to land somewhere, same as AppModule does
      // for the full app.
      MockDataModule,
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

  // Payment/Customers/Geocoding/Catalog each call their own configured
  // location over real loopback HTTP; all four default to the mockdata module
  // mounted on this same app. None of that is known until now, since the port
  // is OS-assigned - this corrects each one to the port actually bound above.
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : address;
  const base = `http://127.0.0.1:${port}`;
  moduleRef.get<RemoteServiceLocation>(PSP_LOCATION, { strict: false }).setBaseUrl(`${base}/psp`);
  moduleRef.get<RemoteServiceLocation>(CUSTOMER_LOCATION, { strict: false }).setBaseUrl(`${base}/customers`);
  moduleRef.get<RemoteServiceLocation>(GEOCODING_LOCATION, { strict: false }).setBaseUrl(`${base}/addresses`);
  moduleRef.get<RemoteServiceLocation>(CATALOG_LOCATION, { strict: false }).setBaseUrl(`${base}/products`);

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

/**
 * One customer, one product, one warehouse in Chicago with `quantity` in
 * stock, plus a 'Chicago' entry in the mock geocoder's address book.
 *
 * The address entry matters because `resetDatabase` wipes every collection,
 * including the mockdata module's own - so the default cities it seeds once
 * at startup do not survive past the first test. Every test that geocodes
 * 'Chicago' relies on this being reseeded here, right after each reset.
 */
export async function seedCatalogue(harness: TestHarness, quantity = 10, price = 25): Promise<SeedResult> {
  const customerModel = harness.moduleRef.get(getModelToken(Customer.name));
  const productModel = harness.moduleRef.get(getModelToken(Product.name));
  const warehouseModel = harness.moduleRef.get(getModelToken(Warehouse.name));
  const stockModel = harness.moduleRef.get(getModelToken(Stock.name));
  const addressModel = harness.moduleRef.get(getModelToken(MockAddress.name));

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
  await addressModel.create({ address: 'Chicago', latitude: 41.8781, longitude: -87.6298 });

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
