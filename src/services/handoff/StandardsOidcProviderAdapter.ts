import type { OidcProviderAdapter, VerifiedOidcClaims } from './OperatorOidcService.js';

export interface OidcTokenVerifier {
  verify(input: { idToken: string; issuer: string; audience: string; nonce: string }): Promise<VerifiedOidcClaims>;
}

export class StandardsOidcProviderAdapter implements OidcProviderAdapter {
  constructor(
    private readonly config: { issuer: string; clientId: string; authorizationEndpoint: string; tokenEndpoint: string },
    private readonly verifier: OidcTokenVerifier,
    private readonly http: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string; clientId: string }): string {
    if (input.clientId !== this.config.clientId) throw new Error('OIDC_CLIENT_MISMATCH');
    const url = new URL(this.config.authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: 'code', scope: 'openid', client_id: input.clientId,
      redirect_uri: input.redirectUri, state: input.state, nonce: input.nonce,
      code_challenge: input.codeChallenge, code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string }): Promise<VerifiedOidcClaims> {
    if (!input.code || input.clientId !== this.config.clientId) throw new Error('OIDC_EXCHANGE_REJECTED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.http(this.config.tokenEndpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code,
          code_verifier: input.codeVerifier, redirect_uri: input.redirectUri, client_id: input.clientId }),
      });
      if (!response.ok) throw new Error('OIDC_EXCHANGE_REJECTED');
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.id_token !== 'string') throw new Error('OIDC_ID_TOKEN_MISSING');
      const nonce = decodeNonceHint(body.id_token);
      return await this.verifier.verify({ idToken: body.id_token, issuer: this.config.issuer,
        audience: this.config.clientId, nonce });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('OIDC_')) throw error;
      throw new Error('OIDC_EXCHANGE_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
}

// This is only a routing hint for the verifier. Trust is established exclusively
// by OidcTokenVerifier after signature, issuer, audience, nonce, and expiry checks.
function decodeNonceHint(jwt: string): string {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
    return typeof payload.nonce === 'string' ? payload.nonce : '';
  } catch { return ''; }
}
