/**
 * Logger - Centralised, configurable logging utility
 *
 * Controlled by:
 *   LOG_ENABLED=true|false   (default: true)
 *   LOG_LEVEL=debug|info|warn|error  (default: debug in dev, info in prod)
 *
 * Usage:
 *   import { logger } from '../config/logger.js';
 *   logger.info('SessionManager', 'Session created', { sessionId });
 *   logger.debug('DB', 'Query executed', { sql });
 *   logger.warn('Twilio', 'Signature skipped in dev');
 *   logger.error('Payment', 'Failed to create payment', error);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const enabled = process.env.LOG_ENABLED !== 'false';

const configuredLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return enabled && LEVELS[level] >= LEVELS[configuredLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function format(level: LogLevel, context: string, message: string, meta?: unknown): string {
  const base = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${context}] ${message}`;
  if (meta === undefined) return base;
  if (meta instanceof Error) return `${base}\n  ${meta.stack ?? meta.message}`;
  return `${base} ${JSON.stringify(meta)}`;
}

export const logger = {
  debug(context: string, message: string, meta?: unknown): void {
    if (shouldLog('debug')) console.debug(format('debug', context, message, meta));
  },
  info(context: string, message: string, meta?: unknown): void {
    if (shouldLog('info')) console.info(format('info', context, message, meta));
  },
  warn(context: string, message: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(format('warn', context, message, meta));
  },
  error(context: string, message: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(format('error', context, message, meta));
  },
  /** Convenience: log entry + exit of an async operation */
  async trace<T>(context: string, label: string, fn: () => Promise<T>): Promise<T> {
    logger.debug(context, `→ ${label}`);
    const start = Date.now();
    try {
      const result = await fn();
      logger.debug(context, `← ${label} (${Date.now() - start}ms)`);
      return result;
    } catch (err) {
      logger.error(context, `✗ ${label} failed (${Date.now() - start}ms)`, err);
      throw err;
    }
  },
};
