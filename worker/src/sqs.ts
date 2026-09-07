import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, Message, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const QUEUE_URL = process.env.SQS_QUEUE_URL!;

export async function publishJob(jobId: string): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ job_id: jobId }),
    })
  );
}

export async function receiveOneMessage(): Promise<Message | null> {
  const result = await sqs.send(
  new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 10,
    MessageSystemAttributeNames: ['ApproximateReceiveCount'],
  })
);
  return result.Messages?.[0] ?? null;
}

export async function deleteMessage(receiptHandle: string): Promise<void> {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: receiptHandle,
    })
  );
}