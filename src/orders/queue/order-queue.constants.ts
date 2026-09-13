export const ORDER_SAGA_QUEUE = 'order-saga';
export const ORDER_SAGA_JOB = 'process-order';

/**
 * The job carries a pointer, never a copy of the order.
 *
 * A payload copy would be a snapshot taken at enqueue time, and a job may be
 * delivered minutes later and several times over. The order document in Mongo
 * is the single source of truth, and the worker re-reads it on every step
 * precisely so it can never act on state that has moved on beneath it.
 */
export interface OrderSagaJobData {
  orderId: string;
  outboxId: string;
}
