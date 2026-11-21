import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { setupTestDb } from '../test-db';
import { getDb } from '../../src/db/pool';

describe('Order 15-Minute Expiration Tests', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await setupTestDb();
    app = createApp();
  });

  it('expires pending order past 15 minutes, restores quota, and rejects late payment', async () => {
    // 1. Create Event with quota 5
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Indie Rock Night',
        ticket_types: [{ name: 'REGULAR', price: 75000, quota: 5 }],
      });

    const event = createEventRes.body.data;
    const regType = event.ticket_types[0];

    // 2. Buyer creates order holding 3 tickets
    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'late.buyer@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 3 }],
      });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.id;

    // Check quota: 2 available, 3 reserved
    let eventCheck = await request(app).get(`/api/events/${event.id}`);
    expect(eventCheck.body.data.ticket_types[0].available_quota).toBe(2);
    expect(eventCheck.body.data.ticket_types[0].reserved_quota).toBe(3);

    // 3. Simulate passage of time: manually update order expires_at to 20 minutes ago
    const db = getDb();
    const pastTime = new Date(Date.now() - 20 * 60 * 1000);
    await db.query('UPDATE orders SET expires_at = $1 WHERE id = $2', [pastTime, orderId]);

    // 4. Trigger expiration sweep (can be triggered by background worker, lazy get, or cleanup endpoint)
    const cleanupRes = await request(app).post('/api/orders/cleanup-expired');
    expect(cleanupRes.status).toBe(200);
    expect(cleanupRes.body.swept_count).toBe(1);

    // 5. Verify order is now EXPIRED
    const orderAfterSweep = await request(app).get(`/api/orders/${orderId}`);
    expect(orderAfterSweep.body.data.status).toBe('EXPIRED');

    // 6. Verify quota is completely restored: available is 5 again, reserved is 0
    eventCheck = await request(app).get(`/api/events/${event.id}`);
    expect(eventCheck.body.data.ticket_types[0].available_quota).toBe(5);
    expect(eventCheck.body.data.ticket_types[0].reserved_quota).toBe(0);

    // 7. Verify late payment attempt is rejected and no tickets are issued
    const latePayRes = await request(app).post(`/api/orders/${orderId}/pay`);
    expect(latePayRes.status).toBe(422);
    expect(latePayRes.body.code).toBe('ORDER_EXPIRED');

    // Verify buyer has 0 tickets
    const buyerTickets = await request(app).get('/api/users/late.buyer@test.com/tickets');
    expect(buyerTickets.body.data.length).toBe(0);
  });
});
