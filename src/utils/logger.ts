/**
 * Comprehensive Logging System
 * Provides structured logging with different levels and categories
 * Can be enabled/disabled via environment variables
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

export enum LogCategory {
  WEBHOOK = 'WEBHOOK',
  SESSION = 'SESSION',
  ORCHESTRATOR = 'ORCHESTRATOR',
  LLM = 'LLM',
  SCHEMA = 'SCHEMA',
  TOOL = 'TOOL',
  PROVIDER = 'PROVIDER',
  BOOKING = 'BOOKING',
  PAYMENT = 'PAYMENT',
  TRANSLATION = 'TRANSLATION',
  WHATSAPP = 'WHATSAPP',
  DATABASE = 'DATABASE',
  REDIS = 'REDIS',
  MIDDLEWARE = 'MIDDLEWARE',
  GENERAL = 'GENERAL',
}

interface LogConfig {
  level: LogLevel;
  enabledCategories: Set<LogCategory>;
  enableTimestamp: boolean;
  enableColors: boolean;
  enableStackTrace: boolean;
}

class Logger {
  private config: LogConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): LogConfig {
    const logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO');
    const enabledCategories = this.parseCategories(
      process.env.LOG_CATEGORIES || 'ALL'
    );

    return {
      level: logLevel,
      enabledCategories,
      enableTimestamp: process.env.LOG_TIMESTAMP !== 'false',
      enableColors: process.env.LOG_COLORS !== 'false',
      enableStackTrace: process.env.LOG_STACK_TRACE === 'true',
    };
  }

  private parseLogLevel(level: string): LogLevel {
    const upperLevel = level.toUpperCase();
    switch (upperLevel) {
      case 'ERROR':
        return LogLevel.ERROR;
      case 'WARN':
        return LogLevel.WARN;
      case 'INFO':
        return LogLevel.INFO;
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'TRACE':
        return LogLevel.TRACE;
      default:
        return LogLevel.INFO;
    }
  }

  private parseCategories(categories: string): Set<LogCategory> {
    if (categories === 'ALL') {
      return new Set(Object.values(LogCategory));
    }

    const categoryList = categories.split(',').map((c) => c.trim().toUpperCase());
    const result = new Set<LogCategory>();

    for (const cat of categoryList) {
      if (cat in LogCategory) {
        result.add(cat as LogCategory);
      }
    }

    return result;
  }

  private shouldLog(level: LogLevel, category: LogCategory): boolean {
    return (
      level <= this.config.level &&
      this.config.enabledCategories.has(category)
    );
  }

  private formatMessage(
    level: LogLevel,
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any
  ): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.enableTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    // Correlation ID
    if (correlationId) {
      parts.push(`[${correlationId}]`);
    }

    // Level
    const levelName = LogLevel[level];
    if (this.config.enableColors) {
      parts.push(this.colorize(levelName, level));
    } else {
      parts.push(`[${levelName}]`);
    }

    // Category
    parts.push(`[${category}]`);

    // Message
    parts.push(message);

    // Data
    if (data !== undefined) {
      if (typeof data === 'object') {
        parts.push(JSON.stringify(data, null, 2));
      } else {
        parts.push(String(data));
      }
    }

    return parts.join(' ');
  }

  private colorize(text: string, level: LogLevel): string {
    const colors = {
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.WARN]: '\x1b[33m', // Yellow
      [LogLevel.INFO]: '\x1b[36m', // Cyan
      [LogLevel.DEBUG]: '\x1b[35m', // Magenta
      [LogLevel.TRACE]: '\x1b[90m', // Gray
    };
    const reset = '\x1b[0m';
    return `${colors[level]}[${text}]${reset}`;
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any,
    error?: Error
  ): void {
    if (!this.shouldLog(level, category)) {
      return;
    }

    const formattedMessage = this.formatMessage(
      level,
      category,
      message,
      correlationId,
      data
    );

    // Output to appropriate stream
    if (level === LogLevel.ERROR) {
      console.error(formattedMessage);
      if (error && this.config.enableStackTrace) {
        console.error(error.stack);
      }
    } else if (level === LogLevel.WARN) {
      console.warn(formattedMessage);
    } else {
      console.log(formattedMessage);
    }
  }

  // Public logging methods
  error(
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any,
    error?: Error
  ): void {
    this.log(LogLevel.ERROR, category, message, correlationId, data, error);
  }

  warn(
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any
  ): void {
    this.log(LogLevel.WARN, category, message, correlationId, data);
  }

  info(
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any
  ): void {
    this.log(LogLevel.INFO, category, message, correlationId, data);
  }

  debug(
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any
  ): void {
    this.log(LogLevel.DEBUG, category, message, correlationId, data);
  }

  trace(
    category: LogCategory,
    message: string,
    correlationId?: string,
    data?: any
  ): void {
    this.log(LogLevel.TRACE, category, message, correlationId, data);
  }

  // Convenience methods for common patterns
  entering(
    category: LogCategory,
    functionName: string,
    correlationId?: string,
    params?: any
  ): void {
    this.trace(category, `→ Entering ${functionName}`, correlationId, params);
  }

  exiting(
    category: LogCategory,
    functionName: string,
    correlationId?: string,
    result?: any
  ): void {
    this.trace(category, `← Exiting ${functionName}`, correlationId, result);
  }

  timing(
    category: LogCategory,
    operation: string,
    durationMs: number,
    correlationId?: string
  ): void {
    this.debug(
      category,
      `⏱️  ${operation} took ${durationMs}ms`,
      correlationId
    );
  }

  // Reload configuration (useful for runtime changes)
  reloadConfig(): void {
    this.config = this.loadConfig();
    this.info(
      LogCategory.GENERAL,
      'Logger configuration reloaded',
      undefined,
      this.config
    );
  }
}

// Singleton instance
export const logger = new Logger();

// Helper function to measure execution time
export async function measureTime<T>(
  category: LogCategory,
  operation: string,
  correlationId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    logger.timing(category, operation, duration, correlationId);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error(
      category,
      `${operation} failed after ${duration}ms`,
      correlationId,
      undefined,
      error as Error
    );
    throw error;
  }
}
