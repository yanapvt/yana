import type { HotelSupplierProviderConfig } from '../../config/hotelSuppliers.js';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import type {
  HotelSearchRequest,
  NormalizedHotelRate,
  SupplierHotelSearchResult,
  SupplierId,
  YanaHotel,
} from './types.js';

export type SupplierExecutionStatus =
  | 'success'
  | 'disabled'
  | 'not_registered'
  | 'rate_limited'
  | 'circuit_open'
  | 'timeout'
  | 'failed';

export interface SupplierExecutionOutcome {
  supplier: SupplierId;
  status: SupplierExecutionStatus;
  attempts: number;
  durationMs: number;
  result?: SupplierHotelSearchResult;
  error?: string;
}

export interface HotelSupplierOrchestrationResult {
  hotels: YanaHotel[];
  rates: NormalizedHotelRate[];
  outcomes: SupplierExecutionOutcome[];
  partialFailure: boolean;
  correlationId: string;
}

export interface SupplierHealthSnapshot {
  supplier: SupplierId;
  enabled: boolean;
  registered: boolean;
  circuit: 'closed' | 'open';
  consecutiveFailures: number;
  openUntil?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
}

interface SupplierRegistration {
  config: HotelSupplierProviderConfig;
  adapter?: HotelSupplierAdapter;
}

interface SupplierRuntimeState {
  consecutiveFailures: number;
  openUntil?: number;
  requestTimestamps: number[];
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
}

export interface HotelSupplierOrchestratorLogger {
  info(event: string, data: Record<string, unknown>): void;
  warn(event: string, data: Record<string, unknown>): void;
}

const defaultLogger: HotelSupplierOrchestratorLogger = {
  info: (event, data) => console.log(`[HotelSupplierOrchestrator] ${event}`, data),
  warn: (event, data) => console.warn(`[HotelSupplierOrchestrator] ${event}`, data),
};

export class HotelSupplierOrchestrator {
  private readonly registrations: SupplierRegistration[];
  private readonly states = new Map<SupplierId, SupplierRuntimeState>();

  constructor(
    configs: HotelSupplierProviderConfig[],
    adapters: HotelSupplierAdapter[],
    private readonly logger: HotelSupplierOrchestratorLogger = defaultLogger,
    private readonly clock: () => number = () => Date.now()
  ) {
    const adaptersBySupplier = new Map(adapters.map((adapter) => [adapter.supplier, adapter]));
    this.registrations = [...configs]
      .sort((left, right) => left.priority - right.priority)
      .map((config) => ({ config, adapter: adaptersBySupplier.get(config.supplier) }));
  }

  async searchHotels(request: HotelSearchRequest): Promise<HotelSupplierOrchestrationResult> {
    const outcomes = await Promise.all(
      this.registrations.map((registration) => this.executeSupplier(registration, request))
    );
    const successful = outcomes.filter(
      (outcome): outcome is SupplierExecutionOutcome & { result: SupplierHotelSearchResult } =>
        outcome.status === 'success' && outcome.result !== undefined
    );
    const attempted = outcomes.filter(
      (outcome) => !['disabled', 'not_registered'].includes(outcome.status)
    );

    return {
      hotels: successful.flatMap((outcome) => outcome.result.hotels),
      rates: successful.flatMap((outcome) => outcome.result.rates),
      outcomes,
      partialFailure:
        successful.length > 0 && attempted.some((outcome) => outcome.status !== 'success'),
      correlationId: request.correlationId,
    };
  }

  getHealth(): SupplierHealthSnapshot[] {
    const now = this.clock();
    return this.registrations.map(({ config, adapter }) => {
      const state = this.getState(config.supplier);
      const circuitOpen = state.openUntil !== undefined && state.openUntil > now;
      return {
        supplier: config.supplier,
        enabled: config.enabled,
        registered: adapter !== undefined,
        circuit: circuitOpen ? 'open' : 'closed',
        consecutiveFailures: state.consecutiveFailures,
        openUntil: circuitOpen ? new Date(state.openUntil!).toISOString() : undefined,
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        lastError: state.lastError,
      };
    });
  }

  private async executeSupplier(
    registration: SupplierRegistration,
    request: HotelSearchRequest
  ): Promise<SupplierExecutionOutcome> {
    const { config, adapter } = registration;
    const startedAt = this.clock();
    if (!config.enabled) return this.outcome(config.supplier, 'disabled', 0, startedAt);
    if (!adapter) return this.outcome(config.supplier, 'not_registered', 0, startedAt);

    const state = this.getState(config.supplier);
    if (state.openUntil && state.openUntil > startedAt) {
      return this.outcome(config.supplier, 'circuit_open', 0, startedAt, undefined, state.lastError);
    }
    if (!this.consumeRateLimit(state, config.rateLimitPerMinute, startedAt)) {
      return this.outcome(config.supplier, 'rate_limited', 0, startedAt);
    }

    let lastError: unknown;
    let lastStatus: SupplierExecutionStatus = 'failed';
    const totalAttempts = config.maxRetries + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        const result = await this.withTimeout(
          (signal) => adapter.searchHotels({ ...request, signal }),
          config.timeoutMs
        );
        this.recordSuccess(state);
        this.logger.info('supplier_search_succeeded', {
          supplier: config.supplier,
          correlationId: request.correlationId,
          attempt,
          durationMs: this.clock() - startedAt,
          hotels: result.hotels.length,
          rates: result.rates.length,
        });
        return this.outcome(config.supplier, 'success', attempt, startedAt, result);
      } catch (error) {
        lastError = error;
        lastStatus = error instanceof SupplierTimeoutError ? 'timeout' : 'failed';
        if (attempt < totalAttempts && config.retryDelayMs > 0) {
          await delay(config.retryDelayMs * attempt);
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'Supplier search failed';
    this.recordFailure(state, config, message);
    this.logger.warn('supplier_search_failed', {
      supplier: config.supplier,
      correlationId: request.correlationId,
      attempts: totalAttempts,
      durationMs: this.clock() - startedAt,
      status: lastStatus,
      error: message,
    });
    return this.outcome(config.supplier, lastStatus, totalAttempts, startedAt, undefined, message);
  }

  private async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new SupplierTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private consumeRateLimit(
    state: SupplierRuntimeState,
    limit: number,
    now: number
  ): boolean {
    const windowStart = now - 60_000;
    state.requestTimestamps = state.requestTimestamps.filter((timestamp) => timestamp > windowStart);
    if (state.requestTimestamps.length >= limit) return false;
    state.requestTimestamps.push(now);
    return true;
  }

  private recordSuccess(state: SupplierRuntimeState): void {
    state.consecutiveFailures = 0;
    state.openUntil = undefined;
    state.lastSuccessAt = new Date(this.clock()).toISOString();
    state.lastError = undefined;
  }

  private recordFailure(
    state: SupplierRuntimeState,
    config: HotelSupplierProviderConfig,
    message: string
  ): void {
    state.consecutiveFailures += 1;
    state.lastFailureAt = new Date(this.clock()).toISOString();
    state.lastError = message;
    if (state.consecutiveFailures >= config.circuitFailureThreshold) {
      state.openUntil = this.clock() + config.circuitCooldownMs;
    }
  }

  private getState(supplier: SupplierId): SupplierRuntimeState {
    const existing = this.states.get(supplier);
    if (existing) return existing;
    const state = { consecutiveFailures: 0, requestTimestamps: [] };
    this.states.set(supplier, state);
    return state;
  }

  private outcome(
    supplier: SupplierId,
    status: SupplierExecutionStatus,
    attempts: number,
    startedAt: number,
    result?: SupplierHotelSearchResult,
    error?: string
  ): SupplierExecutionOutcome {
    return {
      supplier,
      status,
      attempts,
      durationMs: Math.max(0, this.clock() - startedAt),
      result,
      error,
    };
  }
}

class SupplierTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Supplier request timed out after ${timeoutMs}ms`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
