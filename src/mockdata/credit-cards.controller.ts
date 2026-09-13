import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { MockDataCreditCardsService, CreditCardDto } from './mockdata-credit-cards.service.js';
import { CreateCreditCardDto } from './dto/index.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';

/** External management API: pin a card number to always approve or always decline in the mock PSP. */
@Controller('credit-cards')
export class MockDataCreditCardsController {
  constructor(private readonly creditCards: MockDataCreditCardsService) {}

  @Get()
  list(): Promise<CreditCardDto[]> {
    return this.creditCards.list();
  }

  @Post()
  create(@Body() dto: CreateCreditCardDto): Promise<CreditCardDto> {
    return this.creditCards.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<void> {
    await this.creditCards.remove(id);
  }
}
