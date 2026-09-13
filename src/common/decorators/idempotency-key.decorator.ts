import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * The validation rule, exported separately from the decorator so it can be
 * tested directly rather than through Nest's parameter-factory plumbing.
 */
export function extractIdempotencyKey(ctx: ExecutionContext): string {
  const request = ctx.switchToHttp().getRequest<Request>();
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const key = value?.trim();

  if (!key) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'An Idempotency-Key header is required.',
    });
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_TOO_LONG',
      message: `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
    });
  }
  return key;
}

/**
 * Extracts and validates the Idempotency-Key header.
 *
 * A decorator rather than inline handler code so the rule is stated once, and
 * so the handler signature documents that the key is a required input rather
 * than an optional header the handler might forget to check.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  extractIdempotencyKey(ctx),
);
