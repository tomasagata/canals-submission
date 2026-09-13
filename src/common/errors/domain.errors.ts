/**
 * Domain errors carry a machine-readable code and map to an HTTP status in
 * exactly one place (DomainExceptionFilter). Services throw these; they never
 * reach for HttpException, so they stay testable outside an HTTP context.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request is well-formed but cannot be turned into an order. */
export class UnprocessableOrderError extends DomainError {
  readonly status = 422;
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * The same Idempotency-Key was replayed with a different request body. Without
 * this check the caller would silently receive an unrelated order.
 */
export class IdempotencyKeyReuseError extends DomainError {
  readonly status = 422;
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor(readonly existingOrderId: string) {
    super(
      'This Idempotency-Key was already used for a different request body. ' +
        'Use a new key for a new order, or replay the original request exactly.',
    );
  }
}

/**
 * A concurrent request with the same key is mid-flight and has not yet
 * committed, so there is no order to return yet.
 *
 * This is the one place a 409 is the honest answer: we know the caller's order
 * is being created, but we cannot yet say by whom or with what id. It is rare
 * (it needs a collision inside the commit window) and always resolves on retry.
 */
export class ConcurrentRequestError extends DomainError {
  readonly status = 409;
  readonly code = 'REQUEST_IN_PROGRESS';
  constructor() {
    super('A request with this Idempotency-Key is currently being processed. Retry in a moment.');
  }
}

export class OrderNotFoundError extends DomainError {
  readonly status = 404;
  readonly code = 'ORDER_NOT_FOUND';
  constructor(orderId: string) {
    super(`Order ${orderId} not found.`);
  }
}
