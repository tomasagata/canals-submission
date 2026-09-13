import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { MockDataCustomersService, CustomerDto } from './mockdata-customers.service.js';
import { CreateCustomerDto } from './dto/index.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';

/**
 * Doubles as the mock customer directory's external management API and the
 * internal lookup CustomersService calls over HTTP in place of a real
 * customer-data provider.
 */
@Controller('customers')
export class MockDataCustomersController {
  constructor(private readonly customers: MockDataCustomersService) {}

  @Get()
  list(): Promise<CustomerDto[]> {
    return this.customers.list();
  }

  @Get(':id')
  async getOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<CustomerDto> {
    const customer = await this.customers.findById(id.toString());
    if (!customer) throw new NotFoundException(`Customer ${id.toString()} not found.`);
    return customer;
  }

  @Post()
  create(@Body() dto: CreateCustomerDto): Promise<CustomerDto> {
    return this.customers.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<void> {
    await this.customers.remove(id);
  }
}
