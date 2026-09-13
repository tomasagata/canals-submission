import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Environment contract. Validated once at boot so a typo'd or out-of-range
 * value fails the process immediately, rather than silently becoming NaN
 * inside a cron job at 3am (which is exactly what the previous
 * `Number(process.env.X ?? default)` reads did).
 */

const toNumber = () => Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)));
const toBool = () =>
  Transform(({ value }) => (value === undefined || value === '' ? undefined : String(value).toLowerCase() === 'true'));

export class EnvironmentVariables {
  @IsString()
  MONGO_URI: string;

  @IsOptional() @IsString()
  REDIS_URI: string = 'redis://127.0.0.1:6379';

  @IsOptional() @toNumber() @IsInt()
  PORT: number = 3000;

  @IsOptional() @toNumber() @IsInt()
  GEOHASH_PRECISION: number = 6;

  // --- Outbox relay ---
  @IsOptional() @toNumber() @IsInt() @Min(50)
  ORDER_OUTBOX_POLL_INTERVAL_MS: number = 1000;

  @IsOptional() @toNumber() @IsInt() @Min(1)
  ORDER_OUTBOX_BATCH_SIZE: number = 100;

  @IsOptional() @toNumber() @IsInt() @Min(1000)
  ORDER_OUTBOX_CLAIM_TIMEOUT_MS: number = 30_000;

  @IsOptional() @toNumber() @IsInt() @Min(1)
  ORDER_OUTBOX_MAX_ATTEMPTS: number = 10;

  @IsOptional() @toBool() @IsBoolean()
  ORDER_OUTBOX_ENABLED: boolean = true;

  // --- Saga worker ---
  @IsOptional() @toNumber() @IsInt() @Min(1)
  ORDER_SAGA_CONCURRENCY: number = 5;

  @IsOptional() @toNumber() @IsInt() @Min(1)
  ORDER_SAGA_ATTEMPTS: number = 5;

  @IsOptional() @toNumber() @IsInt() @Min(100)
  ORDER_SAGA_BACKOFF_MS: number = 1000;

  @IsOptional() @toBool() @IsBoolean()
  ORDER_SAGA_WORKER_ENABLED: boolean = true;

  // --- Reconciliation sweeper ---
  @IsOptional() @toNumber() @IsInt() @Min(1000)
  ORDER_STALE_AFTER_MS: number = 300_000;

  @IsOptional() @toNumber() @IsInt() @Min(1000)
  ORDER_SWEEP_LEASE_MS: number = 60_000;

  @IsOptional() @toNumber() @IsInt() @Min(1)
  ORDER_SWEEP_BATCH_SIZE: number = 50;

  @IsOptional() @toBool() @IsBoolean()
  ORDER_SWEEPER_ENABLED: boolean = true;

  // --- PSP fault injection (demo/testing only) ---
  @IsOptional() @toNumber() @IsInt() @Min(0)
  PAYMENT_LATENCY_MS: number = 0;

  @IsOptional() @toNumber() @IsNumber() @Min(0) @Max(1)
  PAYMENT_FAILURE_RATE: number = 0;

  @IsOptional() @toNumber() @IsNumber() @Min(0) @Max(1)
  PAYMENT_LOST_RESPONSE_RATE: number = 0;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.map((e) => `  - ${e.toString()}`).join('\n')}`);
  }
  return validated;
}
