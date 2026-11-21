import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { setupTestDb } from '../test-db';

describe('Quota Exhaustion & Anti-Overselling Tests', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await setupTestDb();
    app = createApp();
  });

  it('rejects order when requested quantity exceeds remaining quota (no oversell)', async () => {
    // 1. Create Event with limited quota: VIP has only 3 tickets
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Exclusive VIP Masterclass',
        description: 'Sesi privat dengan kuota sangat terbatas',
        ticket_types: [
          { name: 'VIP', price: 1000000, quota: 3 },
          { name: 'REGULAR', price: 300000, quota: 10 },
        ],
      });

    const event = createEventRes.body.data;
    const vipType = event.ticket_types.find((t: any) => t.name === 'VIP');
    expect(vipType.available_quota).toBe(3);

    // 2. Buyer 1 orders 3 VIP tickets (takes all available VIP quota)
    const order1 = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'buyer1@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 3 }],
      });

    expect(order1.status).toBe(201);
    expect(order1.body.data.status).toBe('PENDING');

    // Quota should now be 0 available
    const eventCheck = await request(app).get(`/api/events/${event.id}`);
    const vipCheck = eventCheck.body.data.ticket_types.find((t: any) => t.id === vipType.id);
    expect(vipCheck.available_quota).toBe(0);
    expect(vipCheck.reserved_quota).toBe(3);

    // 3. Buyer 2 tries to order 1 VIP ticket -> MUST BE REJECTED with 409 Out of Quota
    const order2 = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'buyer2@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 1 }],
      });

    expect(order2.status).toBe(409);
    expect(order2.body.success).toBe(false);
    expect(order2.body.error).toMatch(/Insufficient quota/i);

    // 4. Buyer 1 cancels their order -> quota is immediately restored (Rule 5)
    const cancelRes = await request(app)
      .post(`/api/orders/${order1.body.data.id}/cancel`)
      .send({ user_id: 'buyer1@test.com' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');

    // Quota is back to 3 available
    const eventRestored = await request(app).get(`/api/events/${event.id}`);
    const vipRestored = eventRestored.body.data.ticket_types.find((t: any) => t.id === vipType.id);
    expect(vipRestored.available_quota).toBe(3);
    expect(vipRestored.reserved_quota).toBe(0);

    // 5. Buyer 2 tries to order again -> now succeeds!
    const order2Retry = await request(app)
      .post('/api/orders')
      .send({
        user_id: 'buyer2@test.com',
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 2 }],
      });

    expect(order2Retry.status).toBe(201);
    expect(order2Retry.body.data.status).toBe('PENDING');
  });
});
