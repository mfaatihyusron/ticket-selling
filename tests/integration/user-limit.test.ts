import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { setupTestDb } from '../test-db';

describe('User Max 4 Tickets Limit Tests (Rule 4)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await setupTestDb();
    app = createApp();
  });

  it('enforces maximum 4 tickets per buyer per event across active and paid orders', async () => {
    // 1. Create Event
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Teater Musikal Jakarta',
        ticket_types: [
          { name: 'REGULAR', price: 100000, quota: 50 },
          { name: 'VIP', price: 200000, quota: 50 },
        ],
      });

    const event = createEventRes.body.data;
    const regType = event.ticket_types.find((t: any) => t.name === 'REGULAR');
    const vipType = event.ticket_types.find((t: any) => t.name === 'VIP');
    const buyer = 'budi@example.com';

    // 2. Reject single order of 5 tickets (Rule 3: 1-4 per order)
    const orderTooBig = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 5 }],
      });
    expect(orderTooBig.status).toBe(400);
    expect(orderTooBig.body.error).toMatch(/between 1 and 4/i);

    // 3. Buyer successfully orders 3 REGULAR tickets
    const order1 = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 3 }],
      });
    expect(order1.status).toBe(201);

    // 4. Buyer attempts to order 2 VIP tickets in a second order (total would be 5) -> REJECTED
    const order2 = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 2 }],
      });
    expect(order2.status).toBe(400);
    expect(order2.body.error).toMatch(/Maximum 4 tickets per buyer/i);

    // 5. Buyer orders 1 VIP ticket (total becomes exactly 4) -> SUCCEEDS
    const order3 = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 1 }],
      });
    expect(order3.status).toBe(201);

    // 6. Pay order 1 (3 tickets) -> now 3 tickets are PAID, 1 is PENDING
    const pay1 = await request(app).post(`/api/orders/${order1.body.data.id}/pay`);
    expect(pay1.status).toBe(200);

    // 7. Buyer attempts to order 1 more ticket -> STILL REJECTED (total active/paid is 4)
    const order4 = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 1 }],
      });
    expect(order4.status).toBe(400);

    // 8. Buyer cancels order 3 (the 1 pending ticket) -> now only 3 tickets are paid
    const cancelRes = await request(app)
      .post(`/api/orders/${order3.body.data.id}/cancel`)
      .send({ user_id: buyer });
    expect(cancelRes.status).toBe(200);

    // 9. Buyer can now order 1 more ticket! (3 paid + 1 pending = 4)
    const order5 = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyer,
        event_id: event.id,
        items: [{ ticket_type_id: vipType.id, quantity: 1 }],
      });
    expect(order5.status).toBe(201);
  });
});
