import { describe, expect, it, vi } from 'vitest';
import { StandardsOidcProviderAdapter } from './StandardsOidcProviderAdapter.js';

const payload = Buffer.from(JSON.stringify({ nonce: 'nonce-1' })).toString('base64url');
const token = `header.${payload}.signature`;
const config = { issuer: 'https://id.example', clientId: 'yana', authorizationEndpoint: 'https://id.example/authorize', tokenEndpoint: 'https://id.example/token' };

describe('StandardsOidcProviderAdapter', () => {
  it('constructs a strict authorization-code PKCE request', () => {
    const adapter = new StandardsOidcProviderAdapter(config, { verify: vi.fn() });
    const url = new URL(adapter.authorizationUrl({ state: 'state', nonce: 'nonce', codeChallenge: 'challenge', redirectUri: 'https://ops.example/operator/oidc/callback', clientId: 'yana' }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid', code_challenge_method: 'S256', state: 'state', nonce: 'nonce', redirect_uri: 'https://ops.example/operator/oidc/callback' });
  });

  it('exchanges without a client secret and delegates all trust to a cryptographic verifier', async () => {
    const verify = vi.fn().mockResolvedValue({ issuer: config.issuer, audience: 'yana', subject: 'user', nonce: 'nonce-1', expiresAt: new Date(Date.now() + 60_000), claims: {} });
    const http = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: token }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new StandardsOidcProviderAdapter(config, { verify }, http as any);
    await adapter.exchange({ code: 'code', codeVerifier: 'verifier', redirectUri: 'https://ops.example/operator/oidc/callback', clientId: 'yana' });
    const request = http.mock.calls[0][1];
    expect(String(request.body)).not.toContain('client_secret');
    expect(verify).toHaveBeenCalledWith({ idToken: token, issuer: config.issuer, audience: 'yana', nonce: 'nonce-1' });
  });

  it('returns safe errors without exposing provider bodies', async () => {
    const http = vi.fn().mockResolvedValue(new Response('secret provider detail', { status: 401 }));
    const adapter = new StandardsOidcProviderAdapter(config, { verify: vi.fn() }, http as any);
    await expect(adapter.exchange({ code: 'bad', codeVerifier: 'v', redirectUri: 'https://ops.example/cb', clientId: 'yana' })).rejects.toThrow('OIDC_EXCHANGE_REJECTED');
  });
});
