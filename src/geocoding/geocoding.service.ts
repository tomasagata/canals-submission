import { Inject, Injectable } from '@nestjs/common';
import { Coordinates } from './interfaces/index.js';
import { ConfigService } from '@nestjs/config';
import { RemoteServiceLocation } from '../common/remote-location.js';
import { fetchJson } from '../common/http.util.js';

/** DI token for where the geocoder lives. Override its address via `GEOCODING_BASE_URL`. */
export const GEOCODING_LOCATION = Symbol('GEOCODING_LOCATION');

/**
 * Client for a geocoder, reached over HTTP at whatever address
 * `GEOCODING_LOCATION` resolves to - the mockdata module by default (see
 * `GEOCODING_BASE_URL`), but any provider speaking the same contract can be
 * substituted with no code change.
 */
@Injectable()
export class GeocodingService {
    constructor(
        private readonly configService: ConfigService,
        @Inject(GEOCODING_LOCATION) private readonly location: RemoteServiceLocation,
    ) {}

    async getCoordinates(address: string): Promise<Coordinates> {
        const response = await fetchJson<Coordinates>(
            `${this.location.getBaseUrl()}/lookup?address=${encodeURIComponent(address)}`,
        );
        if (response.status === 404) {
            throw new Error('Coordinates not available for the provided address');
        }
        if (response.status < 200 || response.status >= 300 || !response.body) {
            throw new Error(`Geocoding request failed with status ${response.status}.`);
        }
        return response.body;
    }
}
