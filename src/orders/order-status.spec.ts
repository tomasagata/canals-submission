import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, OrderStatus, TERMINAL_STATUSES, isTerminal } from './order-status.js';

describe('OrderStatus', () => {
  it('classifies exactly the three end states as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      [OrderStatus.COMPLETED, OrderStatus.COMPENSATED, OrderStatus.FAILED].sort(),
    );
  });

  /**
   * The saga stops at a terminal status and the sweeper never claims one, so a
   * state wrongly classified here would either strand orders forever or let
   * settled ones be reprocessed.
   */
  it('treats every in-flight state as non-terminal', () => {
    expect(isTerminal(OrderStatus.PENDING)).toBe(false);
    expect(isTerminal(OrderStatus.STOCK_RESERVED)).toBe(false);
    expect(isTerminal(OrderStatus.PAYMENT_AUTHORIZED)).toBe(false);
    expect(isTerminal(OrderStatus.COMPENSATING)).toBe(false);
  });

  it('exposes every status to the schema enum', () => {
    expect(ORDER_STATUSES).toHaveLength(Object.keys(OrderStatus).length);
    expect(ORDER_STATUSES).toContain(OrderStatus.COMPENSATING);
  });
});
