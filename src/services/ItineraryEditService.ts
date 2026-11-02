import { z } from 'zod';
import { getItinerarySessionService, type ItinerarySessionService, type ItinerarySession } from './itinerarySessionService.js';
import { PersistenceError } from '../storage/Persistence.js';

export const itineraryEditSchema = z.object({
  version: z.literal('1.0'), tripId: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(), day: z.number().int().min(1).max(14),
  operation: z.literal('replace'), target: z.enum(['morning', 'afternoon', 'evening', 'hotel', 'transport']),
  value: z.string().trim().min(1).max(500),
}).strict();
export type ItineraryEditCommand = z.infer<typeof itineraryEditSchema>;

export function resolveItineraryEdit(text: string, session: ItinerarySession): ItineraryEditCommand | null {
  const dayMatch = text.match(/\bday\s+(\d+)\b/i);
  const day = dayMatch ? Number(dayMatch[1]) : session.currentDay ?? (session.itinerary?.days.length === 1 ? 1 : undefined);
  if (!day) return null;
  const replace = text.match(/\b(?:replace|change|set)\s+(?:day\s+\d+\s+)?(morning|afternoon|evening|hotel|transport)(?:\s+(?:on\s+)?day\s+\d+)?\s+(?:with|to)\s+(.+)$/i);
  if (replace) return itineraryEditSchema.parse({ version: '1.0', tripId: session.id, expectedRevision: session.revision ?? 0,
    day, operation: 'replace', target: replace[1].toLowerCase(), value: replace[2] });
  // This is a proposed activity, never a supplier/booking confirmation.
  if (/\bmore beach time\b/i.test(text)) return itineraryEditSchema.parse({ version: '1.0', tripId: session.id,
    expectedRevision: session.revision ?? 0, day, operation: 'replace', target: 'afternoon', value: 'Free time at a nearby beach, subject to local conditions. No activity or transfer is booked.' });
  return null;
}

export class ItineraryEditService {
  constructor(private readonly sessions: ItinerarySessionService = getItinerarySessionService()) {}
  async apply(userId: string, input: unknown): Promise<ItinerarySession> {
    const command = itineraryEditSchema.parse(input);
    const current = await this.sessions.getAuthoritative(userId);
    if (!current?.itinerary || current.id !== command.tripId || (current.revision ?? 0) !== command.expectedRevision) throw new PersistenceError('conflict');
    const itinerary = structuredClone(current.itinerary);
    const day = itinerary.days.find((entry) => entry.day === command.day);
    if (!day) throw new Error('Choose an existing itinerary day.');
    if (day[command.target] === command.value) return current;
    day[command.target] = command.value;
    return this.sessions.commitEdit(userId, command.tripId, command.expectedRevision, itinerary);
  }
}
