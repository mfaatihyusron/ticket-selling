import { getDb } from '../../db/pool';
import { ordersService, OrderOutput, TicketOutput } from '../orders/orders.service';

export class UsersService {
  async getUserOrders(userId: string): Promise<OrderOutput[]> {
    const db = getDb();
    const ordersRes = await db.query(
      'SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const orders: OrderOutput[] = [];
    for (const row of ordersRes.rows) {
      const order = await ordersService.getOrderById(row.id);
      orders.push(order);
    }

    return orders;
  }

  async getUserTickets(userId: string): Promise<TicketOutput[]> {
    const db = getDb();
    const ticketsRes = await db.query(
      `SELECT t.id, t.ticket_code, t.ticket_type_id, tt.name AS ticket_type_name, 
              e.title AS event_title, t.issued_at
       FROM tickets t
       JOIN orders o ON t.order_id = o.id
       JOIN ticket_types tt ON t.ticket_type_id = tt.id
       JOIN events e ON o.event_id = e.id
       WHERE o.user_id = $1 AND o.status = 'PAID'
       ORDER BY t.issued_at DESC`,
      [userId]
    );

    return ticketsRes.rows.map((row) => ({
      id: row.id,
      ticket_code: row.ticket_code,
      ticket_type_id: row.ticket_type_id,
      ticket_type_name: row.ticket_type_name,
      event_title: row.event_title,
      issued_at: row.issued_at,
    }));
  }
}

export const usersService = new UsersService();
