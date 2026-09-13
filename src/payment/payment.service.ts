import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { AuthorizePaymentDto, PaymentResultDto } from './dto/index.js';
import { ChargeStatus, PspCharge } from './schemas/psp-charge.schema.js';
import { paymentConfig } from '../config/payment.config.js';
import { isDuplicateKeyError } from '../common/mongo.util.js';

/**
 * Simulates the gateway accepting the charge but the response never reaching
 * us (timeout, connection reset, our process dying). The money moved; we don't
 * know it. Resolving this is the reconciliation sweeper's entire purpose.
 */
export class PaymentGatewayTimeoutError extends Error {
  constructor() {
    super('Payment gateway did not respond in time; the charge outcome is unknown.');
    this.name = 'PaymentGatewayTimeoutError';
  }
}

/**
 * Mock payment service provider.
 *
 * Deliberately modelled as a real PSP would behave: it keeps its own ledger
 * keyed on the caller's idempotency key, so replaying an authorization returns
 * the original outcome rather than charging again, and it exposes a lookup so a
 * caller who lost the response can ask what actually happened.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectModel(PspCharge.name) private readonly chargeModel: Model<PspCharge>,
    @Inject(paymentConfig.KEY) private readonly config: ConfigType<typeof paymentConfig>,
  ) {}

  /**
   * Authorizes a charge. Idempotent on `idempotencyKey`: the same key always
   * yields the same transactionId and the same outcome, and the card is only
   * ever charged once.
   */
  async authorize(dto: AuthorizePaymentDto): Promise<PaymentResultDto> {
    const prior = await this.chargeModel.findOne({ idempotencyKey: dto.idempotencyKey }).lean().exec();
    if (prior) {
      return this.toResult(prior);
    }

    await this.injectLatency();

    const declined = Math.random() < this.config.failureRate;
    const charge = {
      idempotencyKey: dto.idempotencyKey,
      transactionId: `txn_${randomUUID()}`,
      amount: dto.amount,
      status: declined ? ChargeStatus.DECLINED : ChargeStatus.SUCCEEDED,
      errorMessage: declined ? 'Card declined by issuer.' : undefined,
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
      throw new PaymentGatewayTimeoutError();
    }

    this.logger.log(`Authorized ${dto.amount} for ${dto.description} (key=${dto.idempotencyKey}).`);
    return this.toResult(charge);
  }

  /**
   * Looks up a charge by the key it was made with.
   *
   * This is what lets reconciliation answer "did we actually charge this
   * customer?" without guessing. The previous implementation had no such
   * lookup, which forced the sweeper to assume a stuck order had failed - and
   * therefore to risk releasing stock for an order that was in fact paid.
   */
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
