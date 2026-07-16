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
    const command = detectCommand(normalized);

    if (command) {
      return {
        role: 'command',
        intent: 'command',
        targetFlow: context.activeSession?.flow ?? 'none',
        entities: parseCommandEntities(normalized),
        command,
        confidence: 1,
        rawText,
        shouldUseLLM: false,
      };
    }

    const deterministic = detectDeterministicIntent(normalized);
    if (deterministic.intent !== 'unclear') {
      return {
        role: roleForIntent(deterministic.intent, context.activeSession?.flow),
        intent: deterministic.intent,
        targetFlow: deterministic.targetFlow,
        entities: deterministic.entities,
        confidence: deterministic.confidence,
        rawText,
        shouldUseLLM: false,
      };
    }

    if (isQuestion(normalized)) {
      return {
        role: 'question_or_faq',
        intent: 'unclear',
        targetFlow: context.activeSession?.flow ?? 'none',
        entities: {},
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
      entities: {},
      confidence: context.activeSession ? 0.55 : 0.35,
      rawText,
      shouldUseLLM: true,
    };
  }
}

function detectCommand(
  normalized: string
): ConversationAnalysis['command'] | undefined {
  if (/^(reset|restart|start over|cancel|clear)$/.test(normalized)) return 'reset';
  if (/^(status|update|resume|continue|waiting|still waiting|any update|show results)$/.test(normalized)) {
    return 'status';
  }
  if (/^(next|more|show more|next 3|another 3)$/.test(normalized)) return 'next';
  if (/^details\s*[1-3]$/.test(normalized)) return 'details';
  if (/^(book\s*)?[1-3]$/.test(normalized) || /^book\s*[1-3]$/.test(normalized)) return 'book';
  return undefined;
}

function parseCommandEntities(normalized: string): Record<string, unknown> {
  const numberMatch = normalized.match(/\b([1-3])\b/);
  return numberMatch ? { selection: Number(numberMatch[1]) } : {};
}

function detectDeterministicIntent(normalized: string): {
  intent: OrchestrationIntent;
  targetFlow: OrchestrationFlow;
  entities: Record<string, unknown>;
  confidence: number;
} {
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b/.test(normalized)) {
    return { intent: 'smalltalk', targetFlow: 'none', entities: {}, confidence: 0.95 };
  }

  if (/\b(hotel|stay|accommodation|room|resort|bnb|b&b)\b/.test(normalized)) {
    return {
      intent: 'hotel_search',
      targetFlow: 'hotel',
      entities: extractCommonEntities(normalized),
      confidence: 0.9,
    };
  }

  if (/\b(restaurant|dinner|lunch|brunch|dining|eat|food|cafe|café|table)\b/.test(normalized)) {
    return {
      intent: 'restaurant_search',
      targetFlow: 'restaurant',
      entities: extractCommonEntities(normalized),
      confidence: 0.9,
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
  if (locationMatch?.[1]) {
    entities.location = toTitleCase(locationMatch[1].trim());
  }

  const guestMatch = normalized.match(/\b(?:for|party of|table for)\s*(\d{1,2})\b/) ??
    normalized.match(/\b(\d{1,2})\s*(?:people|guests|pax|persons)\b/);
  if (guestMatch?.[1]) {
    entities.guests = Number(guestMatch[1]);
  }

  if (/\brooftop\b/.test(normalized)) entities.seatingPreference = 'Rooftop';
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
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'profile_update') return 'profile';
  return 'none';
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
