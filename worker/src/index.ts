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

interface ImageValidationResult {
  content_type: string;
  content_length?: number;
}

async function requestImage(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw new Error('URL unreachable');
  } finally {
    clearTimeout(timeout);
  }
}

async function validateImageUrl(url: string): Promise<ImageValidationResult> {
  let response = await requestImage(url, 'HEAD');

  if (response.status === 405 || response.status === 501) {
    response = await requestImage(url, 'GET');
    await response.body?.cancel();
  }

  if (!response.ok) {
    throw new Error(`URL returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType?.startsWith('image/')) {
    throw new Error(`Not an image (got ${contentType || 'unknown content type'})`);
  }

  const contentLength = response.headers.get('content-length');
  const result: ImageValidationResult = { content_type: contentType };
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength)) {
      result.content_length = parsedLength;
    }
  }

  return result;
}

async function markCompleted(jobId: string, result: ImageValidationResult): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'completed', result = $2, updated_at = now() WHERE id = $1`,
    [jobId, JSON.stringify(result)]
  );
  await decrementQueueDepth();
}

async function markFailed(jobId: string, message: string, isFinal: boolean): Promise<void> {
  await query(
    `UPDATE jobs
     SET status = $2,
         error_message = $3,
         next_attempt_at = CASE WHEN $2 = 'pending' THEN now() + interval '180 seconds' ELSE now() END,
         updated_at = now()
     WHERE id = $1`,
    [jobId, isFinal ? 'failed' : 'pending', message]
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

            if (typeof job.payload.source_url !== 'string') {
              throw new Error('URL unreachable');
            }

            const validationResult = await validateImageUrl(job.payload.source_url);
            await markCompleted(job.id, validationResult);
            await deleteMessage(message.ReceiptHandle);
            console.log(`Job ${job.id} completed`);
          } catch (err) {
            const errMessage = err instanceof Error ? err.message : 'unknown error';
            const isFinal = job.attempts >= job.max_attempts;
            await markFailed(job.id, errMessage, isFinal);

            if (isFinal) {
              console.error(`Job ${job.id} exhausted all ${job.max_attempts} attempts — SQS will move it to the DLQ`);
            } else {
              console.warn(`Job ${job.id} failed (attempt ${job.attempts}/${job.max_attempts}) — SQS will retry after the visibility timeout: ${errMessage}`);
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