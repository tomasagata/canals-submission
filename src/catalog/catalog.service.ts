import { Inject, Injectable } from "@nestjs/common";
import { RemoteServiceLocation } from "../common/remote-location.js";
import { fetchJson } from "../common/http.util.js";

/** DI token for where the catalogue lives. Override its address via `CATALOG_BASE_URL`. */
export const CATALOG_LOCATION = Symbol('CATALOG_LOCATION');

export interface Product {
    id: string;
    name: string;
    description?: string;
    price: number;
}

/**
 * Client for a product catalogue, reached over HTTP at whatever address
 * `CATALOG_LOCATION` resolves to - the mockdata module by default (see
 * `CATALOG_BASE_URL`), but any provider speaking the same contract can be
 * substituted with no code change.
 */
@Injectable()
export class CatalogService {
    constructor(@Inject(CATALOG_LOCATION) private readonly location: RemoteServiceLocation) {}

    /**
     * Looks up products by id, in one round trip. Throws if any requested id
     * comes back missing - a caller pricing an order needs either every
     * product or none.
     */
    async getProductsById(ids: string[]): Promise<Product[]> {
        if (ids.length === 0) return [];

        const query = ids.map((id) => encodeURIComponent(id)).join(',');
        const response = await fetchJson<Product[]>(`${this.location.getBaseUrl()}?ids=${query}`);
        if (response.status < 200 || response.status >= 300 || !response.body) {
            throw new Error(`Catalog lookup failed with status ${response.status}.`);
        }

        const found = response.body;
        const missing = ids.filter((id) => !found.some((product) => product.id === id));
        if (missing.length > 0) {
            throw new Error(`Products not found for IDs: ${missing.join(', ')}`);
        }
        return found;
    }
}
