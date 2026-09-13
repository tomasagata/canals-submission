import { describe, expect, it } from 'vitest';
import { getErrorMessage, isDuplicateKeyError } from './mongo.util.js';

describe('isDuplicateKeyError', () => {
  const dupOnIdempotencyKey = {
    code: 11000,
    keyPattern: { customerId: 1, idempotencyKey: 1 },
  };

  it('recognises a duplicate on a compound index containing the named field', () => {
    expect(isDuplicateKeyError(dupOnIdempotencyKey, 'idempotencyKey')).toBe(true);
    expect(isDuplicateKeyError(dupOnIdempotencyKey, 'customerId')).toBe(true);
  });

  /**
   * The whole reason the field argument exists: acceptOrder writes to two
   * collections in one transaction, and only a collision on the idempotency key
   * may be reinterpreted as "a concurrent request won". A duplicate anywhere
   * else is a genuine bug and must keep propagating.
   */
  it('does not match a duplicate on a different index', () => {
    expect(isDuplicateKeyError({ code: 11000, keyPattern: { aggregateId: 1, eventType: 1 } }, 'idempotencyKey')).toBe(
      false,
    );
  });

  it('matches any duplicate when no field is named', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('ignores errors that are not duplicate-key errors', () => {
    expect(isDuplicateKeyError({ code: 251 }, 'idempotencyKey')).toBe(false);
    expect(isDuplicateKeyError(new Error('boom'), 'idempotencyKey')).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });

  it('does not match a named field when the error carries no keyPattern', () => {
    expect(isDuplicateKeyError({ code: 11000 }, 'idempotencyKey')).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('extracts a message from the shapes a driver actually throws', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('boom')).toBe('boom');
    expect(getErrorMessage({ message: 'boom' })).toBe('boom');
    expect(getErrorMessage(42)).toBe('An unexpected error occurred');
  });
});
