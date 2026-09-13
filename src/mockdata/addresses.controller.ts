import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { MockDataAddressesService, AddressDto } from './mockdata-addresses.service.js';
import { CreateAddressDto } from './dto/index.js';
import { Coordinates } from '../geocoding/interfaces/index.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';

/**
 * Doubles as the mock geocoder's external management API and the internal
 * lookup GeocodingService calls over HTTP in place of a real geocoding
 * provider.
 */
@Controller('addresses')
export class MockDataAddressesController {
  constructor(private readonly addresses: MockDataAddressesService) {}

  @Get()
  list(): Promise<AddressDto[]> {
    return this.addresses.list();
  }

  /** Placed ahead of `:id` so "lookup" is never parsed as an id. */
  @Get('lookup')
  async lookup(@Query('address') address?: string): Promise<Coordinates> {
    if (!address) throw new BadRequestException('Query parameter "address" is required.');
    const coordinates = await this.addresses.lookup(address);
    if (!coordinates) throw new NotFoundException(`No coordinates known for address '${address}'.`);
    return coordinates;
  }

  @Post()
  create(@Body() dto: CreateAddressDto): Promise<AddressDto> {
    return this.addresses.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<void> {
    await this.addresses.remove(id);
  }
}
