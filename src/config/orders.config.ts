import { registerAs } from '@nestjs/config';

export interface OrdersConfig {
  outbox: {
    pollIntervalMs: number;
    batchSize: number;
    claimTimeoutMs: number;
    maxAttempts: number;
    enabled: boolean;
  };
  sweeper: {
    /**
     * How long an order may sit in a non-terminal state before the sweeper
     * considers it stranded. Also doubles as the PENDING -> FAILED deadline.
     * Must comfortably exceed the worker's total retry budget
     * (ORDER_SAGA_ATTEMPTS x exponential ORDER_SAGA_BACKOFF_MS), or the sweeper
     * will terminate orders the worker is still legitimately retrying.
     */
    staleAfterMs: number;
    leaseMs: number;
    batchSize: number;
    enabled: boolean;
  };
}

export const ordersConfig = registerAs(
  'orders',
  (): OrdersConfig => ({
    outbox: {
      pollIntervalMs: Number(process.env.ORDER_OUTBOX_POLL_INTERVAL_MS ?? 1000),
      batchSize: Number(process.env.ORDER_OUTBOX_BATCH_SIZE ?? 100),
      claimTimeoutMs: Number(process.env.ORDER_OUTBOX_CLAIM_TIMEOUT_MS ?? 30_000),
      maxAttempts: Number(process.env.ORDER_OUTBOX_MAX_ATTEMPTS ?? 10),
      enabled: (process.env.ORDER_OUTBOX_ENABLED ?? 'true').toLowerCase() === 'true',
    },
    sweeper: {
      staleAfterMs: Number(process.env.ORDER_STALE_AFTER_MS ?? 300_000),
      leaseMs: Number(process.env.ORDER_SWEEP_LEASE_MS ?? 60_000),
      batchSize: Number(process.env.ORDER_SWEEP_BATCH_SIZE ?? 50),
      enabled: (process.env.ORDER_SWEEPER_ENABLED ?? 'true').toLowerCase() === 'true',
    },
  }),
);
