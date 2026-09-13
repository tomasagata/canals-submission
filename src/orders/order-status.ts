/**
 * The order saga's state machine.
 *
 *             ┌─ FAILED (terminal; nothing was ever reserved)
 * PENDING ────┤
 *             └─ STOCK_RESERVED ─┬─ PAYMENT_AUTHORIZED ── COMPLETED (terminal)
 *                                └─ COMPENSATING ── COMPENSATED (terminal)
 *
 * Every transition is a compare-and-swap conditioned on the exact expected
 * prior status, so the worker and the reconciliation sweeper can act on the
 * same order concurrently: exactly one of them matches the document, the other
 * matches zero and performs no side effects.
 */
export enum OrderStatus {
  /** Accepted and durable. Nothing reserved, nothing charged. */
  PENDING = 'PENDING',
  /** Units decremented at a specific warehouse; `warehouseId` is now set. */
  STOCK_RESERVED = 'STOCK_RESERVED',
  /** The PSP holds a successful charge keyed on this order's id. */
  PAYMENT_AUTHORIZED = 'PAYMENT_AUTHORIZED',
  COMPLETED = 'COMPLETED',
  /**
   * Failed after reserving: a release is owed. Kept as an explicit, indexable
   * state rather than an implicit property of FAILED, so a process that dies
   * mid-release leaves visible evidence for the sweeper to act on.
   */
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
  /** Failed with nothing to undo. */
  FAILED = 'FAILED',
}

export const ORDER_STATUSES = Object.values(OrderStatus);

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.COMPLETED,
  OrderStatus.COMPENSATED,
  OrderStatus.FAILED,
]);

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Machine-readable failure reasons, surfaced on the order and in API responses. */
export const FailureCode = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  RECONCILED_TIMEOUT: 'RECONCILED_TIMEOUT',
  RECONCILED_NO_CHARGE: 'RECONCILED_NO_CHARGE',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];
