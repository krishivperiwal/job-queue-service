import { Pool } from 'pg';
import { Job } from './types';

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

export async function claimJob(jobId: string): Promise<Job | null> {
  const rows = await query<Job>(
    `UPDATE jobs
     SET status = 'processing', updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    [jobId]
  );

  return rows[0] ?? null;
}

export default pool;