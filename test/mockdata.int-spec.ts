import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { createTestHarness, deliver, resetDatabase, seedCatalogue, SeedResult, TestHarness } from './support/test-app.js';
import { Order } from '../src/orders/schemas/order.schema.js';
import { OrderStatus, FailureCode } from '../src/orders/order-status.js';

/**
 * Exercises the mockdata module's own surface: the external CRUD API a caller
 * uses to shape the mock world while the app runs, and the fact that Payment,
 * Customers and Geocoding really do drive their behaviour through it over
 * HTTP rather than through any in-process shortcut.
 */
describe('Mockdata module', () => {
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

  const http = () => request(harness.app.getHttpServer());

  describe('warehouses', () => {
    it('lists, adds and removes a warehouse', async () => {
      const before = await http().get('/warehouses').expect(200);
      expect(before.body).toHaveLength(1); // the one seedCatalogue created

      const created = await http()
        .post('/warehouses')
        .send({ latitude: 34.0522, longitude: -118.2437 }) // Los Angeles
        .expect(201);
      expect(created.body).toMatchObject({ latitude: 34.0522, longitude: -118.2437 });

      const after = await http().get('/warehouses').expect(200);
      expect(after.body).toHaveLength(2);

      await http().delete(`/warehouses/${created.body.id}`).expect(204);
      const afterDelete = await http().get('/warehouses').expect(200);
      expect(afterDelete.body).toHaveLength(1);
    });

    it('404s deleting a warehouse that does not exist', async () => {
      await http().delete('/warehouses/507f1f77bcf86cd799439011').expect(404);
    });
  });

  describe('customers', () => {
    it('adds a customer over the API and immediately uses it to place a real order', async () => {
      const created = await http()
        .post('/customers')
        .send({ name: 'Grace Hopper', creditCard: '4242424242424242' })
        .expect(201);

      const response = await http()
        .post('/orders')
        .set('Idempotency-Key', 'new-customer-key')
        .send({
          customerId: created.body.id,
          shippingAddress: 'Chicago',
          items: [{ productId: seed.productId.toString(), quantity: 1 }],
        })
        .expect(202);

      await http().get(`/customers/${created.body.id}`).expect(200);

      await http().delete(`/customers/${created.body.id}`).expect(204);
      await http().get(`/customers/${created.body.id}`).expect(404);

      // The order itself was already accepted against the customer that then
      // got removed - accepting doesn't re-validate on every read.
      await http().get(`/orders/${response.body.orderId}`).expect(200);
    });
  });

  describe('addresses (the mock geocoder)', () => {
    it('adds an address and an order can ship to it', async () => {
      await http().post('/addresses').send({ address: 'Gotham', latitude: 40.7, longitude: -74.0 }).expect(201);

      await http()
        .post('/orders')
        .set('Idempotency-Key', 'gotham-key')
        .send({
          customerId: seed.customerId,
          shippingAddress: 'Gotham',
          items: [{ productId: seed.productId.toString(), quantity: 1 }],
        })
        .expect(202);
    });

    it('rejects an order for an address the geocoder has never heard of', async () => {
      await http()
        .post('/orders')
        .set('Idempotency-Key', 'atlantis-key')
        .send({
          customerId: seed.customerId,
          shippingAddress: 'Atlantis',
          items: [{ productId: seed.productId.toString(), quantity: 1 }],
        })
        .expect(422);
    });
  });

  describe('credit-card state', () => {
    it('pins a card to always decline, overriding the global failure rate', async () => {
      await http()
        .post('/credit-cards')
        .send({ cardNumber: '4111111111111111', status: 'DECLINE', declineReason: 'Reported stolen.' })
        .expect(201);

      const response = await http()
        .post('/orders')
        .set('Idempotency-Key', 'pinned-decline-key')
        .send({
          customerId: seed.customerId, // seeded with card 4111111111111111
          shippingAddress: 'Chicago',
          items: [{ productId: seed.productId.toString(), quantity: 1 }],
        })
        .expect(202);

      await harness.saga.process(deliver(response.body.orderId));

      const orderModel = harness.moduleRef.get(getModelToken(Order.name));
      const order = await orderModel.findById(response.body.orderId).lean().exec();
      expect(order.status).toBe(OrderStatus.COMPENSATED);
      expect(order.failureCode).toBe(FailureCode.PAYMENT_DECLINED);
      expect(order.paymentResult.errorMessage).toBe('Reported stolen.');
    });
  });
});
