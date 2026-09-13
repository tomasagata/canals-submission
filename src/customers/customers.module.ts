import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Customer, CustomerSchema } from "./schemas/customers.schema.js";
import { CustomersService } from "./customers.service.js";

@Module({
  imports: [MongooseModule.forFeature([{ name: Customer.name, schema: CustomerSchema }])],
  providers: [CustomersService],
  exports: [CustomersService],
  controllers: [],
})
export class CustomersModule {}
