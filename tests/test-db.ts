import { newDb } from 'pg-mem';
import { schemaSql } from '../src/db/schema';
import { setDb, IDatabase } from '../src/db/pool';
import crypto from 'crypto';

export async function setupTestDb(): Promise<IDatabase> {
  const mem = newDb();

  // Register gen_random_uuid in pg-mem
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
  });

  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();

  const dbWrapper: IDatabase = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    end: () => pool.end(),
  };

  await dbWrapper.query(schemaSql);
  setDb(dbWrapper);

  return dbWrapper;
}
