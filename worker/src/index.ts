import 'dotenv/config';
import Redis from 'ioredis';
import { claimJob, query } from './db';
import { receiveOneMessage, deleteMessage } from './sqs';
import { startReconciler } from './reconciler';

const REQUIRED_ENV_VARS = ['AWS_REGION', 'SQS_QUEUE_URL', 'DATABASE_URL', 'REDIS_URL'] as const;
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const MAX_RECEIVE_COUNT = 3; // must match the "Maximum receives" set on the DLQ redrive policy in AWS
const redis = new Redis(process.env.REDIS_URL!);

async function decrementQueueDepth(): Promise<void> {
  try {
    await redis.decr('jobs:pending_count');
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to decrement Redis queue depth:`, err);
  }
}

async function markCompleted(jobId: string): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'completed', result = $2, updated_at = now() WHERE id = $1`,
    [jobId, JSON.stringify({ note: 'simulated processing, no real thumbnail yet' })]
  );
  await decrementQueueDepth();
}

async function markFailed(jobId: string, attempts: number, message: string, isFinal: boolean): Promise<void> {
  await query(
    `UPDATE jobs SET status = $4, attempts = $2, error_message = $3, updated_at = now() WHERE id = $1`,
    [jobId, attempts, message, isFinal ? 'failed' : 'processing']
  );

  if (isFinal) {
    await decrementQueueDepth();
  }
}

async function pollLoop() {
  let nextDelayMs = 500;

  try {
    const message = await receiveOneMessage();

    if (message && message.Body && message.ReceiptHandle) {
      let jobId: string | undefined;

      try {
        const parsed = JSON.parse(message.Body) as { job_id?: unknown };
        if (typeof parsed.job_id !== 'string' || !parsed.job_id.trim()) {
          throw new Error('message does not contain a valid job_id');
        }
        jobId = parsed.job_id;
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Malformed SQS message:`, {
          body: message.Body,
          error: err instanceof Error ? err.message : String(err),
        });
        await deleteMessage(message.ReceiptHandle);
      }

      if (jobId) {
        const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
        const job = await claimJob(jobId);

        if (!job) {
          console.log(`Job ${jobId} was already claimed or finished — deleting duplicate message`);
          await deleteMessage(message.ReceiptHandle);
        } else {
          console.log(`Processing job ${job.id} (SQS attempt ${receiveCount}/${MAX_RECEIVE_COUNT})`, job.payload);

          try {
            if (job.payload.force_fail) {
              throw new Error('Simulated failure (force_fail was set in payload)');
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            await markCompleted(job.id);
            await deleteMessage(message.ReceiptHandle);
            console.log(`Job ${job.id} completed`);
          } catch (err) {
            const errMessage = err instanceof Error ? err.message : 'unknown error';
            const isFinal = receiveCount >= MAX_RECEIVE_COUNT;
            await markFailed(job.id, receiveCount, errMessage, isFinal);

            if (isFinal) {
              console.error(`Job ${job.id} exhausted all ${MAX_RECEIVE_COUNT} attempts — SQS will move it to the DLQ`);
            } else {
              console.warn(`Job ${job.id} failed (attempt ${receiveCount}/${MAX_RECEIVE_COUNT}) — SQS will retry after the visibility timeout: ${errMessage}`);
            }
            // Deliberately NOT calling deleteMessage here — leaving the message undeleted is what lets
            // SQS make it visible again after the visibility timeout for a retry, and automatically move
            // it to the DLQ once ApproximateReceiveCount exceeds the redrive policy's max.
          }
        }
      }
    }
  } catch (err) {
    nextDelayMs = 3000;
    console.error(`[${new Date().toISOString()}] Worker polling error:`, err instanceof Error ? err.message : String(err));
  }

  setTimeout(pollLoop, nextDelayMs);
}

console.log('Worker started, polling SQS for jobs...');
startReconciler();
pollLoop();