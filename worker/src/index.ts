import 'dotenv/config';
import { claimJob, query } from './db';
import { receiveOneMessage, deleteMessage } from './sqs';
import { startReconciler } from './reconciler';

const MAX_RECEIVE_COUNT = 3; // must match the "Maximum receives" set on the DLQ redrive policy in AWS

async function markCompleted(jobId: string): Promise<void> {
  await query(
    `UPDATE jobs SET status = 'completed', result = $2, updated_at = now() WHERE id = $1`,
    [jobId, JSON.stringify({ note: 'simulated processing, no real thumbnail yet' })]
  );
}

async function markFailed(jobId: string, attempts: number, message: string, isFinal: boolean): Promise<void> {
  await query(
    `UPDATE jobs SET status = $4, attempts = $2, error_message = $3, updated_at = now() WHERE id = $1`,
    [jobId, attempts, message, isFinal ? 'failed' : 'processing']
  );
}

async function pollLoop() {
  const message = await receiveOneMessage();

  if (message && message.Body && message.ReceiptHandle) {
    const { job_id } = JSON.parse(message.Body) as { job_id: string };
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');

    const job = await claimJob(job_id);

    if (!job) {
      console.log(`Job ${job_id} was already claimed or finished — deleting duplicate message`);
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

  setTimeout(pollLoop, 500);
}

console.log('Worker started, polling SQS for jobs...');
startReconciler();
pollLoop();