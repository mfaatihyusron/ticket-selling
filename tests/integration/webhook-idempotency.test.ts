import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { setupTestDb } from '../test-db';
import { getDb } from '../../src/db/pool';

describe('Payment Webhook Idempotency & Edge Cases', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await setupTestDb();
    app = createApp();
  });

  it('handles duplicate webhook calls idempotently without duplicate tickets', async () => {
    // 1. Create Event & Order
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Jazz Rendezvous',
        ticket_types: [{ name: 'VIP', price: 200000, quota: 20 }],
      });

    const event = createEventRes.body.data;
    const vipType = event.ticket_types[0];

    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'alice@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 2 }],
      });

    const orderId = orderRes.body.data.id;
    const paymentRef = 'TRX-PAY-ALICE-12345';

    // 2. First Webhook Delivery
    const webhookRes1 = await request(app)
      .post('/api/payments/webhook')
      .send({
        payment_reference: paymentRef,
        order_id: orderId,
        amount: 400000,
        status: 'SUCCESS',
      });

    expect(webhookRes1.status).toBe(200);
    expect(webhookRes1.body.code).toBe('PROCESSED');
    expect(webhookRes1.body.issued_tickets.length).toBe(2);

    // 3. Second Duplicate Webhook Delivery (Network retry or duplicate provider call)
    const webhookRes2 = await request(app)
      .post('/api/payments/webhook')
      .send({
        payment_reference: paymentRef,
        order_id: orderId,
        amount: 400000,
        status: 'SUCCESS',
      });

    expect(webhookRes2.status).toBe(200);
    expect(webhookRes2.body.code).toBe('ALREADY_PROCESSED');
    expect(webhookRes2.body.message).toMatch(/Idempotent replay detected/i);

    // Verify tickets in database: exactly 2 tickets, NOT 4!
    const ticketsRes = await request(app).get('/api/users/alice@test.com/tickets');
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body.data.length).toBe(2);

    // Verify sold_quota is 2, not 4
    const eventCheck = await request(app).get(`/api/events/${event.id}`);
    expect(eventCheck.body.data.ticket_types[0].sold_quota).toBe(2);
  });

  it('rejects late webhook arriving after order has expired and does not issue tickets', async () => {
    // 1. Create Event & Order
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Symphony Orchestra',
        ticket_types: [{ name: 'REGULAR', price: 150000, quota: 10 }],
      });

    const event = createEventRes.body.data;
    const regType = event.ticket_types[0];

    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'late.user@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 2 }],
      });

    const orderId = orderRes.body.data.id;

    // Simulate order expiry: set expires_at 30 minutes in past
    const db = getDb();
    const past = new Date(Date.now() - 30 * 60 * 1000);
    await db.query('UPDATE orders SET expires_at = $1 WHERE id = $2', [past, orderId]);

    // Late webhook arrives!
    const lateWebhookRes = await request(app)
      .post('/api/payments/webhook')
      .send({
        payment_reference: 'TRX-LATE-99999',
        order_id: orderId,
        amount: 300000,
        status: 'SUCCESS',
      });

    expect(lateWebhookRes.status).toBe(422);
    expect(lateWebhookRes.body.code).toBe('ORDER_EXPIRED');
    expect(lateWebhookRes.body.message).toMatch(/Webhook arrived late/i);

    // Verify zero tickets issued
    const userTickets = await request(app).get('/api/users/late.user@test.com/tickets');
    expect(userTickets.body.data.length).toBe(0);

    // Verify quota was returned to pool (all 10 available)
    const eventCheck = await request(app).get(`/api/events/${event.id}`);
    expect(eventCheck.body.data.ticket_types[0].available_quota).toBe(10);
    expect(eventCheck.body.data.ticket_types[0].reserved_quota).toBe(0);
    expect(eventCheck.body.data.ticket_types[0].sold_quota).toBe(0);
  });
});
