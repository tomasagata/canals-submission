import { Inject, Injectable } from '@nestjs/common';
import { RemoteServiceLocation } from '../common/remote-location.js';
import { fetchJson } from '../common/http.util.js';

/** DI token for where the customer directory lives. Override its address via `CUSTOMER_BASE_URL`. */
export const CUSTOMER_LOCATION = Symbol('CUSTOMER_LOCATION');

export interface Customer {
  id: string;
  name: string;
  address: string;
  creditCard: string;
}

/**
 * Client for a customer directory, reached over HTTP at whatever address
 * `CUSTOMER_LOCATION` resolves to - the mockdata module by default (see
 * `CUSTOMER_BASE_URL`), but any provider speaking the same contract can be
 * substituted with no code change.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(CUSTOMER_LOCATION) private readonly location: RemoteServiceLocation) {}

  async getCustomerById(id: string): Promise<Customer | null> {
    const response = await fetchJson<Customer>(`${this.location.getBaseUrl()}/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw new Error(`Customer lookup failed with status ${response.status}.`);
    }
    return response.body;
  }
}
