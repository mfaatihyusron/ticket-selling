import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/pool';
import { config } from '../../config/env';
import { CreateOrderInput } from './orders.schema';

export interface OrderItemOutput {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  quantity: number;
  price_per_unit: number;
  subtotal: number;
}

export interface TicketOutput {
  id: string;
  ticket_code: string;
  ticket_type_id: string;
  ticket_type_name?: string;
  issued_at: string;
}

export interface OrderOutput {
  id: string;
  user_id: string;
  event_id: string;
  event_title?: string;
  total_amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
  updated_at: string;
  items: OrderItemOutput[];
  tickets?: TicketOutput[];
}

export class OrdersService {
  /**
   * Creates an order with strict concurrency controls:
   * 1. Validates total order quantity (1-4 tickets per order).
   * 2. Validates buyer limit (max 4 tickets per buyer per event across active/paid orders).
   * 3. Locks ticket_types rows with SELECT ... FOR UPDATE (ordered by ID to prevent deadlocks).
   * 4. Deducts reserved_quota atomically.
   */
  async createOrder(input: CreateOrderInput): Promise<OrderOutput> {
    const totalRequestedQty = input.items.reduce((sum, item) => sum + item.quantity, 0);

    if (totalRequestedQty < 1 || totalRequestedQty > 4) {
      const err = new Error('Order quantity must be between 1 and 4 tickets in total.');
      (err as any).statusCode = 400;
      throw err;
    }

    const db = getDb();
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Verify Event exists
      const eventRes = await client.query('SELECT id, title FROM events WHERE id = $1', [input.event_id]);
      if (eventRes.rows.length === 0) {
        const err = new Error('Event not found.');
        (err as any).statusCode = 404;
        throw err;
      }
      const event = eventRes.rows[0];

      // 2. Check buyer's existing ticket limit (max 4 per event across active/paid orders)
      const now = new Date();
      const buyerLimitRes = await client.query(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS total_buyer_tickets
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         WHERE o.user_id = $1 
           AND o.event_id = $2
           AND (o.status = 'PAID' OR (o.status = 'PENDING' AND o.expires_at > $3))`,
        [input.user_id, input.event_id, now]
      );

      const existingBuyerTickets = parseInt(buyerLimitRes.rows[0].total_buyer_tickets, 10);
      if (existingBuyerTickets + totalRequestedQty > 4) {
        const err = new Error(
          `Buyer quota exceeded. Maximum 4 tickets per buyer per event. Current active/paid: ${existingBuyerTickets}, requested: ${totalRequestedQty}.`
        );
        (err as any).statusCode = 400;
        throw err;
      }

      // 3. Sort item ticket_types by ID to prevent circular deadlock during concurrent locking
      const sortedItems = [...input.items].sort((a, b) =>
        a.ticket_type_id.localeCompare(b.ticket_type_id)
      );

      let totalAmount = 0;
      const orderItemsToInsert: Array<{
        id: string;
        ticket_type_id: string;
        ticket_type_name: string;
        quantity: number;
        price_per_unit: number;
        subtotal: number;
      }> = [];

      // 4. Atomically check and reserve quota using conditional atomic update (Atomic & Race-Condition Proof)
      for (const item of sortedItems) {
        const updateRes = await client.query(
          `UPDATE ticket_types 
           SET reserved_quota = reserved_quota + CAST($1 AS int) 
           WHERE id = $2 AND event_id = $3 AND (total_quota - reserved_quota - sold_quota) >= CAST($1 AS int)
           RETURNING id, name, price, total_quota, reserved_quota, sold_quota`,
          [item.quantity, item.ticket_type_id, input.event_id]
        );

        if (updateRes.rows.length === 0) {
          // If no row was updated, determine if ticket_type doesn't exist or quota is exhausted
          const existsRes = await client.query(
            'SELECT name, total_quota, reserved_quota, sold_quota FROM ticket_types WHERE id = $1 AND event_id = $2',
            [item.ticket_type_id, input.event_id]
          );

          if (existsRes.rows.length === 0) {
            const err = new Error(`Ticket type ${item.ticket_type_id} not found for this event.`);
            (err as any).statusCode = 404;
            throw err;
          }

          const tt = existsRes.rows[0];
          const available = Math.max(0, tt.total_quota - tt.reserved_quota - tt.sold_quota);
          const err = new Error(
            `Insufficient quota for ticket type '${tt.name}'. Available: ${available}, Requested: ${item.quantity}.`
          );
          (err as any).statusCode = 409; // Conflict / Out of Quota
          throw err;
        }

        const tt = updateRes.rows[0];
        const pricePerUnit = parseFloat(tt.price);
        const subtotal = pricePerUnit * item.quantity;
        totalAmount += subtotal;

        orderItemsToInsert.push({
          id: uuidv4(),
          ticket_type_id: item.ticket_type_id,
          ticket_type_name: tt.name,
          quantity: item.quantity,
          price_per_unit: pricePerUnit,
          subtotal,
        });
      }

      // 5. Insert order with 15-minute expiration
      const orderId = uuidv4();
      const expiresAt = new Date(Date.now() + config.orderExpiryMinutes * 60 * 1000);

      await client.query(
        `INSERT INTO orders (id, user_id, event_id, total_amount, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [orderId, input.user_id, input.event_id, totalAmount, expiresAt]
      );

      // 6. Insert order items
      for (const oi of orderItemsToInsert) {
        await client.query(
          `INSERT INTO order_items (id, order_id, ticket_type_id, quantity, price_per_unit)
           VALUES ($1, $2, $3, $4, $5)`,
          [oi.id, orderId, oi.ticket_type_id, oi.quantity, oi.price_per_unit]
        );
      }

      await client.query('COMMIT');

      return {
        id: orderId,
        user_id: input.user_id,
        event_id: input.event_id,
        event_title: event.title,
        total_amount: totalAmount,
        status: 'PENDING',
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: orderItemsToInsert,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Buyer cancels pending order before payment.
   * Immediately releases reserved quota.
   */
  async cancelOrder(orderId: string, userId?: string): Promise<OrderOutput> {
    const db = getDb();
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        'SELECT id, user_id, event_id, total_amount, status, expires_at, created_at, updated_at FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderRes.rows.length === 0) {
        const err = new Error('Order not found.');
        (err as any).statusCode = 404;
        throw err;
      }

      const order = orderRes.rows[0];

      if (userId && order.user_id !== userId) {
        const err = new Error('Unauthorized to cancel this order.');
        (err as any).statusCode = 403;
        throw err;
      }

      if (order.status !== 'PENDING') {
        const err = new Error(`Cannot cancel order with status '${order.status}'.`);
        (err as any).statusCode = 400;
        throw err;
      }

      // Check if already expired
      if (new Date(order.expires_at).getTime() <= Date.now()) {
        // Already expired, mark expired and release
        await client.query(
          "UPDATE orders SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [orderId]
        );
      } else {
        await client.query(
          "UPDATE orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [orderId]
        );
      }

      // Release reserved quota for all items
      const itemsRes = await client.query(
        'SELECT ticket_type_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      );

      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types 
           SET reserved_quota = GREATEST(0, reserved_quota - CAST($1 AS int)) 
           WHERE id = $2`,
          [item.quantity, item.ticket_type_id]
        );
      }

      await client.query('COMMIT');

      return await this.getOrderById(orderId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves order by ID with lazy expiration check.
   */
  async getOrderById(orderId: string): Promise<OrderOutput> {
    const db = getDb();

    const orderRes = await db.query(
      `SELECT o.id, o.user_id, o.event_id, e.title AS event_title, o.total_amount, 
              o.status, o.expires_at, o.created_at, o.updated_at
       FROM orders o
       JOIN events e ON o.event_id = e.id
       WHERE o.id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      const err = new Error('Order not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    let order = orderRes.rows[0];

    // Lazy expiration check
    if (order.status === 'PENDING' && new Date(order.expires_at).getTime() <= Date.now()) {
      await this.expireSingleOrder(order.id);
      order.status = 'EXPIRED';
    }

    const itemsRes = await db.query(
      `SELECT oi.id, oi.ticket_type_id, tt.name AS ticket_type_name, 
              oi.quantity, oi.price_per_unit, (oi.quantity * oi.price_per_unit) AS subtotal
       FROM order_items oi
       JOIN ticket_types tt ON oi.ticket_type_id = tt.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const ticketsRes = await db.query(
      `SELECT t.id, t.ticket_code, t.ticket_type_id, tt.name AS ticket_type_name, t.issued_at
       FROM tickets t
       JOIN ticket_types tt ON t.ticket_type_id = tt.id
       WHERE t.order_id = $1`,
      [orderId]
    );

    return {
      id: order.id,
      user_id: order.user_id,
      event_id: order.event_id,
      event_title: order.event_title,
      total_amount: parseFloat(order.total_amount),
      status: order.status,
      expires_at: order.expires_at,
      created_at: order.created_at,
      updated_at: order.updated_at,
      items: itemsRes.rows.map((row) => ({
        id: row.id,
        ticket_type_id: row.ticket_type_id,
        ticket_type_name: row.ticket_type_name,
        quantity: row.quantity,
        price_per_unit: parseFloat(row.price_per_unit),
        subtotal: parseFloat(row.subtotal),
      })),
      tickets: ticketsRes.rows.map((row) => ({
        id: row.id,
        ticket_code: row.ticket_code,
        ticket_type_id: row.ticket_type_id,
        ticket_type_name: row.ticket_type_name,
        issued_at: row.issued_at,
      })),
    };
  }

  /**
   * Expires a single order and restores its reserved quota.
   */
  async expireSingleOrder(orderId: string): Promise<boolean> {
    const db = getDb();
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const res = await client.query(
        "SELECT id, status FROM orders WHERE id = $1 AND status = 'PENDING' FOR UPDATE",
        [orderId]
      );

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        "UPDATE orders SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [orderId]
      );

      const itemsRes = await client.query(
        'SELECT ticket_type_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      );

      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types 
           SET reserved_quota = GREATEST(0, reserved_quota - CAST($1 AS int)) 
           WHERE id = $2`,
          [item.quantity, item.ticket_type_id]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to expire single order ${orderId}:`, err);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Background sweeper to expire all overdue pending orders and restore quota.
   */
  async sweepExpiredOrders(): Promise<number> {
    const db = getDb();
    const expiredRes = await db.query(
      `SELECT id FROM orders 
       WHERE status = 'PENDING' AND expires_at <= $1 
       LIMIT 100`,
      [new Date()]
    );

    let count = 0;
    for (const row of expiredRes.rows) {
      const success = await this.expireSingleOrder(row.id);
      if (success) count++;
    }

    return count;
  }
}

export const ordersService = new OrdersService();
