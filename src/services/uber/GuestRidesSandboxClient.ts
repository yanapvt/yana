const SANDBOX_BASE_URL = 'https://sandbox-api.uber.com';
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';

// Uber recommends these coordinates for reliable Guest Rides sandbox runs.
export const SANDBOX_ROUTE = {
  pickup: { latitude: 37.766192, longitude: -122.400745 },
  dropoff: { latitude: 37.752030, longitude: -122.422065 },
  parentProductTypeId: '6a8e56b8-914e-4b48-a387-e6ad21d9c00c', // UberX
} as const;

export interface UberGuestRidesCredentials {
  clientId: string;
  clientSecret: string;
  organizationUuid: string;
}

export interface UberSandboxResult {
  runId: string;
  products: number;
}

type Fetcher = typeof fetch;

class SandboxHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class GuestRidesSandboxClient {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async check(credentials: UberGuestRidesCredentials): Promise<UberSandboxResult> {
    const token = await this.getToken(credentials);
    const run = await this.callSandbox<{ run_id?: string }>(
      '/v1/guests/sandbox/run', token, credentials.organizationUuid,
      {
        driver_locations: [{ ...SANDBOX_ROUTE.pickup }],
        pickup_location: SANDBOX_ROUTE.pickup,
        dropoff_location: SANDBOX_ROUTE.dropoff,
        parent_product_type_id: SANDBOX_ROUTE.parentProductTypeId,
      }
    );
    if (!run.run_id) throw new Error('Uber sandbox did not return a run ID.');

    let estimate: { product_estimates?: unknown[] } | undefined;
    // A newly created Uber sandbox run may need up to a minute to initialize.
    for (let attempt = 0; attempt < 7; attempt++) {
      try {
        estimate = await this.callSandbox<{ product_estimates?: unknown[] }>(
          '/v1/guests/trips/estimates', token, credentials.organizationUuid,
          { pickup: SANDBOX_ROUTE.pickup, dropoff: SANDBOX_ROUTE.dropoff }, run.run_id
        );
        break;
      } catch (error) {
        if (!(error instanceof SandboxHttpError) || ![400, 404].includes(error.status) || attempt === 6) throw error;
        await this.wait(10_000);
      }
    }
    return { runId: run.run_id, products: Array.isArray(estimate?.product_estimates) ? estimate.product_estimates.length : 0 };
  }

  private async getToken(credentials: UberGuestRidesCredentials): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: 'guests.trips',
    });
    const response = await this.fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Uber authentication failed (HTTP ${response.status}). Check Guest Rides scope and partner access.`);
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error('Uber authentication returned no access token.');
    return data.access_token;
  }

  private async callSandbox<T>(
    path: string,
    token: string,
    organizationUuid: string,
    body: object,
    runId?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-uber-organizationuuid': organizationUuid,
    };
    if (runId) headers['x-uber-sandbox-runuuid'] = runId;
    const response = await this.fetcher(`${SANDBOX_BASE_URL}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? ' Check Uber Guest Rides approval, organization UUID, and sandbox whitelist.'
        : '';
      throw new SandboxHttpError(`Uber sandbox ${path} failed (HTTP ${response.status}).${hint}`, response.status);
    }
    return response.json() as Promise<T>;
  }
}
