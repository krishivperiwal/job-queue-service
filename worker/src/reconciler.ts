import pool from './db';
import { publishJob } from './sqs';
import { PoolClient } from 'pg';

const RECONCILE_INTERVAL_MS = 15_000;
const STALE_JOB_AGE_SECONDS = 30;
const STALE_PROCESSING_JOB_AGE_SECONDS = 180;
const RECONCILE_BATCH_SIZE = 20;

async function reconcilePendingJobs(): Promise<void> {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE status = 'pending'
         AND created_at < now() - interval '${STALE_JOB_AGE_SECONDS} seconds'
         AND next_attempt_at <= now()
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [RECONCILE_BATCH_SIZE]
    );

    for (const { id } of result.rows) {
      await publishJob(id);
      await client.query(
        `UPDATE jobs SET next_attempt_at = now() + interval '${STALE_PROCESSING_JOB_AGE_SECONDS} seconds' WHERE id = $1`,
        [id]
      );
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

async function reconcileProcessingJobs(): Promise<void> {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      `SELECT id FROM jobs
       WHERE status = 'processing' AND updated_at < now() - interval '${STALE_PROCESSING_JOB_AGE_SECONDS} seconds'
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [RECONCILE_BATCH_SIZE]
    );

    for (const { id } of result.rows) {
      await client.query(
        `UPDATE jobs
         SET status = 'pending', next_attempt_at = now(), updated_at = now()
         WHERE id = $1`,
        [id]
      );
      await publishJob(id);
      await client.query(
        `UPDATE jobs SET next_attempt_at = now() + interval '${STALE_PROCESSING_JOB_AGE_SECONDS} seconds' WHERE id = $1`,
        [id]
      );
      console.log(`Recovered stale processing job ${id}, reset to pending and republished`);
    }

    await client.query('COMMIT');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Processing job reconciliation rollback failed:', rollbackError);
      }
    }
    console.error('Processing job reconciliation failed:', err);
  } finally {
    client?.release();
  }
}

export function startReconciler(): NodeJS.Timeout {
  return setInterval(() => {
    void reconcilePendingJobs();
    void reconcileProcessingJobs();
  }, RECONCILE_INTERVAL_MS);
}