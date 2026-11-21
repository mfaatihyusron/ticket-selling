import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/pool';
import { ordersService, OrderOutput } from '../orders/orders.service';
import { WebhookPayload } from './payments.schema';

export interface PaymentProcessResult {
  success: boolean;
  message: string;
  code: 'PROCESSED' | 'ALREADY_PROCESSED' | 'ORDER_EXPIRED' | 'ORDER_CANCELLED' | 'INVALID_AMOUNT' | 'FAILED';
  order?: OrderOutput;
  issued_tickets?: Array<{ ticket_code: string; ticket_type_id: string }>;
}

export class PaymentsService {
  /**
   * Processes a payment webhook with strict idempotency and edge-case handling:
   * 1. Duplicate webhook delivery -> return idempotent cached response without duplicate tickets.
   * 2. Late webhook after 15 min expiry -> reject ticket generation, log event.
   * 3. Successful payment -> update order to PAID, move reserved_quota -> sold_quota, issue unique tickets.
   */
  async processPaymentWebhook(payload: WebhookPayload, rawPayload?: any): Promise<PaymentProcessResult> {
    const db = getDb();

    // 1. Check Idempotency by payment_reference
    const existingWebhookRes = await db.query(
      'SELECT id, payment_reference, order_id, status FROM payment_webhooks WHERE payment_reference = $1',
      [payload.payment_reference]
    );

    if (existingWebhookRes.rows.length > 0) {
      const existing = existingWebhookRes.rows[0];
      const existingOrder = await ordersService.getOrderById(existing.order_id);
      return {
        success: true,
        message: 'Webhook already processed (Idempotent replay detected).',
        code: 'ALREADY_PROCESSED',
        order: existingOrder,
        issued_tickets: existingOrder.tickets?.map((t) => ({
          ticket_code: t.ticket_code,
          ticket_type_id: t.ticket_type_id,
        })),
      };
    }

    if (payload.status === 'FAILED') {
      // Record failed payment
      await db.query(
        `INSERT INTO payment_webhooks (id, payment_reference, order_id, amount, status, raw_payload)
         VALUES ($1, $2, $3, $4, 'PAYMENT_FAILED', $5)`,
        [uuidv4(), payload.payment_reference, payload.order_id, payload.amount || 0, JSON.stringify(rawPayload || payload)]
      );
      return {
        success: false,
        message: 'Payment status was FAILED.',
        code: 'FAILED',
      };
    }

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 2. Lock Order row for update
      const orderRes = await client.query(
        'SELECT id, user_id, event_id, total_amount, status, expires_at FROM orders WHERE id = $1 FOR UPDATE',
        [payload.order_id]
      );

      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        const err = new Error('Order not found for given order_id.');
        (err as any).statusCode = 404;
        throw err;
      }

      const order = orderRes.rows[0];

      // Check if already paid (e.g. through alternate payment channel or simulation)
      if (order.status === 'PAID') {
        await client.query(
          `INSERT INTO payment_webhooks (id, payment_reference, order_id, amount, status, raw_payload)
           VALUES ($1, $2, $3, $4, 'ALREADY_PAID', $5)`,
          [uuidv4(), payload.payment_reference, order.id, parseFloat(order.total_amount), JSON.stringify(rawPayload || payload)]
        );
        await client.query('COMMIT');

        const existingOrder = await ordersService.getOrderById(order.id);
        return {
          success: true,
          message: 'Order is already marked as PAID.',
          code: 'ALREADY_PROCESSED',
          order: existingOrder,
          issued_tickets: existingOrder.tickets?.map((t) => ({
            ticket_code: t.ticket_code,
            ticket_type_id: t.ticket_type_id,
          })),
        };
      }

      // Check if order is CANCELLED
      if (order.status === 'CANCELLED') {
        await client.query(
          `INSERT INTO payment_webhooks (id, payment_reference, order_id, amount, status, raw_payload)
           VALUES ($1, $2, $3, $4, 'ORDER_CANCELLED_REJECTED', $5)`,
          [uuidv4(), payload.payment_reference, order.id, payload.amount || 0, JSON.stringify(rawPayload || payload)]
        );
        await client.query('COMMIT');

        return {
          success: false,
          message: 'Payment rejected: Order has already been CANCELLED by buyer. Quota was released.',
          code: 'ORDER_CANCELLED',
        };
      }

      // Check if order is EXPIRED or past expiration time (Late Webhook edge case)
      const isPastExpiry = new Date(order.expires_at).getTime() <= Date.now();
      if (order.status === 'EXPIRED' || isPastExpiry) {
        // If it was still marked PENDING in DB, transition it to EXPIRED and return reserved quota
        if (order.status === 'PENDING') {
          await client.query(
            "UPDATE orders SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            [order.id]
          );

          const itemsRes = await client.query(
            'SELECT ticket_type_id, quantity FROM order_items WHERE order_id = $1',
            [order.id]
          );

          for (const item of itemsRes.rows) {
            await client.query(
              `UPDATE ticket_types 
               SET reserved_quota = GREATEST(0, reserved_quota - $1) 
               WHERE id = $2`,
              [item.quantity, item.ticket_type_id]
            );
          }
        }

        // Record in payment_webhooks for audit & refund reconciliation
        await client.query(
          `INSERT INTO payment_webhooks (id, payment_reference, order_id, amount, status, raw_payload)
           VALUES ($1, $2, $3, $4, 'LATE_WEBHOOK_EXPIRED', $5)`,
          [uuidv4(), payload.payment_reference, order.id, payload.amount || 0, JSON.stringify(rawPayload || payload)]
        );

        await client.query('COMMIT');

        return {
          success: false,
          message: 'Payment rejected: Webhook arrived late after 15-minute order expiration. Quota was already released.',
          code: 'ORDER_EXPIRED',
        };
      }

      // 3. Valid Order in PENDING status - Process payment
      // Update order status to PAID
      await client.query(
        "UPDATE orders SET status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [order.id]
      );

      // Fetch items to update quota & issue tickets
      const itemsRes = await client.query(
        `SELECT oi.id, oi.ticket_type_id, tt.name AS ticket_type_name, oi.quantity, oi.price_per_unit
         FROM order_items oi
         JOIN ticket_types tt ON oi.ticket_type_id = tt.id
         WHERE oi.order_id = $1`,
        [order.id]
      );

      const issuedTickets: Array<{ id: string; ticket_code: string; ticket_type_id: string; ticket_type_name: string }> = [];

      for (const item of itemsRes.rows) {
        // Move quota atomically: decrement reserved_quota, increment sold_quota
        // Mathematical invariant: (reserved - qty) + (sold + qty) == original sum
        await client.query(
          `UPDATE ticket_types 
           SET reserved_quota = reserved_quota - CAST($1 AS int),
               sold_quota = sold_quota + CAST($1 AS int)
           WHERE id = $2 AND reserved_quota >= CAST($1 AS int)`,
          [item.quantity, item.ticket_type_id]
        );

        // Generate tickets for each quantity
        for (let i = 0; i < item.quantity; i++) {
          const ticketId = uuidv4();
          // Generate human-friendly & cryptographically random ticket code
          const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
          const cleanTypeName = item.ticket_type_name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
          const ticketCode = `TKT-${cleanTypeName}-${order.id.slice(0, 8).toUpperCase()}-${i + 1}-${randomSuffix}`;

          await client.query(
            `INSERT INTO tickets (id, order_id, ticket_type_id, ticket_code, issued_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [ticketId, order.id, item.ticket_type_id, ticketCode]
          );

          issuedTickets.push({
            id: ticketId,
            ticket_code: ticketCode,
            ticket_type_id: item.ticket_type_id,
            ticket_type_name: item.ticket_type_name,
          });
        }
      }

      // Record in payment_webhooks
      await client.query(
        `INSERT INTO payment_webhooks (id, payment_reference, order_id, amount, status, raw_payload)
         VALUES ($1, $2, $3, $4, 'PROCESSED', $5)`,
        [uuidv4(), payload.payment_reference, order.id, parseFloat(order.total_amount), JSON.stringify(rawPayload || payload)]
      );

      await client.query('COMMIT');

      const updatedOrder = await ordersService.getOrderById(order.id);

      return {
        success: true,
        message: 'Payment processed successfully and tickets issued.',
        code: 'PROCESSED',
        order: updatedOrder,
        issued_tickets: issuedTickets,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Helper to simulate payment directly for an order (Rule 6).
   */
  async simulatePayment(orderId: string): Promise<PaymentProcessResult> {
    const paymentRef = `SIM-PAY-${orderId.slice(0, 8)}-${Date.now()}`;
    return this.processPaymentWebhook({
      payment_reference: paymentRef,
      order_id: orderId,
      status: 'SUCCESS',
    });
  }
}

export const paymentsService = new PaymentsService();
