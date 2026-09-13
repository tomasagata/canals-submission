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
import { OrderStatus, FailureCode } from '../src/orders/order-status.js';
import { Order } from '../src/orders/schemas/order.schema.js';
import { PspCharge } from '../src/mockdata/schemas/psp-charge.schema.js';
import { MovementKind, StockMovement } from '../src/inventory/schemas/stock-movement.schema.js';

describe('Order saga worker', () => {
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
    seed = await seedCatalogue(harness, 10);
  });

  async function acceptOrder(quantity = 2, key = `key-${Date.now()}-${Math.random()}`) {
    const response = await request(harness.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', key)
      .send({
        customerId: seed.customerId,
        shippingAddress: 'Chicago',
        items: [{ productId: seed.productId.toString(), quantity }],
      })
      .expect(202);
    return response.body.orderId as string;
  }

  const orderModel = () => harness.moduleRef.get(getModelToken(Order.name));
  const chargeModel = () => harness.moduleRef.get(getModelToken(PspCharge.name));
  const movementModel = () => harness.moduleRef.get(getModelToken(StockMovement.name));

  it('drives an accepted order to COMPLETED in a single delivery', async () => {
    const orderId = await acceptOrder(2);
    await harness.saga.process(deliver(orderId));

    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.COMPLETED);
    expect(order.warehouseId.toString()).toBe(seed.warehouseId.toString());
    expect(order.paymentResult.success).toBe(true);
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(8);
  });

  it('passes our internal orderId as the idempotency key to both the warehouse and the PSP', async () => {
    const orderId = await acceptOrder(1);
    await harness.saga.process(deliver(orderId));

    const charge = await chargeModel().findOne({ idempotencyKey: orderId }).lean().exec();
    expect(charge).toBeTruthy();

    const movement = await movementModel()
      .findOne({ orderId: new Types.ObjectId(orderId), kind: MovementKind.RESERVE })
      .lean()
      .exec();
    expect(movement).toBeTruthy();
  });

  /**
   * The core at-least-once guarantee. A queue redelivers; this must be free.
   */
  it('is a no-op on redelivery: no double charge and no double decrement', async () => {
    const orderId = await acceptOrder(3);

    await harness.saga.process(deliver(orderId));
    await harness.saga.process(deliver(orderId));
    await harness.saga.process(deliver(orderId));

    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(7);
    expect(await chargeModel().countDocuments({ idempotencyKey: orderId })).toBe(1);
    expect(await movementModel().countDocuments({ orderId: new Types.ObjectId(orderId) })).toBe(1);

    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.COMPLETED);
  });

  it('survives concurrent deliveries of the same job', async () => {
    const orderId = await acceptOrder(2);

    await Promise.all([
      harness.saga.process(deliver(orderId)),
      harness.saga.process(deliver(orderId)),
      harness.saga.process(deliver(orderId)),
    ]);

    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(8);
    expect(await chargeModel().countDocuments({ idempotencyKey: orderId })).toBe(1);
    expect(await movementModel().countDocuments({ orderId: new Types.ObjectId(orderId), kind: MovementKind.RESERVE }))
      .toBe(1);
  });

  it('fails the order without charging when no warehouse can fulfil it', async () => {
    const orderId = await acceptOrder(50); // only 10 in stock
    await harness.saga.process(deliver(orderId));

    const order = await orderModel().findById(orderId).lean().exec();
    expect(order.status).toBe(OrderStatus.FAILED);
    expect(order.failureCode).toBe(FailureCode.OUT_OF_STOCK);
    expect(order.warehouseId).toBeUndefined();
    // Nothing was reserved, so nothing is owed back and nothing was charged.
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(10);
    expect(await chargeModel().countDocuments({})).toBe(0);
    expect(await movementModel().countDocuments({})).toBe(0);
  });

  it('never oversells when two orders compete for the last units', async () => {
    await resetDatabase(harness.connection);
    seed = await seedCatalogue(harness, 3); // only 3 units exist

    const [first, second] = await Promise.all([acceptOrder(3, 'compete-a'), acceptOrder(3, 'compete-b')]);
    await Promise.all([harness.saga.process(deliver(first)), harness.saga.process(deliver(second))]);

    const orders = await orderModel().find({}).lean().exec();
    const completed = orders.filter((o) => o.status === OrderStatus.COMPLETED);
    const failed = orders.filter((o) => o.status === OrderStatus.FAILED);

    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].failureCode).toBe(FailureCode.OUT_OF_STOCK);
    expect(await stockLevel(harness, seed.warehouseId, seed.productId)).toBe(0);
  });

  describe('when the payment is declined', () => {
    let declineHarness: TestHarness;
    let declineSeed: SeedResult;

    beforeAll(async () => {
      declineHarness = await createTestHarness({ PAYMENT_FAILURE_RATE: '1' });
    });
    afterAll(async () => {
      await declineHarness.close();
    });
    beforeEach(async () => {
      await resetDatabase(declineHarness.connection);
      declineSeed = await seedCatalogue(declineHarness, 10);
    });

    it('releases the reserved stock exactly once, however many times it is replayed', async () => {
      const response = await request(declineHarness.app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', 'declined-key')
        .send({
          customerId: declineSeed.customerId,
          shippingAddress: 'Chicago',
          items: [{ productId: declineSeed.productId.toString(), quantity: 4 }],
        })
        .expect(202);
      const orderId = response.body.orderId as string;

      await declineHarness.saga.process(deliver(orderId));
      await declineHarness.saga.process(deliver(orderId));
      await declineHarness.sweeper.sweep();

      const model = declineHarness.moduleRef.get(getModelToken(Order.name));
      const order = await model.findById(orderId).lean().exec();
      expect(order.status).toBe(OrderStatus.COMPENSATED);
      expect(order.failureCode).toBe(FailureCode.PAYMENT_DECLINED);

      // Back to the original level - not above it, which is what a
      // non-idempotent restock would produce.
      expect(await stockLevel(declineHarness, declineSeed.warehouseId, declineSeed.productId)).toBe(10);

      const movements = declineHarness.moduleRef.get(getModelToken(StockMovement.name));
      expect(await movements.countDocuments({ orderId: new Types.ObjectId(orderId), kind: MovementKind.RELEASE }))
        .toBe(1);
    });
  });
});
