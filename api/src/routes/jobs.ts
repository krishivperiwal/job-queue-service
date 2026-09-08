import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { query } from '../db';
import { enqueueJob } from '../sqs';
import { redis } from '../redis';

const router = Router();

const createJobSchema = z.object({
  job_type: z.literal('image_thumbnail'),
  payload: z.object({
    source_url: z.string().url(),
    sizes: z.array(z.number().int().positive()).min(1),
    force_fail: z.boolean().optional(),
  }),
});

router.post('/jobs', async (req: Request, res: Response) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_payload',
      details: parsed.error.flatten(),
    });
  }

  const { job_type, payload } = parsed.data;
  const id = randomUUID();

  const rows = await query(
    `INSERT INTO jobs (id, job_type, payload, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id, job_type, status, created_at`,
    [id, job_type, payload]
  );

  await enqueueJob(id);
  await redis.incr('jobs:pending_count');

  return res.status(201).json(rows[0]);
});

router.get('/queue-depth', async (_req: Request, res: Response) => {
  const count = await redis.get('jobs:pending_count');
  res.json({ pending: Number(count ?? 0) });
});

router.get('/jobs', async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT id, job_type, status, attempts, max_attempts, error_message, created_at, updated_at
     FROM jobs ORDER BY created_at DESC LIMIT 50`
  );
  res.json(rows);
});

router.post('/jobs/:id/replay', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (Array.isArray(id)) {
    return res.status(400).json({ error: 'invalid_job_id' });
  }

  const rows = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'job_not_found' });
  }
  if (rows[0].status !== 'failed') {
    return res.status(400).json({ error: 'only_failed_jobs_can_be_replayed' });
  }

  await query(
    `UPDATE jobs SET status = 'pending', attempts = 0, error_message = NULL, next_attempt_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  );
  await enqueueJob(id);
  await redis.incr('jobs:pending_count');

  res.json({ replayed: true, id });
});

router.get('/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const rows = await query(
    `SELECT id, job_type, status, attempts, max_attempts,
            result, error_message, created_at, updated_at
     FROM jobs WHERE id = $1`,
    [id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'job_not_found' });
  }

  return res.json(rows[0]);
});

export default router;