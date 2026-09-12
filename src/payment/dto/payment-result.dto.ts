export class PaymentResultDto {
    success: boolean;
    transactionId?: string;
    errorMessage?: string;
    amount?: number;
}