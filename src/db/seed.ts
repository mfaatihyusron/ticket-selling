import { v4 as uuidv4 } from 'uuid';
import { getDb } from './pool';
import { runMigrations } from './migrate';

export async function seedDatabase() {
  await runMigrations();
  const db = getDb();

  console.log('Seeding demo event and ticket types...');

  // Check if demo event already exists
  const existing = await db.query('SELECT id FROM events WHERE title = $1 LIMIT 1', [
    'Tech Fest 2026: The Future of AI',
  ]);

  if (existing.rows.length > 0) {
    console.log('Seed data already present. Skipping.');
    return existing.rows[0].id;
  }

  const eventId = uuidv4();
  await db.query(
    'INSERT INTO events (id, title, description) VALUES ($1, $2, $3)',
    [
      eventId,
      'Tech Fest 2026: The Future of AI',
      'Konferensi teknologi tahunan dengan kuota terbatas dan pembicara internasional.',
    ]
  );

  const regId = uuidv4();
  const vipId = uuidv4();

  // Create two ticket types: Reguler (70 kuota) and VIP (30 kuota) = Total 100
  await db.query(
    `INSERT INTO ticket_types (id, event_id, name, price, total_quota, reserved_quota, sold_quota)
     VALUES 
       ($1, $2, 'REGULAR', 150000.00, 70, 0, 0),
       ($3, $2, 'VIP', 350000.00, 30, 0, 0)`,
    [regId, eventId, vipId]
  );

  console.log(`Seeded event successfully! Event ID: ${eventId}`);
  console.log(`- REGULAR Ticket Type ID: ${regId} (70 tickets @ Rp 150.000)`);
  console.log(`- VIP Ticket Type ID: ${vipId} (30 tickets @ Rp 350.000)`);

  return eventId;
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
