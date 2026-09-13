import { registerAs } from '@nestjs/config';

/**
 * Fault-injection knobs for the mock PSP. All default to 0 (a perfectly
 * reliable gateway); raise them to exercise the saga's retry paths and the
 * reconciliation sweeper without having to kill processes by hand.
 */
export interface PaymentConfig {
  /** Artificial round-trip latency, to widen the window for race testing. */
  latencyMs: number;
  /** Probability [0..1] that a charge is declined. */
  failureRate: number;
  /**
   * Probability [0..1] that the charge is recorded but the response is lost.
   * This is the scenario the reconciliation sweeper exists to resolve.
   */
  lostResponseRate: number;
}

export const paymentConfig = registerAs(
  'payment',
  (): PaymentConfig => ({
    latencyMs: Number(process.env.PAYMENT_LATENCY_MS ?? 0),
    failureRate: Number(process.env.PAYMENT_FAILURE_RATE ?? 0),
    lostResponseRate: Number(process.env.PAYMENT_LOST_RESPONSE_RATE ?? 0),
  }),
);
