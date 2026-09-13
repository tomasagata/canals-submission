import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MockAddress } from './schemas/mock-address.schema.js';
import { CreateAddressDto } from './dto/index.js';
import { Coordinates } from '../geocoding/interfaces/index.js';

export interface AddressDto {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** The geocoder's out-of-the-box data, so a fresh environment can resolve something without any setup. */
const DEFAULT_ADDRESSES: Array<{ address: string; latitude: number; longitude: number }> = [
  { address: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  { address: 'Chicago', latitude: 41.8781, longitude: -87.6298 },
  { address: 'Houston', latitude: 29.7604, longitude: -95.3698 },
  { address: 'Phoenix', latitude: 33.4484, longitude: -112.074 },
  { address: 'Philadelphia', latitude: 40.2603, longitude: -76.8852 },
  { address: 'Miami', latitude: 27.9944, longitude: -81.751 },
  { address: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816 },
];

function toDto(entry: { _id: Types.ObjectId; address: string; latitude: number; longitude: number }): AddressDto {
  return { id: entry._id.toString(), address: entry.address, latitude: entry.latitude, longitude: entry.longitude };
}

/** Escapes a string for safe use inside a RegExp, so a lookup address can never be interpreted as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class MockDataAddressesService implements OnModuleInit {
  constructor(@InjectModel(MockAddress.name) private readonly addressModel: Model<MockAddress>) {}

  async onModuleInit(): Promise<void> {
    if ((await this.addressModel.countDocuments()) > 0) return;
    await this.addressModel.insertMany(DEFAULT_ADDRESSES);
  }

  async list(): Promise<AddressDto[]> {
    const addresses = await this.addressModel.find().lean().exec();
    return addresses.map(toDto);
  }

  /** Case-insensitive, matching the geocoder's original lookup semantics. */
  async lookup(address: string): Promise<Coordinates | null> {
    const trimmed = address.trim();
    const match = await this.addressModel
      .findOne({ address: { $regex: `^${escapeRegExp(trimmed)}$`, $options: 'i' } })
      .lean()
      .exec();
    return match ? { latitude: match.latitude, longitude: match.longitude } : null;
  }

  /** Upserts by address (case-insensitive) so re-adding a known city updates its coordinates instead of duplicating it. */
  async create(dto: CreateAddressDto): Promise<AddressDto> {
    const trimmed = dto.address.trim();
    const updated = await this.addressModel
      .findOneAndUpdate(
        { address: { $regex: `^${escapeRegExp(trimmed)}$`, $options: 'i' } },
        { address: trimmed, latitude: dto.latitude, longitude: dto.longitude },
        { returnDocument: 'after', upsert: true },
      )
      .lean()
      .exec();
    return toDto(updated);
  }

  async remove(id: Types.ObjectId): Promise<void> {
    const result = await this.addressModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Address ${id.toString()} not found.`);
    }
  }
}
