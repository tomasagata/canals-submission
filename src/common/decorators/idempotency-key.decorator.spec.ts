import { describe, expect, it } from 'vitest';
import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { extractIdempotencyKey, MAX_IDEMPOTENCY_KEY_LENGTH } from './idempotency-key.decorator.js';

function contextWith(headers: Record<string, string | string[]>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('extractIdempotencyKey', () => {
  it('extracts and trims a valid key', () => {
    expect(extractIdempotencyKey(contextWith({ 'idempotency-key': '  abc-123  ' }))).toBe('abc-123');
  });

  it('rejects a missing key', () => {
    expect(() => extractIdempotencyKey(contextWith({}))).toThrow(BadRequestException);
  });

  it('rejects a whitespace-only key', () => {
    expect(() => extractIdempotencyKey(contextWith({ 'idempotency-key': '   ' }))).toThrow(BadRequestException);
  });

  it('rejects an over-long key', () => {
    const tooLong = 'x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);
    expect(() => extractIdempotencyKey(contextWith({ 'idempotency-key': tooLong }))).toThrow(BadRequestException);
  });

  it('takes the first value when the header is repeated', () => {
    expect(extractIdempotencyKey(contextWith({ 'idempotency-key': ['first', 'second'] }))).toBe('first');
  });
});
