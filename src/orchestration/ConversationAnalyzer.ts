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
    const command = detectCommand(normalized, context);

    if (command) {
      return {
        role: 'command',
        intent: 'command',
        targetFlow: context.activeSession?.flow ?? 'none',
        entities: parseCommandEntities(normalized, context),
        command,
        confidence: 1,
        rawText,
        shouldUseLLM: false,
      };
    }

    const deterministic = detectDeterministicIntent(
      normalized,
      context.activeSession?.flow
    );
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
  const value = rawText.trim();
  if (!value || value.length > 120) return undefined;

  if (/^(location|destination|pickupLocation|dropOffLocation)$/i.test(field)) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\s.'-]{0,79}$/u.test(value)) return undefined;
    return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  if (/^(guests|rooms|passengers|adults|children)$/i.test(field)) {
    const match = value.match(/\b(\d{1,2})\b/);
    return match ? Number(match[1]) : undefined;
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
