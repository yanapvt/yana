import { describe, expect, it, vi } from 'vitest';
import { GuestRidesSandboxClient } from './GuestRidesSandboxClient.js';

const credentials = { clientId: 'test-id', clientSecret: 'test-secret', organizationUuid: 'test-org' };

describe('GuestRidesSandboxClient', () => {
  it('authenticates and calls only sandbox ride endpoints', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: 'test-run' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product_estimates: [{ product: { product_id: 'test-product' } }] }), { status: 200 }));
    const result = await new GuestRidesSandboxClient(fetcher).check(credentials);
    expect(result).toEqual({ runId: 'test-run', products: 1 });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://auth.uber.com/oauth/v2/token',
      'https://sandbox-api.uber.com/v1/guests/sandbox/run',
      'https://sandbox-api.uber.com/v1/guests/trips/estimates',
    ]);
    expect(fetcher.mock.calls[2][1].headers['x-uber-sandbox-runuuid']).toBe('test-run');
    expect(fetcher.mock.calls[1][1].headers['x-uber-organizationuuid']).toBe('test-org');
  });

  it('does not continue to ride endpoints if authentication fails or reveal response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret diagnostic', { status: 403 }));
    await expect(new GuestRidesSandboxClient(fetcher).check(credentials))
      .rejects.toThrow('Uber authentication failed (HTTP 403)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries an initializing sandbox run without making a second run', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: 'test-run' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('not ready', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product_estimates: [] }), { status: 200 }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(new GuestRidesSandboxClient(fetcher, wait).check(credentials))
      .resolves.toEqual({ runId: 'test-run', products: 0 });
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
