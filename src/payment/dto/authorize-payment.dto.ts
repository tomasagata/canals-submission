export class AuthorizePaymentDto {
    /**
     * The caller's idempotency key. Our saga always passes the internal orderId,
     * so a retried authorization - from a queue redelivery or the reconciliation
     * sweeper - can never charge the card twice.
     */
    idempotencyKey: string;
    creditCard: string;
    /** Integer minor units. */
    amount: number;
    description: string;
}
