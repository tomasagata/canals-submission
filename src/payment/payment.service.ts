import { Inject, Injectable } from '@nestjs/common';
import { AuthorizePaymentDto, PaymentResultDto } from './dto/index.js';
import { RemoteServiceLocation } from '../common/remote-location.js';
import { fetchJson, jsonInit } from '../common/http.util.js';

/** DI token for where the PSP lives. Override its address via `PSP_BASE_URL`. */
export const PSP_LOCATION = Symbol('PSP_LOCATION');

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

/** Parses `chargedAt` back into a Date; it crosses the wire as an ISO string. */
function reviveResult(body: PaymentResultDto): PaymentResultDto {
  return { ...body, chargedAt: body.chargedAt ? new Date(body.chargedAt) : undefined };
}

/**
 * Client for a PSP, reached over HTTP at whatever address `PSP_LOCATION`
 * resolves to - the mockdata module by default (see `PSP_BASE_URL`), but any
 * gateway speaking the same contract can be substituted with no code change.
 *
 * The gateway keeps its own ledger keyed on the caller's idempotency key, so
 * replaying an authorization returns the original outcome rather than
 * charging again, and a lost response (HTTP 504) is the gateway's way of
 * saying "the outcome is unknown to you, even though I know it" - which is
 * exactly the case the reconciliation sweeper exists to resolve via
 * `getByIdempotencyKey`.
 */
@Injectable()
export class PaymentService {
  constructor(@Inject(PSP_LOCATION) private readonly location: RemoteServiceLocation) {}

  /**
   * Authorizes a charge. Idempotent on `idempotencyKey`: the same key always
   * yields the same transactionId and the same outcome, and the card is only
   * ever charged once.
   */
  async authorize(dto: AuthorizePaymentDto): Promise<PaymentResultDto> {
    const response = await fetchJson<PaymentResultDto>(
      `${this.location.getBaseUrl()}/authorize`,
      jsonInit('POST', dto),
    );

    if (response.status === 504) {
      throw new PaymentGatewayTimeoutError();
    }
    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw new Error(`PSP authorize request failed with status ${response.status}.`);
    }
    return reviveResult(response.body);
  }

  /**
   * Looks up a charge by the key it was made with.
   *
   * This is what lets reconciliation answer "did we actually charge this
   * customer?" without guessing.
   */
  async getByIdempotencyKey(idempotencyKey: string): Promise<PaymentResultDto | null> {
    const response = await fetchJson<PaymentResultDto>(
      `${this.location.getBaseUrl()}/charges/${encodeURIComponent(idempotencyKey)}`,
    );
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw new Error(`PSP charge lookup failed with status ${response.status}.`);
    }
    return reviveResult(response.body);
  }
}
