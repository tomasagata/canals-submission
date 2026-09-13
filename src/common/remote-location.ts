import type { Provider } from '@nestjs/common';

/**
 * Where one outbound integration lives. Each of Payment, Customers and
 * Geocoding gets its own instance under its own DI token (PSP_LOCATION,
 * CUSTOMER_LOCATION, GEOCODING_LOCATION) - they are independently
 * configurable and know nothing of each other, exactly as they would if each
 * were a genuinely different third-party provider. That they all default to
 * this same process's mockdata module is an implementation detail of local
 * development, not something the services are aware of.
 */
export class RemoteServiceLocation {
  constructor(private baseUrl: string) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }
}

/**
 * Builds a provider for one integration's location, read from its own env
 * var. Falling back to this process's own port + the mockdata module's route
 * for that integration - overriding the env var points the service at a
 * different backend entirely (a real provider, or a mockdata instance running
 * elsewhere) without any code change.
 */
export function remoteLocationProvider(token: symbol, envVar: string, defaultPath: string): Provider {
  return {
    provide: token,
    useFactory: (): RemoteServiceLocation =>
      new RemoteServiceLocation(process.env[envVar] || `http://127.0.0.1:${process.env.PORT ?? 3000}${defaultPath}`),
  };
}
