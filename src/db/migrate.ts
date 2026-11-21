import { getDb } from './pool';
import { schemaSql } from './schema';

export async function runMigrations() {
  console.log('[Migration] Running database migrations...');
  const db = getDb();
  await db.query(schemaSql);
  console.log('[Migration] Database migrations completed successfully.');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}
