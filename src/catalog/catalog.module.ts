import { Module } from '@nestjs/common';
import { CatalogService, CATALOG_LOCATION } from './catalog.service.js';
import { remoteLocationProvider } from '../common/remote-location.js';

@Module({
  providers: [CatalogService, remoteLocationProvider(CATALOG_LOCATION, 'CATALOG_BASE_URL', '/products')],
  exports: [CatalogService],
})
export class CatalogModule {}
