import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { setupTestDb } from '../test-db';

describe('End-to-End Order & Ticket Flow', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await setupTestDb();
    app = createApp();
  });

  it('completes the full flow: event creation -> order -> simulated payment -> unique ticket issuance', async () => {
    // 1. Create Event with 2 Ticket Types (Rule 1)
    const createEventRes = await request(app)
      .post('/api/events')
      .send({
        title: 'Festival Musik Nusantara 2026',
        description: 'Konser musik spektakuler akhir tahun',
        ticket_types: [
          { name: 'REGULAR', price: 100000, quota: 70 },
          { name: 'VIP', price: 250000, quota: 30 },
        ],
      });

    expect(createEventRes.status).toBe(201);
    expect(createEventRes.body.success).toBe(true);
    const event = createEventRes.body.data;
    const regType = event.ticket_types.find((t: any) => t.name === 'REGULAR');
    const vipType = event.ticket_types.find((t: any) => t.name === 'VIP');
    expect(regType.available_quota).toBe(70);
    expect(vipType.available_quota).toBe(30);

    // 2. Buyer views events and quota (Rule 2)
    const getEventsRes = await request(app).get('/api/events');
    expect(getEventsRes.status).toBe(200);
    expect(getEventsRes.body.data.length).toBeGreaterThanOrEqual(1);

    // 3. Buyer creates an order of 2 REGULAR tickets (Rule 3)
    const buyerId = 'buyer.satu@example.com';
    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        user_id: buyerId,
        event_id: event.id,
        items: [{ ticket_type_id: regType.id, quantity: 2 }],
      });

    if (orderRes.status !== 201) {
      console.error('Order creation error:', orderRes.body);
    }

    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;
    expect(order.status).toBe('PENDING');
    expect(order.total_amount).toBe(200000);
    expect(order.items[0].quantity).toBe(2);

    // Quota check: available REGULAR quota should now be 68
    const eventAfterOrder = await request(app).get(`/api/events/${event.id}`);
    const regAfterOrder = eventAfterOrder.body.data.ticket_types.find((t: any) => t.id === regType.id);
    expect(regAfterOrder.available_quota).toBe(68);
    expect(regAfterOrder.reserved_quota).toBe(2);
    expect(regAfterOrder.sold_quota).toBe(0);

    // 4. Mark order as paid via simulation (Rule 6)
    const payRes = await request(app).post(`/api/orders/${order.id}/pay`);
    if (payRes.status !== 200) {
      console.error('Payment Error:', payRes.body);
    }
    expect(payRes.status).toBe(200);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.order.status).toBe('PAID');

    // 5. Verify unique tickets issued (Rule 7)
    expect(payRes.body.issued_tickets.length).toBe(2);
    const ticket1 = payRes.body.issued_tickets[0];
    const ticket2 = payRes.body.issued_tickets[1];
    expect(ticket1.ticket_code).not.toBe(ticket2.ticket_code);
    expect(ticket1.ticket_code).toMatch(/^TKT-REGU-/);

    // Quota check: reserved quota is now 0, sold quota is 2, available is still 68
    const eventAfterPay = await request(app).get(`/api/events/${event.id}`);
    const regAfterPay = eventAfterPay.body.data.ticket_types.find((t: any) => t.id === regType.id);
    expect(regAfterPay.available_quota).toBe(68);
    expect(regAfterPay.reserved_quota).toBe(0);
    expect(regAfterPay.sold_quota).toBe(2);

    // 6. Buyer views order history and tickets (Rule 8)
    const userOrdersRes = await request(app).get(`/api/users/${buyerId}/orders`);
    expect(userOrdersRes.status).toBe(200);
    expect(userOrdersRes.body.data.length).toBe(1);
    expect(userOrdersRes.body.data[0].tickets.length).toBe(2);

    const userTicketsRes = await request(app).get(`/api/users/${buyerId}/tickets`);
    expect(userTicketsRes.status).toBe(200);
    expect(userTicketsRes.body.data.length).toBe(2);

    // 7. Ensure order cannot issue tickets twice (Rule 7)
    const secondPayRes = await request(app).post(`/api/orders/${order.id}/pay`);
    expect(secondPayRes.status).toBe(200);
    // Total tickets in user history still exactly 2
    const userTicketsAfterSecondPay = await request(app).get(`/api/users/${buyerId}/tickets`);
    expect(userTicketsAfterSecondPay.body.data.length).toBe(2);
  });
});
