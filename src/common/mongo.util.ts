/**
 * Duplicate-key (E11000) detection, narrowed to a specific indexed field.
 *
 * The narrowing matters: `acceptOrder` writes to two collections in one
 * transaction, and "the idempotency key already exists" (a normal, expected
 * race we resolve by returning the winner) must never be confused with a
 * duplicate on the outbox index (a genuine bug that must surface).
 */
export function isDuplicateKeyError(error: unknown, field?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: number; keyPattern?: Record<string, unknown> };
  if (candidate.code !== 11000) return false;
  if (!field) return true;
  return candidate.keyPattern !== undefined && field in candidate.keyPattern;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}
