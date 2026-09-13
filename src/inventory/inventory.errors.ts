/**
 * Business failures from the warehouse side of the saga. These are terminal:
 * retrying will not conjure stock, so the saga must fail the order rather than
 * let the queue retry. Infrastructure errors are deliberately NOT modelled
 * here - they propagate as-is so the queue does retry them.
 */
export class NoWarehouseAvailableError extends Error {
  constructor() {
    super('No warehouse found with sufficient stock for the requested products.');
    this.name = 'NoWarehouseAvailableError';
  }
}

export class InsufficientStockError extends Error {
  constructor(public readonly productId: string) {
    super(`Insufficient stock for product ${productId}.`);
    this.name = 'InsufficientStockError';
  }
}
