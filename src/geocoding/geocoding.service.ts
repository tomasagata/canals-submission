import { Injectable } from '@nestjs/common';
import { Coordinates } from './interfaces/index.js';
import { ConfigService } from '@nestjs/config';
import ngeohash from 'ngeohash';

const Cities: Array<{ name: string; coordinates: Coordinates }> = [
    { name: 'Los Angeles', coordinates: { latitude: 34.0522, longitude: -118.2437 } },
    { name: 'Chicago', coordinates: { latitude: 41.8781, longitude: -87.6298 } },
    { name: 'Houston', coordinates: { latitude: 29.7604, longitude: -95.3698 } },
    { name: 'Phoenix', coordinates: { latitude: 33.4484, longitude: -112.0740 } },
    { name: 'Philadelphia', coordinates: { latitude: 40.2603, longitude: -76.8852 } },
    { name: 'Miami', coordinates: { latitude: 27.9944, longitude: -81.7510 } },
    { name: 'Buenos Aires', coordinates: { latitude: -34.6037, longitude: -58.3816 } },
];

function getCityCoordinates(address: string): Coordinates | null {
    const city = Cities.find((c) => c.name.toLowerCase() === address.trim().toLowerCase());
    return city ? city.coordinates : null;
}

@Injectable()
export class GeocodingService {
    constructor(private readonly configService: ConfigService) {}

    async getCoordinates(address: string): Promise<Coordinates> {
        const coordinates = getCityCoordinates(address);
        if (!coordinates) {
            throw new Error('Coordinates not available for the provided address');
        }
        return coordinates;
    }

    passCoordinatesThroughGeohash(coordinates: Coordinates): Coordinates {
        const precision = this.configService.get<number>('GEOHASH_PRECISION', 6);
        const ghash = ngeohash.encode(coordinates.latitude, coordinates.longitude, precision);
        const decoded: ngeohash.GeographicPoint = ngeohash.decode(ghash);
        return {
            latitude: decoded.latitude,
            longitude: decoded.longitude,
        };
    }
}