import { Pool } from 'pg';

const useSSL = process.env.DATABASE_URL?.includes('rds.amazonaws.com');
console.log('DB SSL config check:', { useSSL, dbUrlPresent: !!process.env.DATABASE_URL });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_URL?.includes('rds.amazonaws.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
    process.exit(1);
});

export async function query<T = unknown>(
    text: string,
    params?: unknown[]
): Promise<T[]> {
    const result = await pool.query(text, params);
    return result.rows;
}

export default pool;