import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Warehouse, WarehouseSchema } from "./schemas/warehouses.schema.js";
import { InventoryService } from "./inventory.service.js";
import { Stock, StockSchema } from "./schemas/stock.schema.js";
import { StockMovement, StockMovementSchema } from "./schemas/stock-movement.schema.js";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: Stock.name, schema: StockSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
    ])],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
