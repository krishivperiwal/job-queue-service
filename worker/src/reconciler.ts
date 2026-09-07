import pool from './db';
import { publishJob } from './sqs';
import { PoolClient } from 'pg';

const RECONCILE_INTERVAL_MS = 15_000;
const STALE_JOB_AGE_SECONDS = 30;
const RECONCILE_BATCH_SIZE = 20;

async function reconcilePendingJobs(): Promise<void> {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE status = 'pending' AND created_at < now() - interval '${STALE_JOB_AGE_SECONDS} seconds'
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [RECONCILE_BATCH_SIZE]
    );

    for (const { id } of result.rows) {
      await publishJob(id);
      console.log(`Republished stale pending job ${id}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Pending job reconciliation rollback failed:', rollbackError);
      }
    }
    console.error('Pending job reconciliation failed:', err);
  } finally {
    client?.release();
  }
}

export function startReconciler(): NodeJS.Timeout {
  return setInterval(() => {
    void reconcilePendingJobs();
  }, RECONCILE_INTERVAL_MS);
}