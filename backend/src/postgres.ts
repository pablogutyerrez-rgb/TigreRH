import pg from 'pg';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | undefined;

const getConnectionString = () => {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL no esta configurada.');

  const url = new URL(value);
  const localHost = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!localHost) {
    const sslMode = url.searchParams.get('sslmode');
    if (!sslMode || sslMode === 'require') {
      url.searchParams.set('sslmode', 'verify-full');
    }
  }
  return url.toString();
};

export const getPostgresPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString(),
      max: Number(process.env.PG_POOL_MAX || 5),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
};

export const closePostgresPool = async () => {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
};

