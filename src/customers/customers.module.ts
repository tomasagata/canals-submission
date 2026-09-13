import { Module } from "@nestjs/common";
import { CustomersService, CUSTOMER_LOCATION } from "./customers.service.js";
import { remoteLocationProvider } from "../common/remote-location.js";

@Module({
  providers: [CustomersService, remoteLocationProvider(CUSTOMER_LOCATION, 'CUSTOMER_BASE_URL', '/customers')],
  exports: [CustomersService],
  controllers: [],
})
export class CustomersModule {}
