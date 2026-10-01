export type FailureCategory = 'timeout' | 'malformed_response' | 'provider_outage' | 'unexpected';
export type TravelService = 'hotel' | 'restaurant' | 'excursion' | 'transport' | 'planning' | 'voice';

export interface SafeOperatorLogger {
  error(event: string, details: Record<string, unknown>): void;
}

export interface SafeFailureResult {
  category: FailureCategory;
  reply: string;
}

export function handleTravelFailure(
  service: TravelService,
  correlationId: string,
  error: unknown,
  logger: SafeOperatorLogger = console
): SafeFailureResult {
  const category = classifyFailure(error);
  logSafeOperatorFailure(logger, 'travel_service_operation_failed', correlationId, error, {
    correlationId,
    service,
    retryable: category !== 'malformed_response',
  });
  return { category, reply: buildSafeReply(service, category) };
}

export function logSafeOperatorFailure(
  logger: SafeOperatorLogger,
  event: string,
  correlationId: string,
  error: unknown,
  details: Record<string, unknown> = {}
): FailureCategory {
  const category = classifyFailure(error);
  logger.error(event, { ...details, correlationId, category });
  return category;
}

export async function attemptSafeFallback<T>(
  providers: Array<() => Promise<T>>,
  isValid: (value: T) => boolean
): Promise<{ success: true; value: T; providerIndex: number } | { success: false }> {
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    try {
      const value = await providers[providerIndex]();
      if (isValid(value)) return { success: true, value, providerIndex };
    } catch {
      // Provider details remain inside the adapter boundary. Continue safely.
    }
  }
  return { success: false };
}

export function classifyFailure(error: unknown): FailureCategory {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code).toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (code.includes('timeout') || message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (code.includes('malformed') || code.includes('schema') || message.includes('malformed') || message.includes('invalid response')) {
    return 'malformed_response';
  }
  if (code.includes('unavailable') || code.includes('connection') || message.includes('unavailable') || message.includes('outage')) {
    return 'provider_outage';
  }
  return 'unexpected';
}

function buildSafeReply(service: TravelService, category: FailureCategory): string {
  const label = service === 'planning' ? 'trip plan' : service === 'voice' ? 'voice note' : `${service} search`;
  if (category === 'timeout') {
    return `The ${label} is taking longer than expected. Your details are saved; please try again shortly or ask for human help.`;
  }
  if (category === 'provider_outage') {
    return `The ${label} is temporarily unavailable. Your details are saved; please retry later or ask for human help.`;
  }
  return `I could not complete the ${label} safely. Your details are saved; please try again or ask for human help.`;
}
