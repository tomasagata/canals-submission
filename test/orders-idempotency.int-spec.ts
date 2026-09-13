import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import {
  createTestHarness,
  resetDatabase,
  seedCatalogue,
  SeedResult,
  TestHarness,
} from './support/test-app.js';
import { Order } from '../src/orders/schemas/order.schema.js';
import { OutboxEvent } from '../src/orders/outbox/outbox-event.schema.js';
import { OrderStatus } from '../src/orders/order-status.js';

describe('POST /orders - idempotency and the transactional outbox', () => {
  let harness: TestHarness;
  let seed: SeedResult;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.connection);
    harness.queue.add.mockClear();
    seed = await seedCatalogue(harness);
  });

  const body = () => ({
    customerId: seed.customerId,
    shippingAddress: 'Chicago',
    items: [{ productId: seed.productId.toString(), quantity: 2 }],
  });

  it('accepts an order with 202 and commits the order and its outbox event together', async () => {
    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-1')
      .send(body())
      .expect(202);

    expect(response.body.status).toBe(OrderStatus.PENDING);
    expect(response.body.settled).toBe(false);
    expect(response.body.self).toBe(`/orders/${response.body.orderId}`);
    // Priced in minor units from the seeded price of 25.00.
    expect(response.body.totalAmount).toBe(seed.unitPriceMinor * 2);
    // Nothing has been reserved yet - that is the worker's job.
    expect(response.body.servingWarehouseId).toBeUndefined();

    const outboxModel = harness.moduleRef.get(getModelToken(OutboxEvent.name));
    const events = await outboxModel.find({}).lean().exec();
    expect(events).toHaveLength(1);
    expect(events[0].aggregateId.toString()).toBe(response.body.orderId);
  });

  it('rejects a request with no Idempotency-Key', async () => {
    const response = await request(harness.app.getHttpServer()).post('/orders').send(body()).expect(400);
    expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  /**
   * The headline guarantee: ten simultaneous retries of the same request must
   * produce exactly one order. The read-then-write check alone cannot deliver
   * this - all ten can pass it - so this is really a test that the unique index
   * arbitrates and that the losers correctly return the winner's order.
   */
  it('creates exactly one order for ten concurrent requests sharing a key', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(harness.app.getHttpServer()).post('/orders').set('Idempotency-Key', 'race-key').send(body()),
      ),
    );

    expect(responses.every((r) => r.status === 202)).toBe(true);
    const orderIds = new Set(responses.map((r) => r.body.orderId));
    expect(orderIds.size).toBe(1);

    const orderModel = harness.moduleRef.get(getModelToken(Order.name));
    const outboxModel = harness.moduleRef.get(getModelToken(OutboxEvent.name));
    expect(await orderModel.countDocuments({})).toBe(1);
    // The losing transactions rolled back entirely - no orphaned outbox rows.
    expect(await outboxModel.countDocuments({})).toBe(1);
  });

  it('returns the same order for a sequential replay of the same key', async () => {
    const first = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-2')
      .send(body())
      .expect(202);
    const second = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-2')
      .send(body())
      .expect(202);

    expect(second.body.orderId).toBe(first.body.orderId);
  });

  /**
   * Without a request fingerprint this case silently returns an unrelated
   * order, which is a data-integrity bug dressed up as idempotency.
   */
  it('rejects a key reused with a different body and creates nothing new', async () => {
    await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-3')
      .send(body())
      .expect(202);

    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-3')
      .send({ ...body(), items: [{ productId: seed.productId.toString(), quantity: 5 }] })
      .expect(422);

    expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const orderModel = harness.moduleRef.get(getModelToken(Order.name));
    expect(await orderModel.countDocuments({})).toBe(1);
  });

  it('treats a reordered item list as the same request, not a key reuse', async () => {
    const secondProduct = { productId: seed.productId.toString(), quantity: 2 };
    const first = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-4')
      .send({ ...body(), items: [secondProduct] })
      .expect(202);

    const replay = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-4')
      .send({ ...body(), items: [secondProduct] })
      .expect(202);

    expect(replay.body.orderId).toBe(first.body.orderId);
  });

  it('returns 422 for an unknown customer and writes nothing', async () => {
    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-5')
      .send({ ...body(), customerId: '507f1f77bcf86cd799439011' })
      .expect(422);

    expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
    const orderModel = harness.moduleRef.get(getModelToken(Order.name));
    expect(await orderModel.countDocuments({})).toBe(0);
  });

  it('returns 422 for an address that cannot be geocoded', async () => {
    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'key-6')
      .send({ ...body(), shippingAddress: 'Atlantis' })
      .expect(422);

    expect(response.body.code).toBe('ADDRESS_NOT_GEOCODABLE');
  });

  describe('GET /orders', () => {
    it('returns 400 for a malformed id and 404 for an absent one', async () => {
      await request(harness.app.getHttpServer()).get('/orders/not-an-id').expect(400);
      await request(harness.app.getHttpServer()).get('/orders/507f1f77bcf86cd799439011').expect(404);
    });

    it('returns the order for polling after accept', async () => {
      const accepted = await request(harness.app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', 'key-7')
        .send(body())
        .expect(202);

      const polled = await request(harness.app.getHttpServer())
        .get(`/orders/${accepted.body.orderId}`)
        .expect(200);
      expect(polled.body.status).toBe(OrderStatus.PENDING);
    });

    it('lists orders filtered by customer', async () => {
      await request(harness.app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', 'key-8')
        .send(body())
        .expect(202);

      const list = await request(harness.app.getHttpServer())
        .get('/orders')
        .query({ customerId: seed.customerId })
        .expect(200);

      expect(list.body.total).toBe(1);
      expect(list.body.items).toHaveLength(1);
    });
  });
});
