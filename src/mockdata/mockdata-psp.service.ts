import { GatewayTimeoutException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { AuthorizePaymentDto, PaymentResultDto } from '../payment/dto/index.js';
import { ChargeStatus, PspCharge } from './schemas/psp-charge.schema.js';
import { CreditCardStatus } from './schemas/mock-credit-card.schema.js';
import { MockDataCreditCardsService } from './mockdata-credit-cards.service.js';
import { paymentConfig } from '../config/payment.config.js';
import { isDuplicateKeyError } from '../common/mongo.util.js';

/**
 * The mock PSP. Deliberately modelled as a real gateway would behave: it keeps
 * its own ledger keyed on the caller's idempotency key, so replaying an
 * authorization returns the original outcome rather than charging again, and
 * it exposes a lookup so a caller who lost the response can ask what actually
 * happened.
 *
 * This is what PaymentService (in the payment module) now calls over HTTP,
 * instead of implementing this logic itself.
 */
@Injectable()
export class MockDataPspService {
  private readonly logger = new Logger(MockDataPspService.name);

  constructor(
    @InjectModel(PspCharge.name) private readonly chargeModel: Model<PspCharge>,
    @Inject(paymentConfig.KEY) private readonly config: ConfigType<typeof paymentConfig>,
    private readonly creditCards: MockDataCreditCardsService,
  ) {}

  async authorize(dto: AuthorizePaymentDto): Promise<PaymentResultDto> {
    const prior = await this.chargeModel.findOne({ idempotencyKey: dto.idempotencyKey }).lean().exec();
    if (prior) {
      return this.toResult(prior);
    }

    await this.injectLatency();

    const cardState = await this.creditCards.findByCardNumber(dto.creditCard);
    const declined = cardState
      ? cardState.status === CreditCardStatus.DECLINE
      : Math.random() < this.config.failureRate;

    const charge = {
      idempotencyKey: dto.idempotencyKey,
      transactionId: `txn_${randomUUID()}`,
      amount: dto.amount,
      status: declined ? ChargeStatus.DECLINED : ChargeStatus.SUCCEEDED,
      errorMessage: declined ? (cardState?.declineReason ?? 'Card declined by issuer.') : undefined,
    };

    try {
      // Persisted BEFORE we can possibly lose the response, exactly as a real
      // gateway commits the charge before acknowledging it. This ordering is
      // what makes the lookup below meaningful after a lost response.
      await this.chargeModel.create(charge);
    } catch (error) {
      if (!isDuplicateKeyError(error, 'idempotencyKey')) throw error;
      // A concurrent authorization with the same key won; return its outcome.
      const winner = await this.chargeModel.findOne({ idempotencyKey: dto.idempotencyKey }).lean().exec();
      if (winner) return this.toResult(winner);
      throw error;
    }

    if (Math.random() < this.config.lostResponseRate) {
      this.logger.warn(
        `Simulating a lost response for charge ${charge.transactionId} (key=${dto.idempotencyKey}). ` +
          `The charge IS recorded; the caller will not learn of it until reconciliation.`,
      );
      // A 504 is the caller's signal that the outcome is unknown, even though
      // it is fully known and persisted here - the whole point of the drill.
      throw new GatewayTimeoutException('Simulated lost response.');
    }

    this.logger.log(`Authorized ${dto.amount} for ${dto.description} (key=${dto.idempotencyKey}).`);
    return this.toResult(charge);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<PaymentResultDto | null> {
    const charge = await this.chargeModel.findOne({ idempotencyKey }).lean().exec();
    return charge ? this.toResult(charge) : null;
  }

  private toResult(charge: {
    idempotencyKey: string;
    transactionId: string;
    amount: number;
    status: ChargeStatus;
    errorMessage?: string;
    createdAt?: Date;
  }): PaymentResultDto {
    return {
      success: charge.status === ChargeStatus.SUCCEEDED,
      idempotencyKey: charge.idempotencyKey,
      transactionId: charge.transactionId,
      amount: charge.amount,
      errorMessage: charge.errorMessage,
      chargedAt: charge.createdAt,
    };
  }

  private async injectLatency(): Promise<void> {
    if (this.config.latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
  }
}
