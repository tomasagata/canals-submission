import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PaymentResultDto } from '../payment/dto/index.js';
import { MockDataPspService } from './mockdata-psp.service.js';
import { AuthorizeChargeDto } from './dto/index.js';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../common/decorators/idempotency-key.decorator.js';

/** Internal API: what PaymentService calls in place of a real payment gateway. */
@Controller('psp')
export class MockDataPspController {
  constructor(private readonly psp: MockDataPspService) {}

  @Post('authorize')
  authorize(@Body() dto: AuthorizeChargeDto): Promise<PaymentResultDto> {
    return this.psp.authorize(dto);
  }

  @Get('charges/:idempotencyKey')
  async getCharge(@Param('idempotencyKey') idempotencyKey: string): Promise<PaymentResultDto> {
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'IDEMPOTENCY_KEY_TOO_LONG',
        message: `idempotencyKey must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      });
    }
    const charge = await this.psp.getByIdempotencyKey(idempotencyKey);
    if (!charge) throw new NotFoundException(`No charge recorded for idempotency key '${idempotencyKey}'.`);
    return charge;
  }
}
