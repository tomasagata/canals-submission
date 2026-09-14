import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Letters (incl. accented/international), digits, whitespace, and the punctuation that shows up in real postal addresses. */
const SHIPPING_ADDRESS_PATTERN = /^[\p{L}\p{N}\s,.'#/&-]+$/u;

export class ItemDto {
  @IsMongoId()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

@ValidatorConstraint({ name: 'uniqueProductIds', async: false })
class UniqueProductIdsConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true;
    const productIds = items
      .map((item: unknown) => (item as { productId?: unknown })?.productId)
      .filter((id): id is string => typeof id === 'string');
    return new Set(productIds).size === productIds.length;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'items must not contain duplicate productId values';
  }
}

export class CreateOrderDto {
  @IsMongoId()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  @Matches(SHIPPING_ADDRESS_PATTERN, {
    message: 'shippingAddress may only contain letters, numbers, spaces, and , . \' # / & -',
  })
  shippingAddress: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  @Validate(UniqueProductIdsConstraint)
  items: Array<ItemDto>;
}