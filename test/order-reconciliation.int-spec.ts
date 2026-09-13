import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  createTestHarness,
  deliver,
  resetDatabase,
  seedCatalogue,
  SeedResult,
  stockLevel,
  TestHarness,
} from './support/test-app.js';
import { FailureCode, OrderStatus } from '../src/orders/order-status.js';
import { Order } from '../src/orders/schemas/order.schema.js';
import { PspCharge } from '../src/mockdata/schemas/psp-charge.schema.js';
import { MovementKind, StockMovement } from '../src/inventory/schemas/stock-movement.schema.js';
import { OutboxEvent } from '../src/orders/outbox/outbox-event.schema.js';
import { OutboxRepository } from '../src/orders/outbox/outbox.repository.js';
import { ordersConfig } from '../src/config/orders.config.js';

/**
 * Ages an order so the sweeper considers it stale, without waiting minutes.
 * timestamps:false keeps this from being undone by mongoose's own bookkeeping.
 *
 * The default backdates by 2x the harness's *actual* configured staleAfterMs,
 * rather than a hardcoded constant: a fixed number here would silently lose
 * its safety margin (and start flaking) if ORDER_STALE_AFTER_MS ever changed
 * without this file being updated to match.
 */
async function age(harness: TestHarness, orderId: string, ms?: number): Promise<void> {
  const resolvedMs = ms ?? harness.moduleRef.get(ordersConfig.KEY, { strict: false }).sweeper.staleAfterMs * 2;
  const model = harness.moduleRef.get(getModelToken(Order.name));
  await model
    .updateOne(
      { _id: new Types.ObjectId(orderId) },
      { $set: { updatedAt: new Date(Date.now() - resolvedMs) } },
      { timestamps: false },
    )
    .exec();
}

describe('Order reconciliation sweeper', () => {
  let harness: TestHarness;
  let seed: SeedResult;

  beforeAll(async () => {
    // Sweeper logic is invoked directly; the cron timer stays off.
    harness = await createTestHarness();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await resetDatabase(harness.connection);
    seed = await seedCatalogue(harness, 10);
  });

  async function accept(harnessRef: TestHarness, seedRef: SeedResult, quantity = 2, key = `k-${Math.random()}`) {
    const response = await request(harnessRef.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', key)
      .send({
        customerId: seedRef.customerId,
        shippingAddress: 'Chicago',
        items: [{ productId: seedRef.productId.toString(), quantity }],
      })
      .expect(202);
    return response.body.orderId as string;
  }

  const orderModel = (h: TestHarness = harness) => h.moduleRef.get(getModelToken(Order.name));

  it('does not touch orders that are not yet stale', async () => {
    const orderId = await accept(harness, seed);
    const result = await harness.sweeper.sweep();

    expect(result.markedFailed).toBe(0);
    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.PENDING);
  });

  it('fails a PENDING order that has aged past the deadline, with nothing to unwind', async () => {
    const orderId = await accept(harness, seed);
    await age(harness, orderId);

    const result = await harness.sweeper.sweep();
    expect(result.markedFailed).toBe(1);

    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.FAILED);
    expect(order.failureCode).toBe(FailureCode.RECONCILED_TIMEOUT);
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(10);
  });

  it('completes an order left in PAYMENT_AUTHORIZED', async () => {
    const orderId = await accept(harness, seed);
    await orderModel()
      .updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { status: OrderStatus.PAYMENT_AUTHORIZED } })
      .exec();
    await age(harness, orderId);

    const result = await harness.sweeper.sweep();
    expect(result.completed).toBe(1);
    expect((await orderModel().findById(orderId).lean().exec()).status).toBe(OrderStatus.COMPLETED);
  });

  it('compensates a STOCK_RESERVED order the PSP has no record of', async () => {
    const orderId = await accept(harness, seed, 4);
    // Reserve for real, then abandon the saga before it charges.
    await harness.saga['reserve'](await orderModel().findById(orderId).exec());
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(6);
    await age(harness, orderId);

    const result = await harness.sweeper.sweep();
    expect(result.compensated).toBe(1);

    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.COMPENSATED);
    expect(order.failureCode).toBe(FailureCode.RECONCILED_NO_CHARGE);
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(10);
  });

  it('is safe to run concurrently with the worker on the same order', async () => {
    const orderId = await accept(harness, seed, 2);
    await harness.saga['reserve'](await orderModel().findById(orderId).exec());
    await age(harness, orderId);

    await Promise.all([harness.sweeper.sweep(), harness.saga.process(deliver(orderId))]);

    const chargeModel = harness.moduleRef.get(getModelToken(PspCharge.name));
    const movementModel = harness.moduleRef.get(getModelToken(StockMovement.name));

    // Exactly one actor settled the order, and neither duplicated a side effect.
    const order = await orderModel().findById(orderId).lean().exec();
    expect([OrderStatus.COMPLETED, OrderStatus.COMPENSATED]).toContain(order.status);
    expect(await chargeModel.countDocuments({ idempotencyKey: orderId })).toBeLessThanOrEqual(1);
    expect(await movementModel.countDocuments({ orderId: new Types.ObjectId(orderId), kind: MovementKind.RESERVE }))
      .toBe(1);
    expect(await movementModel.countDocuments({ orderId: new Types.ObjectId(orderId), kind: MovementKind.RELEASE }))
      .toBeLessThanOrEqual(1);

    // Whatever the outcome, stock is consistent with it.
    const expected = order.status === OrderStatus.COMPLETED ? 8 : 10;
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(expected);
  });

  /**
   * The scenario this entire architecture exists for: the PSP took the money
   * and the response never came back. Without a status lookup the only safe
   * assumption would be failure, which would release stock for an order the
   * customer has already paid for.
   */
  describe('when the payment succeeds but the response is lost', () => {
    let lossy: TestHarness;
    let lossySeed: SeedResult;

    beforeAll(async () => {
      lossy = await createTestHarness({ PAYMENT_LOST_RESPONSE_RATE: '1' });
    });
    afterAll(async () => {
      await lossy.close();
    });
    beforeEach(async () => {
      await resetDatabase(lossy.connection);
      lossySeed = await seedCatalogue(lossy, 10);
    });

    it('discovers the charge and drives the order to COMPLETED', async () => {
      const orderId = await accept(lossy, lossySeed, 3, 'lost-response');

      // The worker reserves, charges, then loses the response and throws.
      await expect(lossy.saga.process(deliver(orderId))).rejects.toThrow(/did not respond/);

      const stranded = await orderModel(lossy).findById(orderId).lean().exec();
      expect(stranded.status).toBe(OrderStatus.STOCK_RESERVED);
      expect(stranded.paymentResult).toBeUndefined(); // we never learned the outcome

      const chargeModel = lossy.moduleRef.get(getModelToken(PspCharge.name));
      const charge = await chargeModel.findOne({ idempotencyKey: orderId }).lean().exec();
      expect(charge.status).toBe('SUCCEEDED'); // the money DID move

      await age(lossy, orderId);
      const result = await lossy.sweeper.sweep();

      expect(result.authorized).toBe(1);
      expect(result.completed).toBe(1);

      const settled = await orderModel(lossy).findById(orderId).lean().exec();
      expect(settled.status).toBe(OrderStatus.COMPLETED);
      // The same charge, recovered - not a second one.
      expect(settled.paymentResult.transactionId).toBe(charge.transactionId);
      expect(await chargeModel.countDocuments({ idempotencyKey: orderId })).toBe(1);
      // Stock stays consumed, because the customer paid for it.
      expect(await stockLevel(lossy, lossySeed.warehouseId, lossySeed.productId)).toBe(7);
    });
  });
});

describe('Outbox relay', () => {
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
    seed = await seedCatalogue(harness, 10);
  });

  it('dispatches a committed event exactly once and marks it DISPATCHED', async () => {
    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'relay-key')
      .send({
        customerId: seed.customerId,
        shippingAddress: 'Chicago',
        items: [{ productId: seed.productId.toString(), quantity: 1 }],
      })
      .expect(202);

    expect(await harness.relay.tick()).toBe(1);
    expect(harness.queue.add).toHaveBeenCalledTimes(1);
    expect(harness.queue.add.mock.calls[0][1]).toMatchObject({ orderId: response.body.orderId });

    const outboxModel = harness.moduleRef.get(getModelToken(OutboxEvent.name));
    const event = await outboxModel.findOne({}).lean().exec();
    expect(event.status).toBe('DISPATCHED');

    // A second pass finds nothing left to do.
    expect(await harness.relay.tick()).toBe(0);
    expect(harness.queue.add).toHaveBeenCalledTimes(1);
  });

  it('gives an event to exactly one of two concurrent relays', async () => {
    await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'relay-race')
      .send({
        customerId: seed.customerId,
        shippingAddress: 'Chicago',
        items: [{ productId: seed.productId.toString(), quantity: 1 }],
      })
      .expect(202);

    const outbox = harness.moduleRef.get(OutboxRepository, { strict: false });
    const [a, b] = await Promise.all([outbox.claimNext(30_000), outbox.claimNext(30_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  /**
   * The guarantee against a duplicated ORDER_CREATED event is the unique
   * (aggregateId, eventType) index, not the caller's session bookkeeping - a
   * session only ties the event write to the order write, it doesn't stop two
   * separate calls for the same order from both trying to insert one. This
   * proves the index is what actually closes that race.
   */
  it('rejects a second ORDER_CREATED event for an aggregate that already has one', async () => {
    const outbox = harness.moduleRef.get(OutboxRepository, { strict: false });
    const orderId = new Types.ObjectId();

    const firstSession = await harness.connection.startSession();
    try {
      await outbox.createOrderCreatedEvent(orderId, firstSession);
    } finally {
      await firstSession.endSession();
    }

    const secondSession = await harness.connection.startSession();
    try {
      await expect(outbox.createOrderCreatedEvent(orderId, secondSession)).rejects.toThrow();
    } finally {
      await secondSession.endSession();
    }

    const outboxModel = harness.moduleRef.get(getModelToken(OutboxEvent.name));
    expect(await outboxModel.countDocuments({ aggregateId: orderId })).toBe(1);
  });
});
