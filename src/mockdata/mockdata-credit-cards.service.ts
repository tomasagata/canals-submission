import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MockCreditCard } from './schemas/mock-credit-card.schema.js';
import { CreateCreditCardDto } from './dto/index.js';

export interface CreditCardDto {
  id: string;
  cardNumber: string;
  status: string;
  declineReason?: string;
}

function toDto(card: {
  _id: Types.ObjectId;
  cardNumber: string;
  status: string;
  declineReason?: string;
}): CreditCardDto {
  return { id: card._id.toString(), cardNumber: card.cardNumber, status: card.status, declineReason: card.declineReason };
}

/**
 * Pinned outcomes for specific card numbers, consulted by the mock PSP before
 * it falls back to the global random `failureRate`. This is what lets a
 * caller demo "this exact card always declines" deterministically.
 */
@Injectable()
export class MockDataCreditCardsService {
  constructor(@InjectModel(MockCreditCard.name) private readonly cardModel: Model<MockCreditCard>) {}

  async list(): Promise<CreditCardDto[]> {
    const cards = await this.cardModel.find().lean().exec();
    return cards.map(toDto);
  }

  async findByCardNumber(cardNumber: string): Promise<CreditCardDto | null> {
    const card = await this.cardModel.findOne({ cardNumber }).lean().exec();
    return card ? toDto(card) : null;
  }

  async create(dto: CreateCreditCardDto): Promise<CreditCardDto> {
    const card = await this.cardModel
      .findOneAndUpdate(
        { cardNumber: dto.cardNumber },
        { cardNumber: dto.cardNumber, status: dto.status, declineReason: dto.declineReason },
        { returnDocument: 'after', upsert: true },
      )
      .lean()
      .exec();
    return toDto(card);
  }

  async remove(id: Types.ObjectId): Promise<void> {
    const result = await this.cardModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Credit card ${id.toString()} not found.`);
    }
  }
}
