import type { InboundMessage } from '../types/core.js';

export type CoreV2Intent =
  | 'hotel_search'
  | 'restaurant_search'
  | 'logistics_request'
  | 'profile'
  | 'smalltalk'
  | 'command'
  | 'general'
  | 'unclear';

export type CoreV2Flow = 'hotel' | 'restaurant' | 'logistics' | 'profile' | 'none';

export type CoreV2ActionType =
  | 'require_profile'
  | 'start_flow'
  | 'continue_flow'
  | 'switch_flow'
  | 'handle_command'
  | 'answer_smalltalk'
  | 'clarify';

export interface CoreV2UserContext {
  userId: string;
  profileComplete: boolean;
  activeFlow?: CoreV2Flow;
  activeState?: string;
  pendingIntent?: CoreV2Intent;
}

export interface CoreV2Input {
  message: Pick<InboundMessage, 'messageId' | 'from' | 'inputType'> & {
    text: string;
  };
  user: CoreV2UserContext;
}

export interface CoreV2Action {
  type: CoreV2ActionType;
  targetFlow?: CoreV2Flow;
  reason: string;
}

export interface CoreV2Plan {
  intent: CoreV2Intent;
  targetFlow: CoreV2Flow;
  confidence: number;
  actions: CoreV2Action[];
  rawText: string;
  shouldUseLLM: boolean;
}

export class CoreSystemV2 {
  plan(input: CoreV2Input): CoreV2Plan {
    const rawText = input.message.text.trim();
    const command = detectCommand(rawText);
    const intent = command ? 'command' : detectIntent(rawText);
    const targetFlow = flowForIntent(intent, input.user.activeFlow);

    if (!input.user.profileComplete && shouldRequireProfile(intent, command)) {
      return {
        intent,
        targetFlow: 'profile',
        confidence: command ? 1 : confidenceForIntent(intent),
        rawText,
        shouldUseLLM: false,
        actions: [
          {
            type: 'require_profile',
            targetFlow: 'profile',
            reason: 'Profile-first gate must run before service recommendations.',
          },
        ],
      };
    }

    if (command) {
      return {
        intent: 'command',
        targetFlow: input.user.activeFlow ?? 'none',
        confidence: 1,
        rawText,
        shouldUseLLM: false,
        actions: [
          {
            type: 'handle_command',
            targetFlow: input.user.activeFlow ?? 'none',
            reason: `Detected deterministic command: ${command}.`,
          },
        ],
      };
    }

    if (intent === 'smalltalk') {
      return {
        intent,
        targetFlow: input.user.activeFlow ?? 'none',
        confidence: 0.95,
        rawText,
        shouldUseLLM: false,
        actions: [
          {
            type: 'answer_smalltalk',
            targetFlow: input.user.activeFlow ?? 'none',
            reason: 'Message is conversational and should not mutate service state.',
          },
        ],
      };
    }

    if (input.user.activeFlow && input.user.activeFlow !== 'none') {
      if (targetFlow !== 'none' && targetFlow !== input.user.activeFlow) {
        return {
          intent,
          targetFlow,
          confidence: confidenceForIntent(intent),
          rawText,
          shouldUseLLM: confidenceForIntent(intent) < 0.75,
          actions: [
            {
              type: 'switch_flow',
              targetFlow,
              reason: `User appears to be switching from ${input.user.activeFlow} to ${targetFlow}.`,
            },
          ],
        };
      }

      return {
        intent,
        targetFlow: input.user.activeFlow,
        confidence: confidenceForIntent(intent),
        rawText,
        shouldUseLLM: intent === 'unclear',
        actions: [
          {
            type: 'continue_flow',
            targetFlow: input.user.activeFlow,
            reason: 'Active flow owns this message unless a clear new intent is detected.',
          },
        ],
      };
    }

    if (targetFlow !== 'none') {
      return {
        intent,
        targetFlow,
        confidence: confidenceForIntent(intent),
        rawText,
        shouldUseLLM: false,
        actions: [
          {
            type: 'start_flow',
            targetFlow,
            reason: `Detected new ${targetFlow} flow intent.`,
          },
        ],
      };
    }

    return {
      intent,
      targetFlow: 'none',
      confidence: confidenceForIntent(intent),
      rawText,
      shouldUseLLM: true,
      actions: [
        {
          type: 'clarify',
          targetFlow: 'none',
          reason: 'No deterministic service intent or command was detected.',
        },
      ],
    };
  }
}

export function getCoreSystemV2(): CoreSystemV2 {
  if (!coreSystemV2Instance) {
    coreSystemV2Instance = new CoreSystemV2();
  }

  return coreSystemV2Instance;
}

export function initCoreSystemV2(service = new CoreSystemV2()): CoreSystemV2 {
  coreSystemV2Instance = service;
  return service;
}

let coreSystemV2Instance: CoreSystemV2 | null = null;

function detectCommand(text: string): string | null {
  const normalized = normalize(text);
  if (/^(reset|restart|start over|cancel|clear)$/.test(normalized)) return 'reset';
  if (/^(status|resume|continue|waiting|still waiting|any update|show results)$/.test(normalized)) return 'status';
  if (/^(next|more|show more|next 3|another 3)$/.test(normalized)) return 'next';
  if (/^details\s*[1-3]$/.test(normalized)) return 'details';
  if (/^(book\s*)?[1-3]$/.test(normalized) || /^book\s*[1-3]$/.test(normalized)) return 'book';
  return null;
}

function detectIntent(text: string): CoreV2Intent {
  const normalized = normalize(text);
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b/.test(normalized)) {
    return 'smalltalk';
  }

  if (/\b(hotel|stay|accommodation|room|resort|bnb|b&b)\b/.test(normalized)) {
    return 'hotel_search';
  }

  if (/\b(restaurant|dinner|lunch|brunch|dining|eat|food|cafe|café|table|where should we eat)\b/.test(normalized)) {
    return 'restaurant_search';
  }

  if (/\b(transport|transfer|pickup|pick up|drop[-\s]?off|taxi|car|vehicle|driver|airport)\b/.test(normalized)) {
    return 'logistics_request';
  }

  if (/\b(profile|my details|my information)\b/.test(normalized)) {
    return 'profile';
  }

  return normalized ? 'unclear' : 'general';
}

function flowForIntent(intent: CoreV2Intent, activeFlow?: CoreV2Flow): CoreV2Flow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'profile') return 'profile';
  if (intent === 'smalltalk' || intent === 'command') return activeFlow ?? 'none';
  return 'none';
}

function shouldRequireProfile(intent: CoreV2Intent, command: string | null): boolean {
  if (command) return false;
  return intent === 'hotel_search' || intent === 'restaurant_search' || intent === 'logistics_request';
}

function confidenceForIntent(intent: CoreV2Intent): number {
  switch (intent) {
    case 'hotel_search':
    case 'restaurant_search':
    case 'logistics_request':
      return 0.9;
    case 'profile':
    case 'smalltalk':
      return 0.95;
    case 'command':
      return 1;
    case 'general':
      return 0.5;
    case 'unclear':
    default:
      return 0.35;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
