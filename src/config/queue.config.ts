import { registerAs } from '@nestjs/config';

export interface QueueConfig {
  redisUri: string;
  concurrency: number;
  attempts: number;
  backoffMs: number;
  workerEnabled: boolean;
}

export const queueConfig = registerAs(
  'queue',
  (): QueueConfig => ({
    redisUri: process.env.REDIS_URI ?? 'redis://127.0.0.1:6379',
    concurrency: Number(process.env.ORDER_SAGA_CONCURRENCY ?? 5),
    attempts: Number(process.env.ORDER_SAGA_ATTEMPTS ?? 5),
    backoffMs: Number(process.env.ORDER_SAGA_BACKOFF_MS ?? 1000),
    workerEnabled: (process.env.ORDER_SAGA_WORKER_ENABLED ?? 'true').toLowerCase() === 'true',
  }),
);
