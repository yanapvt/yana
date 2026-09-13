import { createHash, timingSafeEqual } from 'node:crypto';

export type OperatorRole = 'viewer' | 'operator' | 'admin';
export interface OperatorIdentity { id: string; tokenSha256: string; roles: OperatorRole[]; expiresAt?: Date; revoked: boolean; }

export class OperatorIdentityService {
  private readonly identities: OperatorIdentity[];
  constructor(json?: string, private readonly clock: () => Date = () => new Date()) {
    this.identities = parseIdentities(json);
  }

  authenticate(token: string): OperatorIdentity | undefined {
    if (!token) return undefined;
    const supplied = Buffer.from(hash(token), 'hex');
    return this.identities.find((identity) => {
      const expected = Buffer.from(identity.tokenSha256, 'hex');
      return expected.length === supplied.length && timingSafeEqual(expected, supplied) && !identity.revoked &&
        (!identity.expiresAt || identity.expiresAt > this.clock());
    });
  }

  permits(identity: OperatorIdentity, required: OperatorRole): boolean {
    const rank: Record<OperatorRole, number> = { viewer: 1, operator: 2, admin: 3 };
    return identity.roles.some((role) => rank[role] >= rank[required]);
  }
}

export function hashOperatorCredential(value: string): string { return hash(value); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function parseIdentities(json?: string): OperatorIdentity[] {
  if (!json) return [];
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('Invalid HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON'); }
  if (!Array.isArray(raw)) throw new Error('Operator identities must be an array');
  return raw.map((value) => {
    const item = value as Record<string, unknown>;
    const roles = Array.isArray(item.roles) ? item.roles.filter((role): role is OperatorRole => ['viewer', 'operator', 'admin'].includes(String(role))) : [];
    if (typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id) || typeof item.tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.tokenSha256) || roles.length === 0) {
      throw new Error('Invalid operator identity entry');
    }
    const expiresAt = typeof item.expiresAt === 'string' ? new Date(item.expiresAt) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Invalid operator identity expiry');
    return { id: item.id, tokenSha256: item.tokenSha256.toLowerCase(), roles, expiresAt, revoked: item.revoked === true };
  });
}
