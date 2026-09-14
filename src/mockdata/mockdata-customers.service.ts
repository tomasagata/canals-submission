import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer } from './schemas/customer.schema.js';
import { CreateCustomerDto } from './dto/index.js';

export interface CustomerDto {
  id: string;
  name: string;
  creditCard: string;
}

function toDto(customer: { _id: Types.ObjectId; name: string; creditCard: string }): CustomerDto {
  return { id: customer._id.toString(), name: customer.name, creditCard: customer.creditCard };
}

@Injectable()
export class MockDataCustomersService {
  constructor(@InjectModel(Customer.name) private readonly customerModel: Model<Customer>) {}

  async list(): Promise<CustomerDto[]> {
    const customers = await this.customerModel.find().lean().exec();
    return customers.map(toDto);
  }

  /** Returns null rather than throwing: this is also the internal lookup PaymentModule's flow depends on for "customer not found". */
  async findById(id: string): Promise<CustomerDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const customer = await this.customerModel.findById(id).lean().exec();
    return customer ? toDto(customer) : null;
  }

  async create(dto: CreateCustomerDto): Promise<CustomerDto> {
    const customer = await this.customerModel.create(dto);
    return toDto(customer);
  }

  async remove(id: Types.ObjectId): Promise<void> {
    const result = await this.customerModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Customer ${id.toString()} not found.`);
    }
  }
}
