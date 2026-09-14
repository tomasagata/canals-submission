import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Warehouse, WarehouseSchema } from '../inventory/schemas/warehouses.schema.js';
import { Stock, StockSchema } from '../inventory/schemas/stock.schema.js';
import { Customer, CustomerSchema } from './schemas/customer.schema.js';
import { PspCharge, PspChargeSchema } from './schemas/psp-charge.schema.js';
import { MockAddress, MockAddressSchema } from './schemas/mock-address.schema.js';
import { MockCreditCard, MockCreditCardSchema } from './schemas/mock-credit-card.schema.js';
import { Product, ProductSchema } from './schemas/product.schema.js';
import { paymentConfig } from '../config/payment.config.js';
import { MockDataWarehousesService } from './mockdata-warehouses.service.js';
import { MockDataCustomersService } from './mockdata-customers.service.js';
import { MockDataAddressesService } from './mockdata-addresses.service.js';
import { MockDataCreditCardsService } from './mockdata-credit-cards.service.js';
import { MockDataPspService } from './mockdata-psp.service.js';
import { MockDataProductsService } from './mockdata-products.service.js';
import { MockDataStockService } from './mockdata-stock.service.js';
import { MockDataWarehousesController } from './warehouses.controller.js';
import { MockDataCustomersController } from './customers.controller.js';
import { MockDataAddressesController } from './addresses.controller.js';
import { MockDataCreditCardsController } from './credit-cards.controller.js';
import { MockDataPspController } from './psp.controller.js';
import { MockDataProductsController } from './products.controller.js';
import { MockDataStockController } from './stock.controller.js';

/**
 * Stands in for every third-party system this app talks to: the PSP, the
 * customer directory, the geocoder, and the product catalogue.
 * Payment/Customers/Geocoding/Catalog each reach their respective piece of it
 * over real HTTP, independently configured (PSP_BASE_URL, CUSTOMER_BASE_URL,
 * GEOCODING_BASE_URL, CATALOG_BASE_URL - see common/remote-location.ts), the
 * same way they would reach four unrelated genuine providers that simply
 * happen to default to this one locally. This module additionally exposes
 * plain REST CRUD so mock data (warehouses, customers, addresses, credit-card
 * states, products) can be added or removed while the app is running, without
 * touching the database by hand.
 *
 * The warehouses collection is intentionally the SAME one InventoryService
 * reserves stock against (same schema, same collection name) - a warehouse
 * added here is immediately usable by the real order flow.
 */
@Module({
  imports: [
    ConfigModule.forFeature(paymentConfig),
    MongooseModule.forFeature([
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: PspCharge.name, schema: PspChargeSchema },
      { name: MockAddress.name, schema: MockAddressSchema },
      { name: MockCreditCard.name, schema: MockCreditCardSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Stock.name, schema: StockSchema },
    ]),
  ],
  controllers: [
    MockDataWarehousesController,
    MockDataCustomersController,
    MockDataAddressesController,
    MockDataCreditCardsController,
    MockDataPspController,
    MockDataProductsController,
    MockDataStockController,
  ],
  providers: [
    MockDataWarehousesService,
    MockDataCustomersService,
    MockDataAddressesService,
    MockDataCreditCardsService,
    MockDataPspService,
    MockDataProductsService,
    MockDataStockService,
  ],
})
export class MockDataModule {}
