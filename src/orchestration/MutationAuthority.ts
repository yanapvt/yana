import type { OrchestrationFlow } from './Orchestrator.js';
import type { MemoryCandidate } from './TravellerMemory.js';
import { canonicalField, validateCriteria } from './WorkflowDefinitions.js';

const normalized = (value: string) => value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (value: string) => normalized(value).split(/\s+/).filter(Boolean);
const numberWords: Record<string, string> = { one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const otherPerson = '(?:wife|husband|partner|friend|friends|child|children|son|daughter|mother|father|parent|parents|sister|brother|sibling|siblings|cousin|aunt|uncle|grandmother|grandfather|grandparent|grandparents|companion|companions|family|guest|guests|colleague|colleagues)';
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const factSegments = (message: string) => message.split(/[.!?;]|,\s*(?=(?:and\s+)?(?:i|we|my|our|she|he|they)\b)|\s+and\s+(?=(?:i|we|my|our|she|he|they)\b)/i);

/** A place or preference mentioned in an information request is context for
 * the answer, not an instruction to replace saved traveller criteria. */
export function isInformationalRequest(message: string): boolean {
  const trimmed = message.trim();
  const discussion = /^(?:i|we)\s+(?:want|would like|need)\s+(?:to\s+(?:know|learn|ask|understand|hear|find out|compare|discuss)\b|(?:some\s+)?(?:information|details|advice|guidance|an overview)\b)/i.test(trimmed) ||
    /^(?:i|we)\s+(?:visited|have visited|went to|live in|lived in|used to live in)\b/i.test(trimmed);
  if (discussion) return true;
  const asks = /^(?:what|why|how|where|when|which|is|are|does|do|can|could|would|should|tell me|explain|describe)\b/i.test(trimmed) ||
    /\?\s*$/.test(trimmed);
  const changes = requestsExplicitChange(trimmed) ||
    /\b(?:change|update|replace|switch|move|set|make|correct)\b/i.test(trimmed);
  const requestsDiscovery = /\b(?:recommend|suggest|show|find|search|list)\b/i.test(trimmed) ||
    /\bwhat\s+(?:(?:activit(?:y|ies)|experiences?|things?)\s+)?(?:can|could|should)\s+(?:i|we)\s+(?:do|see|visit)\b/i.test(trimmed);
  return asks && !changes && !requestsDiscovery;
}

/** A model's confidence and explicit flag are claims, not evidence. Admit a
 * field only when its proposed value is grounded in this inbound message. */
export function travellerSupportsValue(message: string, value: unknown, field?: string): boolean {
  const words = tokens(message);
  if (typeof value === 'number') {
    const number = String(value);
    if (!words.includes(number) && !words.some((word) => numberWords[word] === number)) return false;
    if (!field) return true;
    const fieldWords = tokens(field.replace(/([a-z])([A-Z])/g, '$1 $2'));
    return fieldWords.some((word) => words.some((item) => item === word || item === `${word}s` || `${item}s` === word)) ||
      (field === 'guests' && /\bfor\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(message)) ||
      words.length === 1;
  }
  if (typeof value === 'string') {
    const expected = tokens(value);
    if (!expected.length) return false;
    // Calendar dates and times need an exact stated value. A model-derived
    // calendar conversion must be clarified by the backend before persistence.
    if (/Date$|Time$/.test(field ?? '')) {
      if (normalized(message).includes(normalized(value))) return true;
      if (/Date$/.test(field ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T00:00:00Z`);
        const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()];
        const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
          'august', 'september', 'october', 'november', 'december'][date.getUTCMonth()];
        return words.includes(weekday) ||
          words.includes(String(date.getUTCDate())) && words.some((word) => month.startsWith(word) && word.length >= 3);
      }
      return false;
    }
    const meaningful = expected.filter((word) => !['a', 'an', 'the', 'in', 'at', 'to', 'for', 'with', 'of', 'and'].includes(word));
    return meaningful.length > 0 && meaningful.every((word) => words.includes(word));
  }
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => travellerSupportsValue(message, item));
  if (value && typeof value === 'object') return Object.values(value).every((item) => travellerSupportsValue(message, item));
  return false;
}

export function supportedWorkflowFields(flow: OrchestrationFlow, proposed: Record<string, unknown>,
  message: string, context: { existingFields?: object; pendingField?: string;
    confirmedLocation?: string } = {}): Record<string, unknown> {
  if (isInformationalRequest(message)) return {};
  const grounded: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(proposed)) {
    const canonical = canonicalField(flow, field);
    if (!canonical || !travellerSupportsValue(message, value, canonical)) continue;
    const previous = (context.existingFields as Record<string, unknown> | undefined)?.[canonical];
    const confirmingLocation = !context.pendingField && canonical === 'location' && typeof value === 'string' &&
      normalized(value) === normalized(context.confirmedLocation ?? '') &&
      normalized(message) === `yes ${normalized(value)}`;
    const answeringPending = context.pendingField === canonical || confirmingLocation;
    const explicitChange = requestsCriteriaChange(message, canonical) ||
      requestsIndependentCriterion(message, canonical) ||
      (canonical === 'additionalPreferences' &&
        /\bplease[.!]?\s*$/i.test(message) && tokens(message).length >= 2);
    if (context.pendingField && !answeringPending && !explicitChange &&
        !requestsIndependentCriterion(message, canonical)) continue;
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value) &&
        !answeringPending && !requestsIndependentCriterion(message, canonical) &&
        !requestsCriteriaChange(message, canonical)) continue;
    if (previous === undefined && !answeringPending && !explicitChange && !requestsNewCriterion(message, canonical, value)) continue;
    grounded[field] = value;
  }
  return validateCriteria(flow, grounded, false);
}

/** A separately stated field remains valid while another answer is pending. */
function requestsIndependentCriterion(message: string, field: string): boolean {
  const label = field === 'location' || field === 'destination' ? '(?:area|location|destination)'
    : field === 'guests' ? '(?:guests?|people)' : field === 'durationNights' ? '(?:nights?|duration)'
      : field.replace(/([a-z])([A-Z])/g, '$1 $2');
  return new RegExp(`\\b(?:my|our|the)\\s+${label}\\s+(?:is|should be|to)\\b`, 'i').test(message);
}

export function requestsExplicitFieldChange(message: string): boolean {
  return !isInformationalRequest(message) && requestsExplicitChange(message);
}

function requestsCriteriaChange(message: string, field: string): boolean {
  const text = message.trim();
  const labels = field === 'location' || field === 'destination' ? /\b(?:area|location|destination|town|place to stay)\b/i
    : field === 'guests' ? /\b(?:guests?|people|travellers?)\b/i
      : field === 'durationNights' ? /\b(?:nights?|duration)\b/i
        : field === 'additionalPreferences' ? /\b(?:preferences?|style|must.have|avoid|add|pool|view|quiet)\b/i
          : new RegExp(`\\b${field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, '[ -]?')}\\b`, 'i');
  if (requestsExplicitChange(text) && (labels.test(text) || /\b(?:instead|rather than)\b|^(?:actually|correction:)/i.test(text))) return true;
  if (field === 'additionalPreferences' || /(?:Style|Preference|interests|category|budget)/i.test(field))
    return /\b(?:prefer|must have|add|avoid)\b|^somewhere\b/i.test(text) ||
      /\b(?:want|would like)\s+(?!to\b|(?:(?:a|an|the)\s+)?(?:hotels?|stays?|restaurants?|places?|trips?|excursions?|activities|transport)\b)/i.test(text) ||
      /\bplease[.!]?\s*$/i.test(text) && tokens(text).length >= 2;
  if (field === 'location' || field === 'destination')
    return /\b(?:look(?:ing)?(?:\s+for)?|somewhere|search|find|show|recommend|stay|go|book|reserve)\b.*\b(?:in|near|around|at|to)\b/i.test(text) ||
      /\blet['’]?s\s+look\s+around\b/i.test(text);
  if (field === 'guests' || field === 'durationNights' || field === 'rooms' ||
      field === 'passengers' || field === 'children' || field === 'adults')
    return labels.test(text) && /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(text);
  if (/Date$|Time$/.test(field) && /\b(?:make it|have|on|at|for|change|move|shift|reschedule)\b/i.test(text)) return true;
  return labels.test(text) && /\b(?:prefer|want|would like|make it|change|set)\b/i.test(text);
}

function requestsNewCriterion(message: string, field: string, value: unknown): boolean {
  // A request to search is not authority to save every model-suggested field.
  // The instruction must identify the proposed criterion itself.
  if (requestsCriteriaChange(message, field) || requestsIndependentCriterion(message, field)) return true;
  if (field === 'location' || field === 'destination' || field === 'pickupLocation' || field === 'dropOffLocation') {
    if (typeof value !== 'string' ||
        !(/\b(?:find|search|show|recommend|look|book|reserve)\b/i.test(message) ||
          /\bwhat\s+(?:(?:activit(?:y|ies)|experiences?|things?)\s+)?(?:can|could|should)\s+(?:i|we)\s+(?:do|see|visit)\b/i.test(message))) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const relation = field === 'pickupLocation' ? 'from|at' : field === 'dropOffLocation' ? 'to|at' : 'in|near|around|at|to';
    return new RegExp(`\\b(?:${relation})\\s+${escaped}\\b`, 'i').test(message);
  }
  if (field === 'guests') return /\bfor\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(message);
  if (field === 'cuisine') return /\b(?:restaurants?|dining|food|cuisine)\b/i.test(message);
  return false;
}

function requestsExplicitChange(message: string): boolean {
  return /\b(?:change|update|replace|switch|move|set|correct)\s+(?:(?:my|our|the|this)\s+)?(?:\w+\s+){0,4}?(?:to|with)\b/i.test(message) ||
    /\b(?:use|make)\s+.+?\s+instead\s+of\b/i.test(message) ||
    /\b(?:instead|rather than)\b/i.test(message) ||
    /^(?:actually|correction:)\b/i.test(message) ||
    /\b(?:can|could|would|should)\s+we\s+(?:have|stay|go|eat|dine)\b/i.test(message);
}

export function supportedMemoryCandidates(candidates: MemoryCandidate[], message: string): MemoryCandidate[] {
  if (isInformationalRequest(message)) return [];
  return candidates.filter((candidate) => {
    if (!candidate.explicit || !travellerSupportsValue(message, candidate.value)) return false;
    if (candidate.key === 'companion_relationship')
      return new RegExp(`\\b(?:my|our)\\s+${normalized(candidate.value)}\\b`, 'i').test(message);
    if (candidate.key === 'companion_name') {
      const name = escapePattern(candidate.value);
      return factSegments(message).some((segment) =>
        new RegExp(`\\b(?:my|our)\\s+${otherPerson}\\b.{0,45}?\\b(?:name is|called|named)\\s+${name}\\b`, 'i').test(segment) ||
        new RegExp(`\\b${name}\\s+is\\s+(?:my|our)\\s+${otherPerson}\\b`, 'i').test(segment));
    }
    return travellerOwnsFact(message, candidate);
  });
}

/** Attribute a fact to the subject and beneficiary of the clause that states it.
 * If either is unclear, do not confirm it as the traveller's own fact. */
function travellerOwnsFact(message: string, candidate: MemoryCandidate): boolean {
  return factSegments(message).some((segment) => travellerOwnsFactInSegment(segment, candidate));
}

function travellerOwnsFactInSegment(segment: string, candidate: MemoryCandidate): boolean {
  const clause = segment.toLocaleLowerCase();
  const position = clause.indexOf(candidate.value.toLocaleLowerCase());
  if (position < 0) return false;
  const before = clause.slice(0, position);
  const after = clause.slice(position + candidate.value.length);
  // A first-person request made on somebody else's behalf is not personal memory.
  if (new RegExp(`\\b(?:for|on behalf of|about)\\s+(?:(?:my|our|his|her|their|the)\\s+)?${otherPerson}\\b`, 'i').test(after)) return false;
  const subjects = new RegExp(`\\b(?:my|our|his|her|their)\\s+${otherPerson}\\b|\\b(?:i|we|she|he|they)\\b`, 'gi');
  const ownerMatch = [...before.matchAll(subjects)].at(-1);
  const owner = ownerMatch?.[0];
  const fieldLabels: Partial<Record<MemoryCandidate['key'], string>> = {
    current_location: 'current\\s+location|location', trip_destination: 'trip\\s+destination|destination',
    preference: 'preference', dislike: 'dislike', dietary_requirement: 'dietary\\s+(?:requirement|preference)',
    allergy: 'allergy', accessibility_need: 'accessibility\\s+(?:need|requirement)',
    budget_preference: 'budget(?:\\s+preference)?',
    communication_preference: 'communication\\s+preference', occasion: 'occasion',
  };
  const label = fieldLabels[candidate.key];
  const explicitSelf = label && new RegExp(`\\b(?:set|change|update|correct)\\s+my\\s+(?:${label})\\s+(?:to|as)\\b`, 'i').test(before);
  if (owner !== 'i' && !(owner === 'we' && candidate.scope !== 'profile') && !explicitSelf) return false;
  // A model's key is only a proposal. The traveller's predicate must support
  // its meaning; mentioning a value in a denial or neutral account is not a
  // positive preference, even when the subject is the traveller.
  if (candidate.key === 'preference' || candidate.key === 'dietary_requirement' ||
      candidate.key === 'budget_preference' || candidate.key === 'communication_preference' ||
      candidate.key === 'dislike') {
    const predicate = before.slice(ownerMatch?.index === undefined ? 0 : ownerMatch.index + owner!.length).trim();
    const negative = /\b(?:dislike|hate|avoid|never|not|no|don't|dont|do not|wouldn't|would not|cannot|can't)\b/i.test(predicate);
    const positive = /\b(?:prefer|like|love|enjoy|want|need|require|must have|choose|set|change|update)\b/i.test(predicate);
    const uncertain = /\b(?:maybe|perhaps|might|possibly|unsure|not sure|considering)\b/i.test(predicate);
    if (uncertain || !positive && !negative) return false;
    if (candidate.key === 'dislike') return negative &&
      !/\b(?:do not|don't|dont|not|never)\s+(?:dislike|hate|avoid)\b/i.test(predicate);
    if (negative) return false;
    return positive;
  }
  if (candidate.key === 'current_location')
    return Boolean(explicitSelf) || /\b(?:am|are|currently|right now|located|staying|live)\b.*\b(?:in|at|near)\b/i.test(before);
  if (candidate.key === 'trip_destination')
    return Boolean(explicitSelf) || /\b(?:going|travelling|traveling|visiting|coming|heading|trip)\b.*\b(?:to|in|near)\b/i.test(before);
  return true;
}
