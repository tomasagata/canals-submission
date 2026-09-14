import { IsInt, IsNotEmpty, IsString, Min, MaxLength } from 'class-validator';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../../common/decorators/idempotency-key.decorator.js';

/**
 * The wire shape of a POST to the mock PSP's authorize endpoint. Kept
 * separate from payment/dto's `AuthorizePaymentDto` (which carries no
 * class-validator decorators, since it was never bound to an HTTP body
 * before) so the global ValidationPipe's whitelist has something to validate
 * against here.
 */
export class AuthorizeChargeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  idempotencyKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  creditCard: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description: string;
}
