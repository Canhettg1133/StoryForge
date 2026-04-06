let poolInstance = null;
let bootstrapPromise = null;

export function hasPostgresDatabase() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export function requirePostgresDatabase(context = 'Postgres database access') {
  if (hasPostgresDatabase()) {
    return;
  }

  throw new Error(`${context} requires DATABASE_URL to be configured.`);
}

export async function getPostgresPool() {
  requirePostgresDatabase('Postgres pool');

  if (poolInstance) {
    return poolInstance;
  }

  const { Pool } = await import('pg');
  poolInstance = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'disable'
      ? false
      : { rejectUnauthorized: false },
  });

  return poolInstance;
}

export async function queryPostgres(text, params = []) {
  const pool = await getPostgresPool();
  return pool.query(text, params);
}

export async function withPostgresTransaction(callback) {
  const pool = await getPostgresPool();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensurePostgresBootstrapped(bootstrapFn) {
  if (!hasPostgresDatabase()) {
    return false;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = Promise.resolve().then(bootstrapFn);
  }

  await bootstrapPromise;
  return true;
}
