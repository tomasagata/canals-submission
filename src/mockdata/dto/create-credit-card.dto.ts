import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreditCardStatus } from '../schemas/mock-credit-card.schema.js';

export class CreateCreditCardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  cardNumber: string;

  @IsEnum(CreditCardStatus)
  status: CreditCardStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  declineReason?: string;
}
