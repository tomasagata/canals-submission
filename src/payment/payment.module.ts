import { Module } from '@nestjs/common';
import { PaymentService, PSP_LOCATION } from './payment.service.js';
import { remoteLocationProvider } from '../common/remote-location.js';

@Module({
  providers: [PaymentService, remoteLocationProvider(PSP_LOCATION, 'PSP_BASE_URL', '/psp')],
  exports: [PaymentService],
})
export class PaymentModule {}
