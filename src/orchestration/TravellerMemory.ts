import { z } from 'zod';

export const MEMORY_KEYS = [
  'occasion', 'companion_name', 'companion_relationship', 'preference', 'dislike',
  'dietary_requirement', 'allergy', 'accessibility_need', 'budget_preference',
  'communication_preference', 'current_location', 'trip_destination',
] as const;

export const MEMORY_SCOPES = ['profile', 'trip', 'task'] as const;
export const MEMORY_STATUSES = ['proposed', 'confirmed', 'rejected', 'superseded'] as const;

export type TravellerMemoryKey = typeof MEMORY_KEYS[number];
export type TravellerMemoryScope = typeof MEMORY_SCOPES[number];
export type TravellerMemoryStatus = typeof MEMORY_STATUSES[number];

export interface MemoryCandidate {
  key: TravellerMemoryKey;
  value: string;
  scope: TravellerMemoryScope;
  confidence: number;
  explicit: boolean;
  requiresConfirmation?: boolean;
}

export interface TravellerMemoryFact extends MemoryCandidate {
  id: string;
  userId: string;
  contextId?: string;
  status: TravellerMemoryStatus;
  sensitive: boolean;
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export const memoryCandidateSchema = z.object({
  key: z.enum(MEMORY_KEYS),
  value: z.string().trim().min(1).max(300),
  scope: z.enum(MEMORY_SCOPES).default('trip'),
  confidence: z.number().finite().min(0).max(1),
  explicit: z.boolean(),
  requiresConfirmation: z.boolean().optional(),
}).strict();

const SENSITIVE_KEYS = new Set<TravellerMemoryKey>(['allergy', 'accessibility_need']);

export function validateMemoryCandidates(input: unknown): MemoryCandidate[] {
  if (!Array.isArray(input)) return [];
  const accepted: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 12)) {
    const parsed = memoryCandidateSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.explicit || parsed.data.confidence < 0.75) continue;
    const candidate = {
      ...parsed.data,
      // Companion details and occasions must never silently become global profile data.
      scope: (['occasion', 'companion_name', 'companion_relationship', 'current_location', 'trip_destination'].includes(parsed.data.key)
        ? 'trip' : parsed.data.scope) as TravellerMemoryScope,
      requiresConfirmation: SENSITIVE_KEYS.has(parsed.data.key) || parsed.data.requiresConfirmation === true,
    };
    const identity = `${candidate.scope}:${candidate.key}:${candidate.value.toLocaleLowerCase()}`;
    if (!seen.has(identity)) { accepted.push(candidate); seen.add(identity); }
  }
  return accepted;
}

export function isSensitiveMemory(key: TravellerMemoryKey): boolean {
  return SENSITIVE_KEYS.has(key);
}

export function relevantMemories(facts: TravellerMemoryFact[], flow?: string): TravellerMemoryFact[] {
  const relevantKeys = new Set<TravellerMemoryKey>(
    flow === 'restaurant' ? ['occasion', 'companion_name', 'companion_relationship', 'preference', 'dislike', 'dietary_requirement', 'allergy', 'accessibility_need', 'budget_preference']
      : flow === 'hotel' ? ['occasion', 'companion_name', 'companion_relationship', 'preference', 'dislike', 'dietary_requirement', 'allergy', 'accessibility_need', 'budget_preference']
      : flow === 'excursion' ? ['occasion', 'companion_name', 'companion_relationship', 'preference', 'dislike', 'accessibility_need', 'budget_preference']
      : flow === 'logistics' ? ['companion_name', 'companion_relationship', 'accessibility_need', 'budget_preference', 'preference', 'current_location', 'trip_destination']
      : [...MEMORY_KEYS]
  );
  relevantKeys.add('current_location');
  relevantKeys.add('trip_destination');
  return facts.filter((fact) => fact.status === 'confirmed' && (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now()) && relevantKeys.has(fact.key)).slice(0, 20);
}
