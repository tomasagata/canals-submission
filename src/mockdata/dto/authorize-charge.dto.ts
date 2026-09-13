import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

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
  idempotencyKey: string;

  @IsString()
  @IsNotEmpty()
  creditCard: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;
}
