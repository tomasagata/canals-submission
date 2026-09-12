import { Injectable } from '@nestjs/common';
import { PaymentResultDto } from './dto/index.js';

@Injectable()
export class PaymentService {
    constructor() {}

    async processPayment(creditCard: string, amount: number, desc: string): Promise<PaymentResultDto> {
        // Mock PSP call
        console.log(`Payment processed: $${amount} with credit card ${creditCard} for ${desc}`);
        return {
            success: true,
            transactionId: 'txn_1234567890',
            amount: amount,
        };
    }
}