import crypto from 'crypto';
import type { FormType } from '../types/forms.js';

export interface FormTokenRecord {
  userId: string;
  formType: FormType;
  expiresAt: Date;
}

export interface FormTokenOptions {
  ttlMinutes?: number;
}

interface StoredToken extends FormTokenRecord {
  csrfHashes: Set<string>;
  consumed: boolean;
}

const DEFAULT_TOKEN_TTL_MINUTES = 60 * 24;

export class FormTokenService {
  private readonly tokens = new Map<string, StoredToken>();

  createToken(userId: string, formType: FormType, options: FormTokenOptions = {}): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttlMinutes = options.ttlMinutes ?? DEFAULT_TOKEN_TTL_MINUTES;

    this.tokens.set(this.hash(token), {
      userId,
      formType,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      csrfHashes: new Set<string>(),
      consumed: false,
    });

    return token;
  }

  resolveToken(token: string, formType?: FormType): FormTokenRecord | null {
    const record = this.getValidToken(token, formType);
    if (!record) {
      return null;
    }

    return {
      userId: record.userId,
      formType: record.formType,
      expiresAt: record.expiresAt,
    };
  }

  createCsrfToken(token: string, formType: FormType): string | null {
    const record = this.getValidToken(token, formType);
    if (!record) {
      return null;
    }

    const csrfToken = crypto.randomBytes(32).toString('base64url');
    record.csrfHashes.add(this.hash(csrfToken));
    return csrfToken;
  }

  verifyAndConsumeCsrfToken(token: string, formType: FormType, csrfToken: string): boolean {
    const record = this.getValidToken(token, formType);
    if (!record || !csrfToken) {
      return false;
    }

    const csrfHash = this.hash(csrfToken);
    if (!record.csrfHashes.has(csrfHash)) {
      return false;
    }

    record.csrfHashes.delete(csrfHash);
    return true;
  }

  consumeToken(token: string, formType: FormType): void {
    const record = this.getValidToken(token, formType);
    if (record) {
      record.consumed = true;
      record.csrfHashes.clear();
    }
  }

  private getValidToken(token: string, formType?: FormType): StoredToken | null {
    const record = this.tokens.get(this.hash(token));
    if (
      !record ||
      record.consumed ||
      record.expiresAt.getTime() <= Date.now() ||
      (formType && record.formType !== formType)
    ) {
      return null;
    }

    return record;
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

let formTokenServiceInstance: FormTokenService | null = null;

export function getFormTokenService(): FormTokenService {
  if (!formTokenServiceInstance) {
    formTokenServiceInstance = new FormTokenService();
  }

  return formTokenServiceInstance;
}

export function initFormTokenService(service = new FormTokenService()): FormTokenService {
  formTokenServiceInstance = service;
  return service;
}
