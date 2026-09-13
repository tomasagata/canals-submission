import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CreditCardStatus } from '../schemas/mock-credit-card.schema.js';

export class CreateCreditCardDto {
  @IsString()
  @IsNotEmpty()
  cardNumber: string;

  @IsEnum(CreditCardStatus)
  status: CreditCardStatus;

  @IsOptional()
  @IsString()
  declineReason?: string;
}
