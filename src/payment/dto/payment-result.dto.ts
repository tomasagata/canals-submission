export class PaymentResultDto {
    success: boolean;
    /** Echoes the key the caller supplied, so a result can always be traced back to its order. */
    idempotencyKey?: string;
    transactionId?: string;
    errorMessage?: string;
    amount?: number;
    chargedAt?: Date;
}
