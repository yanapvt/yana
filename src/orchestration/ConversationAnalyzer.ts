import type {
  ConversationAnalysis,
  ConversationRole,
  OrchestrationContext,
  OrchestrationFlow,
  OrchestrationIntent,
} from './Orchestrator.js';

export class ConversationAnalyzer {
  analyze(context: OrchestrationContext): ConversationAnalysis {
    const rawText = context.message.text;
    const normalized = normalize(rawText);
    const deterministic = detectDeterministicIntent(
      normalized,
      context.activeSession?.flow
    );
    const pendingFlow = flowForConversationTopic(context.conversationTopic);
    const pendingField = expectedFieldForConversation(pendingFlow, context.pendingQuestion?.expectedAnswerType);
    const pendingApplies = pendingFlow !== 'none' && pendingField &&
      (!context.activeSession || context.activeSession.flow === pendingFlow) &&
      !isExplicitServiceRequest(normalized, deterministic.targetFlow, pendingFlow);
    const pendingAnswer = pendingApplies
      ? extractAwaitedFieldAnswer(pendingField, rawText) : undefined;
    if (pendingAnswer !== undefined) {
      return { role: 'answer_to_current_question', intent: intentForFlow(pendingFlow),
        targetFlow: pendingFlow, entities: { [pendingField!]: pendingAnswer },
        confidence: 0.9, rawText, shouldUseLLM: true };
    }
    // A short reply to a structured question must be validated before it can
    // become a result ordinal or a different field. Explicit commands, side
    // questions and service changes retain their normal routes.
    if (pendingApplies && !isQuestion(normalized) &&
        deterministic.intent !== 'smalltalk' &&
        normalized.split(/\s+/).length <= 4 &&
        !/^(?:reset|restart|start over|cancel|clear|status|update|resume|continue|waiting|still waiting|any update|show results|next|more|show more|details\s*[1-3]|book\s*[1-3])$/.test(normalized)) {
      return { role: 'unclear', intent: 'unclear', targetFlow: pendingFlow,
        entities: {}, confidence: 0.35, rawText, shouldUseLLM: true,
        pendingAnswerMismatch: true };
    }
    const command = detectCommand(normalized, context);
    if (command) {
      return {
        role: 'command', intent: 'command',
        targetFlow: context.activeSession?.flow ?? 'none',
        entities: parseCommandEntities(normalized, context), command,
        confidence: 1, rawText, shouldUseLLM: false,
      };
    }
    if (deterministic.intent !== 'unclear') {
      const isServiceSwitch = Boolean(context.activeSession) &&
        deterministic.targetFlow !== 'none' &&
        deterministic.targetFlow !== context.activeSession?.flow;
      return {
        role: roleForIntent(deterministic.intent, context.activeSession?.flow),
        intent: deterministic.intent,
        targetFlow: deterministic.targetFlow,
        entities: { ...deterministic.entities, ...resolveDisplayedResultReference(normalized, context) },
        confidence: deterministic.confidence,
        rawText,
        // Explicit service switches still use the LLM for natural acknowledgement,
        // ambiguity detection and extraction. CORE keeps routing authority.
        // With an active journey, even polite small talk can carry control
        // meaning (pause, defer, decline, resume). Let the bounded model
        // interpret that nuance while CORE retains transition authority.
        // The primary model interprets the complete current turn in context,
        // including apparent service intents. CORE still owns execution.
        shouldUseLLM: true,
      };
    }

    const awaitedAnswer = extractAwaitedFieldAnswer(
      context.activeSession?.awaitedField,
      rawText
    );
    if (context.activeSession && awaitedAnswer !== undefined) {
      return {
        role: 'answer_to_current_question',
        intent: intentForFlow(context.activeSession.flow),
        targetFlow: context.activeSession.flow,
        entities: { [context.activeSession.awaitedField!]: awaitedAnswer, ...resolveDisplayedResultReference(normalized, context) },
        confidence: 0.98,
        rawText,
        // Short answers to an active form still benefit from contextual
        // interpretation (and can be a side question rather than a field).
        shouldUseLLM: true,
      };
    }

    if (isQuestion(normalized)) {
      return {
        role: 'question_or_faq',
        intent: 'unclear',
        targetFlow: context.activeSession?.flow ?? 'none',
        entities: resolveDisplayedResultReference(normalized, context),
        question: rawText,
        confidence: 0.7,
        rawText,
        shouldUseLLM: true,
      };
    }

    return {
      role: context.activeSession ? 'extra_preference' : 'unclear',
      intent: 'unclear',
      targetFlow: context.activeSession?.flow ?? 'none',
      entities: resolveDisplayedResultReference(normalized, context),
      confidence: context.activeSession ? 0.55 : 0.35,
      rawText,
      shouldUseLLM: true,
    };
  }
}

function flowForConversationTopic(topic?: string): OrchestrationFlow {
  return topic === 'hotel' || topic === 'restaurant' || topic === 'excursion' ||
    topic === 'logistics' || topic === 'itinerary' ? topic : 'none';
}

/** An inbound answer can itself prove a staged question reached the traveller
 * before the provider's acceptance callback was processed. */
export function answersStagedQuestion(flow: OrchestrationFlow,
  question: { expectedAnswerType?: string }, text: string): boolean {
  const field = expectedFieldForConversation(flow, question.expectedAnswerType);
  const normalized = normalize(text);
  const detected = detectDeterministicIntent(normalized, flow);
  return Boolean(field && !isExplicitServiceRequest(normalized, detected.targetFlow, flow) &&
    extractAwaitedFieldAnswer(field, text) !== undefined);
}

/** Map conversational answer types onto existing validated workflow fields. */
export function expectedFieldForConversation(flow: OrchestrationFlow, answerType?: string): string | undefined {
  if (answerType === 'preference') return flow !== 'none' && flow !== 'profile'
    ? 'additionalPreferences' : undefined;
  if (answerType === 'destination') return flow === 'excursion' || flow === 'logistics' ? 'destination' : undefined;
  if (answerType === 'airport') return flow === 'hotel' || flow === 'restaurant' ? 'location'
    : flow === 'logistics' ? 'pickupLocation' : flow === 'itinerary' ? 'arrivalAirport' : undefined;
  if (answerType === 'location') return flow === 'excursion' ? 'destination'
    : flow === 'logistics' ? 'pickupLocation'
      : flow === 'hotel' || flow === 'restaurant' ? 'location' : undefined;
  if (answerType === 'guests') return flow === 'hotel' || flow === 'restaurant' || flow === 'excursion' ? 'guests' : undefined;
  if (answerType === 'nights') return flow === 'hotel' ? 'durationNights' : undefined;
  if (answerType === 'checkinDate' || answerType === 'checkoutDate') {
    return flow === 'hotel' ? answerType : undefined;
  }
  if (answerType === 'passengers') return flow === 'logistics' ? 'passengers' : undefined;
  if (answerType === 'date') return flow === 'restaurant' ? 'diningDate'
    : flow === 'excursion' ? 'preferredDate' : flow === 'logistics' ? 'pickupDate' : undefined;
  if (answerType === 'time') return flow === 'restaurant' ? 'diningTime'
    : flow === 'excursion' ? 'preferredTime' : flow === 'logistics' ? 'pickupTime' : undefined;
  return undefined;
}

/** A backend check on the purpose of a proposed assistant question. This uses
 * the existing deterministic service hints; it does not interpret user intent. */
type QuestionPurpose = { text: string; expectedAnswerType: string;
  flow: OrchestrationFlow; ambiguous?: boolean; ambiguousField?: boolean };

/** Bounded to the existing answer types. A conjunction is split only if each
 * clause independently names a different field. */
function answerTypes(text: string): string[] {
  const normalized = normalize(text);
  const types: string[] = [];
  const checkin = /\bcheck[ -]?in\b/.test(normalized);
  const checkout = /\bcheck[ -]?out\b/.test(normalized);
  if (checkin) types.push('checkinDate');
  if (checkout) types.push('checkoutDate');
  if (/\bnights?\b/.test(normalized)) types.push('nights');
  if (/\bairports?\b/.test(normalized)) types.push('airport');
  if (/\b(?:town|area|neighbou?rhood|location|where|destination|pick.?up|drop.?off)\b/.test(normalized)) types.push('location');
  if (/\b(?:guests?|people|adults|children)\b/.test(normalized)) types.push('guests');
  if (/\bpassengers?\b/.test(normalized)) types.push('passengers');
  if (!checkin && !checkout && /\b(?:dates?|when|days?)\b/.test(normalized)) types.push('date');
  if (/\b(?:time|hour)\b/.test(normalized)) types.push('time');
  if (/\b(?:preferences?|style|kind|type|sort|budget|cuisine)\b/.test(normalized)) types.push('preference');
  return types;
}

/** Extract each question separately. Optional metadata is used only when no
 * delivered response exists; it cannot change the meaning of visible text. */
export function fieldQuestionPurposes(response?: string,
  declared?: { text: string; expectedAnswerType?: string }): QuestionPurpose[] {
  const questions = response === undefined ? (declared?.text ? [declared.text.trim()] : [])
    : (response.match(/[^.!?\n]{3,250}\?/g) ?? []).map((text) => text.trim());
  // Keep ownership cues bounded to the five registered workflows. An airport
  // alone names a place, and a question naming two services has no single owner.
  const cues: Array<[OrchestrationFlow, RegExp]> = [
    ['hotel', /\b(?:hotels?|stays?|accommodation|rooms?|resorts?|nights?)\b/],
    ['restaurant', /\b(?:restaurants?|dining|dine|meal|lunch|dinner)\b/],
    ['excursion', /\b(?:excursions?|activities|attractions?|tours?|experiences?)\b/],
    ['logistics', /\b(?:transport|transfers?|taxis?|drivers?|rides?)\b/],
    ['itinerary', /\b(?:itinerar(?:y|ies)|trip plans?|schedule)\b/],
  ];
  const parsed = questions.flatMap((question): QuestionPurpose[] => {
    const clauses = question.split(/\s+and\s+/i);
    const clauseTypes = clauses.map(answerTypes);
    const coordinated = clauses.length > 1 && clauses.length <= 3 &&
      clauseTypes.every((types) => types.length === 1) &&
      new Set(clauseTypes.map(([type]) => type)).size === clauses.length;
    // An unrecognized second interrogative or overlapping field types cannot
    // safely be reduced to the first field. Ask for clarification instead.
    const unclearCoordination = clauses.length > 1 && !coordinated &&
      (clauseTypes.some((types) => types.length > 1) ||
        clauses.slice(1).some((clause) => /^(?:what|which|where|when|how)\b/i.test(clause.trim())));
    const parts = coordinated ? clauses.map((clause, index) =>
      index === clauses.length - 1 ? clause.trim() : clause.trim().replace(/\?$/, '')) : [question];
    return parts.flatMap((text): QuestionPurpose[] => {
      const types = answerTypes(text);
      if (!types.length && !unclearCoordination) return [];
      const normalized = normalize(text);
      const owners = cues.filter(([, pattern]) => pattern.test(normalized)).map(([flow]) => flow);
      return [{ text, expectedAnswerType: types[0] ?? 'unknown',
        flow: owners.length === 1 ? owners[0] : 'none',
        ...(owners.length > 1 || unclearCoordination || types.length > 1 ? { ambiguous: true } : {}),
        ...(unclearCoordination || types.length > 1 ? { ambiguousField: true } : {}) }];
    });
  });
  const explicitOwners = [...new Set(parsed.filter((purpose) => purpose.flow !== 'none').map((purpose) => purpose.flow))];
  return parsed.map((purpose) => purpose.flow === 'none' && !purpose.ambiguous && explicitOwners.length === 1
    ? { ...purpose, flow: explicitOwners[0] } : purpose);
}

export function fieldQuestionPurpose(response?: string,
  declared?: { text: string; expectedAnswerType?: string }): QuestionPurpose | null {
  const questions = fieldQuestionPurposes(response, declared);
  if (!questions.length) return null;
  const owners = [...new Set(questions.filter((question) => question.flow !== 'none')
    .map((question) => question.flow))];
  return { ...questions[0], flow: owners.length === 1 ? owners[0] : 'none',
    ...(questions.some((question) => question.ambiguous) || owners.length > 1
      ? { ambiguous: true } : {}),
    ...(questions.some((question) => question.ambiguousField)
      ? { ambiguousField: true } : {}) };
}

export function isExplicitServiceRequest(text: string, detectedFlow: OrchestrationFlow,
  pendingFlow: OrchestrationFlow): boolean {
  if (detectedFlow === 'none') return false;
  if (/^(?:hotels?|restaurants?|dining|excursions?|activities|transport|transfers?|itinerary|shopping)$/.test(text)) return true;
  if (/\b(?:show|find|search|book|reserve|recommend|plan|switch to|instead|transfer|taxi|need|want)\b/.test(text) &&
      /\b(?:hotels?|accommodation|restaurants?|excursions?|activities|transport|transfers?|taxi|itinerary)\b/.test(text)) return true;
  if (/\b(?:hotels?|accommodation|restaurants?|excursions?|activities|transport|transfers?|itinerary)\b/.test(text) &&
      /\b(?:please|actually|rather|instead)\b/.test(text)) return true;
  if (detectedFlow === pendingFlow) return false;
  if (/\b(?:show|find|search|book|reserve|recommend|plan|switch to|instead|transfer|taxi)\b/.test(text)) return true;
  return false;
}

function detectCommand(
  normalized: string,
  context: OrchestrationContext
): ConversationAnalysis['command'] | undefined {
  if (/^(reset|restart|start over|cancel|clear)$/.test(normalized)) return 'reset';
  if (/^(status|update|resume|continue|waiting|still waiting|any update|show results)$/.test(normalized)) {
    return 'status';
  }
  if (/^(next|more|show more|next 3|another 3)$/.test(normalized)) return 'next';
  if (/^details\s*[1-3]$/.test(normalized)) return 'details';
  if (/^(book\s*)?[1-3]$/.test(normalized) || /^book\s*[1-3]$/.test(normalized)) return 'book';
  const ordinal = parseDisplayedOrdinal(normalized);
  if (ordinal && !/\b(?:like|similar|more)\b/.test(normalized) &&
      context.activeSession?.verifiedResults?.items.some((item) => item.position === ordinal)) {
    return /\b(book|reserve|choose|select)\b/.test(normalized) ? 'book' : 'details';
  }
  return undefined;
}

function parseCommandEntities(normalized: string, context: OrchestrationContext): Record<string, unknown> {
  const numberMatch = normalized.match(/\b([1-3])\b/);
  const selection = numberMatch ? Number(numberMatch[1]) : parseDisplayedOrdinal(normalized);
  if (!selection) return {};
  const displayed = context.activeSession?.verifiedResults?.items.find((item) => item.position === selection);
  return displayed ? { selection, resultId: displayed.resultId } : { selection };
}

function parseDisplayedOrdinal(normalized: string): number | undefined {
  if (!/\b(?:one|option|result|place|hotel|restaurant|experience|ride)\b/.test(normalized)) return undefined;
  if (/\bfirst\b/.test(normalized)) return 1;
  if (/\bsecond\b/.test(normalized)) return 2;
  if (/\bthird\b/.test(normalized)) return 3;
  return undefined;
}

/** Resolve ordinal references only against results that the backend actually displayed. */
function resolveDisplayedResultReference(normalized: string, context: OrchestrationContext): Record<string, unknown> {
  const position = parseDisplayedOrdinal(normalized);
  if (!position) return {};
  const result = context.activeSession?.verifiedResults?.items.find((item) => item.position === position);
  return result ? { selection: position, resultId: result.resultId, referencedResultName: result.name } : {};
}

function detectDeterministicIntent(
  normalized: string,
  activeFlow?: OrchestrationFlow
): {
  intent: OrchestrationIntent;
  targetFlow: OrchestrationFlow;
  entities: Record<string, unknown>;
  confidence: number;
} {
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b/.test(normalized)) {
    return { intent: 'smalltalk', targetFlow: 'none', entities: {}, confidence: 0.95 };
  }

  if (
    /\brestaurant\b.*\bnot (?:a )?hotel\b/.test(normalized) ||
    /\bnot (?:a )?hotel\b.*\brestaurant\b/.test(normalized)
  ) {
    return {
      intent: 'restaurant_search',
      targetFlow: 'restaurant',
      entities: extractCommonEntities(normalized),
      confidence: 0.98,
    };
  }

  // A hotel reference tied to a particular itinerary day is an edit to that
  // itinerary, not a request to abandon it and start a standalone hotel flow.
  if (
    activeFlow === 'itinerary' &&
    /\b(?:day\s*\d+|first|second|third|fourth|fifth|sixth|seventh)\b/.test(normalized) &&
    /\b(hotel|hotels|stay|accommodation|room|resort)\b/.test(normalized)
  ) {
    return {
      intent: 'itinerary_plan',
      targetFlow: 'itinerary',
      entities: { itineraryEdit: normalized },
      confidence: 0.97,
    };
  }

  if (/\b(hotel|hotels|stay|accommodation|room|rooms|resort|bnb|b&b)\b/.test(normalized)) {
    return {
      intent: 'hotel_search',
      targetFlow: 'hotel',
      entities: extractCommonEntities(normalized),
      confidence: 0.9,
    };
  }

  if (
    /\b(restaurants?|restuarents?|resturants?|dinner|lunch|brunch|dining|eat|food|cafe|café|table|hungry)\b/.test(normalized) ||
    /\b(?:romantic|good|nice) place\b/.test(normalized)
  ) {
    return {
      intent: 'restaurant_search',
      targetFlow: 'restaurant',
      entities: extractCommonEntities(normalized),
      confidence: 0.9,
    };
  }

  if (
    /\b(excursions?|activity|activities|attractions?|things to do|experiences?|tours?|historic|historical|adventure|surf|surfing|safari|wildlife|museum|temple|hiking|diving|sightseeing|local sights?|what(?:'s| is) (?:on|happening))\b/.test(normalized) ||
    /\bwhat (?:can|could|should) (?:i|we) (?:do|see|visit)(?:\s+(?:in|around|near|at)\b|\s+(?:here|nearby)\b)/.test(normalized) ||
    /\b(?:anything|something) (?:to do|to see|happening)(?:\s+(?:in|around|near|at)\b|\s+(?:here|nearby)\b)/.test(normalized)
  ) {
    return {
      intent: 'excursion_search',
      targetFlow: 'excursion',
      entities: extractCommonEntities(normalized),
      confidence: 0.88,
    };
  }

  if (/\b(itinerary|intenry|iternary|trip plan|plan my trip|day plan)\b/.test(normalized)) {
    return {
      intent: 'itinerary_plan',
      targetFlow: 'itinerary',
      entities: extractCommonEntities(normalized),
      confidence: 0.88,
    };
  }

  if (/\b(transport|transfer|pickup|pick up|drop off|drop-off|taxi|car|vehicle|driver|airport)\b/.test(normalized)) {
    return {
      intent: 'logistics_request',
      targetFlow: 'logistics',
      entities: extractCommonEntities(normalized),
      confidence: 0.88,
    };
  }

  if (/\b(profile|my details|my information)\b/.test(normalized)) {
    return { intent: 'profile_update', targetFlow: 'profile', entities: {}, confidence: 0.9 };
  }

  return { intent: 'unclear', targetFlow: 'none', entities: {}, confidence: 0.35 };
}

function extractCommonEntities(normalized: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  const locationMatch = normalized.match(/\b(?:in|near|around)\s+([a-z][a-z\s.'-]{1,60})(?:\s+(?:for|tonight|today|tomorrow|with|under|below)\b|$)/i);
  const location = locationMatch?.[1]?.trim();
  if (location && !/^(me|here|my place|where i am)$/i.test(location)) {
    entities.location = toTitleCase(location);
  }

  const guestMatch = normalized.match(/\b(?:for|party of|table for)\s*(\d{1,2})\b/) ??
    normalized.match(/\b(\d{1,2})\s*(?:people|guests|pax|persons)\b/);
  if (guestMatch?.[1]) {
    entities.guests = Number(guestMatch[1]);
  }

  if (/\brooftop\b/.test(normalized)) entities.seatingPreference = 'Rooftop';
  const cuisineMatch = normalized.match(
    /\b(seafood|chinese|indian|italian|japanese|thai|sri lankan|mexican|mediterranean|korean|french)\b/
  );
  if (cuisineMatch?.[1]) entities.cuisine = cuisineMatch[1].toLowerCase();
  if (/\bvegetarian\b/.test(normalized)) entities.dietaryPreferences = 'Vegetarian';
  if (/\bhalal\b/.test(normalized)) entities.dietaryPreferences = 'Halal';
  if (/\bbeachfront|beach front\b/.test(normalized)) entities.locationPreference = 'Beachfront';

  return entities;
}

/** Reuse the existing field extractor to corroborate additional values in a
 * pending-answer turn; model output alone cannot establish their provenance. */
export function explicitFieldsInPendingAnswer(rawText: string): Record<string, unknown> {
  const normalized = normalize(rawText);
  const fields = extractCommonEntities(normalized);
  const nights = normalized.match(/\b(\d{1,2})\s+nights?\b/);
  if (nights) fields.durationNights = Number(nights[1]);
  return fields;
}

function roleForIntent(
  intent: OrchestrationIntent,
  activeFlow?: OrchestrationFlow
): ConversationRole {
  if (intent === 'smalltalk') return 'smalltalk';
  const targetFlow = intentToFlow(intent);
  if (activeFlow && targetFlow !== 'none' && activeFlow !== targetFlow) return 'new_intent';
  return targetFlow === 'none' ? 'unclear' : 'new_intent';
}

function intentToFlow(intent: OrchestrationIntent): OrchestrationFlow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'excursion_search') return 'excursion';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'itinerary_plan') return 'itinerary';
  if (intent === 'profile_update') return 'profile';
  return 'none';
}

function intentForFlow(flow: OrchestrationFlow): OrchestrationIntent {
  if (flow === 'hotel') return 'hotel_search';
  if (flow === 'restaurant') return 'restaurant_search';
  if (flow === 'excursion') return 'excursion_search';
  if (flow === 'logistics') return 'logistics_request';
  if (flow === 'itinerary') return 'itinerary_plan';
  if (flow === 'profile') return 'profile_update';
  return 'unclear';
}

function extractAwaitedFieldAnswer(field: string | undefined, rawText: string): unknown {
  if (!field) return undefined;
  if (rawText.includes('?') || isQuestion(normalize(rawText))) return undefined;
  const value = rawText.trim().replace(/^(?:actually|i mean|i meant|yes|sure|okay|ok)[,\s]+/i, '')
    .replace(/[.!]+$/, '').trim();
  if (!value || value.length > 120) return undefined;

  if (field === 'additionalPreferences') {
    if (/^(?:no|none|nothing|done|go ahead|show(?: me)? options|search|start planning)$/i.test(value))
      return undefined;
    return value;
  }

  if (/^(location|destination|pickupLocation|dropOffLocation|arrivalAirport)$/i.test(field)) {
    const place = value.replace(/(?:,?\s+for)?\s+\d{1,2}\s+(?:guests?|people|persons?|pax|nights?)$/i, '')
      .replace(/^(?:in|near|around)\s+/i, '').trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\s.'-]{0,79}$/u.test(place)) return undefined;
    if (/^\d{1,2}$/.test(place) ||
        /^\d{1,2}\s+(?:guests?|people|persons?|pax|nights?|days?|rooms?|adults?|children|passengers?|travellers?)$/i.test(place)) return undefined;
    if (place.split(/\s+/).length > 3 ||
        /^(?:yes|no|done|thanks|thank you|please|okay|ok|sure|help|reset|restart|resume|continue|later|not now|show results|more|next)$/i.test(place) ||
        /\b(?:send|form|link|booking|reservation|weather|instead|change|cancel)\b/i.test(place)) return undefined;
    return place.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  if (/^(guests|rooms|passengers|adults|children|durationNights)$/i.test(field)) {
    const units: Record<string, string> = {
      guests: 'guests?|people|persons?|pax', rooms: 'rooms?',
      passengers: 'passengers?|travellers?|people|persons?|pax',
      adults: 'adults?', children: 'children|kids?', durationNights: 'nights?',
    };
    const match = value.match(new RegExp(`^(?:for\\s+)?(\\d{1,2})(?:\\s+(?:${units[field]}))?$`, 'i'));
    return match ? Number(match[1]) : undefined;
  }

  if (/^(checkinDate|checkoutDate|diningDate|preferredDate|pickupDate)$/i.test(field)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  }
  if (/^(diningTime|preferredTime|pickupTime)$/i.test(field)) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
  }

  return undefined;
}

function isQuestion(normalized: string): boolean {
  return /^(what|how|can|could|do|does|is|are|will|would|should|which|when|where|why)\b/.test(normalized);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
