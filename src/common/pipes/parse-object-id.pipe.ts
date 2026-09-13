import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/** Turns a malformed id into a 400 instead of letting a mongoose CastError become a 500. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_ID',
        message: `'${value}' is not a valid id.`,
      });
    }
    return new Types.ObjectId(value);
  }
}
