import { Module } from '@nestjs/common';
import { GeocodingService, GEOCODING_LOCATION } from './geocoding.service.js';
import { remoteLocationProvider } from '../common/remote-location.js';

@Module({
    providers: [GeocodingService, remoteLocationProvider(GEOCODING_LOCATION, 'GEOCODING_BASE_URL', '/addresses')],
    exports: [GeocodingService],
})
export class GeocodingModule {}
