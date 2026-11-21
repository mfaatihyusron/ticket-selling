import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/pool';
import { CreateEventInput } from './events.schema';

export interface TicketTypeOutput {
  id: string;
  name: string;
  price: number;
  total_quota: number;
  reserved_quota: number;
  sold_quota: number;
  available_quota: number;
}

export interface EventOutput {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  ticket_types: TicketTypeOutput[];
}

export class EventsService {
  async createEvent(input: CreateEventInput): Promise<EventOutput> {
    const db = getDb();
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const eventId = uuidv4();
      await client.query(
        'INSERT INTO events (id, title, description) VALUES ($1, $2, $3)',
        [eventId, input.title, input.description || null]
      );

      const ticketTypes: TicketTypeOutput[] = [];

      for (const t of input.ticket_types) {
        const ticketTypeId = uuidv4();
        await client.query(
          `INSERT INTO ticket_types (id, event_id, name, price, total_quota, reserved_quota, sold_quota)
           VALUES ($1, $2, $3, $4, $5, 0, 0)`,
          [ticketTypeId, eventId, t.name, t.price, t.quota]
        );

        ticketTypes.push({
          id: ticketTypeId,
          name: t.name,
          price: t.price,
          total_quota: t.quota,
          reserved_quota: 0,
          sold_quota: 0,
          available_quota: t.quota,
        });
      }

      await client.query('COMMIT');

      return {
        id: eventId,
        title: input.title,
        description: input.description || null,
        created_at: new Date().toISOString(),
        ticket_types: ticketTypes,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllEvents(): Promise<EventOutput[]> {
    const db = getDb();
    const eventsResult = await db.query(
      'SELECT id, title, description, created_at FROM events ORDER BY created_at DESC'
    );

    const ticketTypesResult = await db.query(
      'SELECT id, event_id, name, price, total_quota, reserved_quota, sold_quota FROM ticket_types ORDER BY price ASC'
    );

    const ticketTypesByEvent = new Map<string, TicketTypeOutput[]>();

    for (const row of ticketTypesResult.rows) {
      const available = row.total_quota - row.reserved_quota - row.sold_quota;
      const item: TicketTypeOutput = {
        id: row.id,
        name: row.name,
        price: parseFloat(row.price),
        total_quota: row.total_quota,
        reserved_quota: row.reserved_quota,
        sold_quota: row.sold_quota,
        available_quota: Math.max(0, available),
      };

      if (!ticketTypesByEvent.has(row.event_id)) {
        ticketTypesByEvent.set(row.event_id, []);
      }
      ticketTypesByEvent.get(row.event_id)!.push(item);
    }

    return eventsResult.rows.map((ev) => ({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      created_at: ev.created_at,
      ticket_types: ticketTypesByEvent.get(ev.id) || [],
    }));
  }

  async getEventById(id: string): Promise<EventOutput | null> {
    const db = getDb();
    const eventResult = await db.query(
      'SELECT id, title, description, created_at FROM events WHERE id = $1',
      [id]
    );

    if (eventResult.rows.length === 0) {
      return null;
    }

    const ev = eventResult.rows[0];
    const ticketTypesResult = await db.query(
      'SELECT id, name, price, total_quota, reserved_quota, sold_quota FROM ticket_types WHERE event_id = $1 ORDER BY price ASC',
      [id]
    );

    const ticketTypes: TicketTypeOutput[] = ticketTypesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      total_quota: row.total_quota,
      reserved_quota: row.reserved_quota,
      sold_quota: row.sold_quota,
      available_quota: Math.max(0, row.total_quota - row.reserved_quota - row.sold_quota),
    }));

    return {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      created_at: ev.created_at,
      ticket_types: ticketTypes,
    };
  }
}

export const eventsService = new EventsService();
