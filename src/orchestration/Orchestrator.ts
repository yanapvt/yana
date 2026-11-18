import type { InboundMessage, SessionState, StoredProfile } from '../types/index.js';
import { ContextBuilder, type ContextBuilderInput } from './ContextBuilder.js';
import { ConversationAnalyzer, expectedFieldForConversation, fieldQuestionPurpose,
  fieldQuestionPurposes } from './ConversationAnalyzer.js';
import { DecisionEngine } from './DecisionEngine.js';
import { MemoryUpdater } from './MemoryUpdater.js';
import { PromptService } from './PromptService.js';
import { semanticDecision, type SemanticUI } from './SemanticUI.js';
import type { MemoryCandidate, TravellerMemoryFact } from './TravellerMemory.js';

export type OrchestrationIntent =
  | 'hotel_search'
  | 'restaurant_search'
  | 'excursion_search'
  | 'logistics_request'
  | 'itinerary_plan'
  | 'profile_update'
  | 'general_inquiry'
  | 'smalltalk'
  | 'command'
  | 'unclear';

export type OrchestrationFlow =
  | 'hotel'
  | 'restaurant'
  | 'excursion'
  | 'logistics'
  | 'itinerary'
  | 'profile'
  | 'none';

export type ConversationRole =
  | 'answer_to_current_question'
  | 'new_intent'
  | 'change_existing_criteria'
  | 'extra_preference'
  | 'question_or_faq'
  | 'command'
  | 'smalltalk'
  | 'unclear';

export type OrchestrationActionType =
  | 'require_profile'
  | 'answer_smalltalk'
  | 'answer_general_question'
  | 'ask_clarifying_question'
  | 'send_form'
  | 'continue_flow'
  | 'pause_flow'
  | 'switch_flow'
  | 'execute_search'
  | 'handle_command'
  | 'handoff'
  | 'no_op';

export interface OrchestrationMessage {
  messageId: string;
  from: string;
  inputType: InboundMessage['inputType'];
  text: string;
}

export interface OrchestrationSessionSnapshot {
  lifecycleStatus?: 'active' | 'paused';
  id?: string;
  revision?: number;
  schemaVersion?: string;
  itinerary?: import('../services/ItineraryPlannerService.js').GeneratedItinerary;
  verifiedResults?: { source: string; retrievedAt: string; items: Array<{ resultId: string; position: number; name: string; rating?: number }> };
  pendingDecisions?: { locationConfirmation?: string; sourcingConsent?: boolean; humanHandoffConsent?: boolean };
  flow: OrchestrationFlow;
  state?: string;
  activeSchema?: string;
  awaitedField?: string;
  collectedFields: Record<string, unknown>;
  requiredFields: string[];
  missingFields: string[];
  updatedAt?: string;
}

export interface OrchestrationContext {
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationTopic?: string;
  pendingQuestion?: { text: string; expectedAnswerType?: string; workflowId?: string;
    remaining?: Array<{ text: string; expectedAnswerType?: string }> };
  pendingClarification?: string;
  historyStatus?: 'available' | 'empty' | 'unavailable';
  userId: string;
  message: OrchestrationMessage;
  profileComplete: boolean;
  profile?: StoredProfile['form'];
  travellerMemories?: TravellerMemoryFact[];
  memoryStatus?: 'available' | 'empty' | 'unavailable';
  activeSession?: OrchestrationSessionSnapshot;
  pausedSessions?: OrchestrationSessionSnapshot[];
  recentServiceRequests?: Array<{
    type: string;
    form: unknown;
    createdAt: Date;
  }>;
  uiWorkspace?: { workflowId?: string; selectedDay: number; revision: number };
  metadata: Record<string, unknown>;
}

export interface ConversationAnalysis {
  role: ConversationRole;
  intent: OrchestrationIntent;
  targetFlow: OrchestrationFlow;
  entities: Record<string, unknown>;
  command?: 'reset' | 'status' | 'next' | 'details' | 'book' | 'resume';
  question?: string;
  confidence: number;
  rawText: string;
  shouldUseLLM: boolean;
  pendingAnswerMismatch?: boolean;
}

export interface LLMInterpretation {
  followUpQuestion?: { text: string; expectedAnswerType?: string;
    remaining?: Array<{ text: string; expectedAnswerType?: string }> };
  suggestedAction?: 'none' | 'ask_missing' | 'execute_tool' | 'clarify' | 'handoff';
  role: ConversationRole;
  intent: OrchestrationIntent;
  entities: Record<string, unknown>;
  confidence: number;
  missingFields?: string[];
  question?: string;
  responseText?: string;
  clarificationRequired?: boolean;
  taskTransition?: 'continue' | 'pause' | 'resume' | 'switch' | 'none';
  recommendedSchema?: string;
  uiRecommendation?: {
    mode: 'chat_reply' | 'clarification' | 'clarification_form' | 'results_list' | 'search_editor' | 'itinerary_editor' | 'confirmation';
    schemaId?: string;
  };
  proposedAction?: { name: 'none' | 'search' | 'open_form' | 'handoff'; arguments: Record<string, unknown> };
  unresolvedQuestions?: string[];
  reasoning?: string;
  memoryCandidates?: MemoryCandidate[];
}

export interface OrchestrationDecision {
  action: OrchestrationActionType;
  intent: OrchestrationIntent;
  targetFlow: OrchestrationFlow;
  confidence: number;
  entities: Record<string, unknown>;
  missingFields: string[];
  sessionPatch?: OrchestrationSessionSnapshot;
  reason: string;
}

export interface MemoryUpdateResult {
  shouldPersist: boolean;
  session?: OrchestrationSessionSnapshot;
  profilePatch?: Partial<StoredProfile['form']>;
  memoryCandidates?: MemoryCandidate[];
  reason: string;
}

export interface LLMInterpreter {
  interpret(prompt: string, context: OrchestrationContext): Promise<LLMInterpretation>;
}

export interface OrchestrationResult {
  ui?: SemanticUI;
  context: OrchestrationContext;
  analysis: ConversationAnalysis;
  prompt?: string;
  interpretation?: LLMInterpretation;
  decision: OrchestrationDecision;
  memoryUpdate: MemoryUpdateResult;
}

export interface OrchestratorDependencies {
  contextBuilder?: ContextBuilder;
  conversationAnalyzer?: ConversationAnalyzer;
  promptService?: PromptService;
  decisionEngine?: DecisionEngine;
  memoryUpdater?: MemoryUpdater;
  llmInterpreter?: LLMInterpreter;
}

export class Orchestrator {
  private readonly contextBuilder: ContextBuilder;
  private readonly conversationAnalyzer: ConversationAnalyzer;
  private readonly promptService: PromptService;
  private readonly decisionEngine: DecisionEngine;
  private readonly memoryUpdater: MemoryUpdater;
  private readonly llmInterpreter?: LLMInterpreter;

  constructor(dependencies: OrchestratorDependencies = {}) {
    this.contextBuilder = dependencies.contextBuilder ?? new ContextBuilder();
    this.conversationAnalyzer = dependencies.conversationAnalyzer ?? new ConversationAnalyzer();
    this.promptService = dependencies.promptService ?? new PromptService();
    this.decisionEngine = dependencies.decisionEngine ?? new DecisionEngine();
    this.memoryUpdater = dependencies.memoryUpdater ?? new MemoryUpdater();
    this.llmInterpreter = dependencies.llmInterpreter;
  }

  async plan(input: ContextBuilderInput): Promise<OrchestrationResult> {
    const context = this.contextBuilder.build(input);
    const analysis = this.conversationAnalyzer.analyze(context);

    let prompt: string | undefined;
    let interpretation: LLMInterpretation | undefined;
    if (analysis.shouldUseLLM && this.llmInterpreter) {
      prompt = this.promptService.buildInterpreterPrompt(context, analysis);
      interpretation = await this.llmInterpreter.interpret(prompt, context);
    }

    let decision = this.decisionEngine.decide({
      context,
      analysis,
      interpretation,
    });
    if (interpretation) {
      let responseText = decision.reason === 'The reply does not match the pending answer type.' &&
        context.pendingQuestion
        ? `I still need that detail. ${context.pendingQuestion.text.replace(/\?$/, '')}?`
        : this.promptService.reconcileDecisionResponse(decision, interpretation);
      let queuedFollowUp: LLMInterpretation['followUpQuestion'];
      const remaining = context.pendingQuestion?.remaining ?? [];
      const answeredField = expectedFieldForConversation(decision.targetFlow,
        context.pendingQuestion?.expectedAnswerType);
      const acceptedAnswer = answeredField && decision.entities[answeredField] !== undefined &&
        decision.sessionPatch?.collectedFields[answeredField] !== undefined &&
        JSON.stringify(decision.entities[answeredField]) ===
          JSON.stringify(decision.sessionPatch.collectedFields[answeredField]);
      if (analysis.role === 'answer_to_current_question' && decision.action === 'continue_flow' &&
          decision.targetFlow === analysis.targetFlow && acceptedAnswer && remaining.length) {
        const nextIndex = remaining.findIndex((question) => {
          const field = expectedFieldForConversation(decision.targetFlow, question.expectedAnswerType);
          return !field || decision.sessionPatch?.collectedFields[field] === undefined;
        });
        if (nextIndex >= 0) {
          const next = remaining[nextIndex];
          const acceptedValue = Object.values(decision.entities)[0];
          responseText = `Got it${acceptedValue === undefined ? '' : `, ${String(acceptedValue)}`}. ${next.text}`;
          queuedFollowUp = { text: next.text, expectedAnswerType: next.expectedAnswerType,
            ...(remaining.slice(nextIndex + 1).length ? { remaining: remaining.slice(nextIndex + 1) } : {}) };
        }
      }
      const checkedDecision = this.decisionEngine.validateResponseQuestion({ context, analysis,
        interpretation }, decision, responseText);
      if (checkedDecision !== decision) {
        decision = checkedDecision;
        responseText = this.promptService.reconcileDecisionResponse(decision, interpretation);
        queuedFollowUp = undefined;
      }
      const shouldTrackQuestion = decision.action === 'ask_clarifying_question' ||
        decision.action === 'switch_flow' ||
        decision.action === 'answer_general_question' && decision.targetFlow !== 'none' ||
        decision.reason === 'Save a location answer before starting discovery.' ||
        decision.reason === 'Save a preference before starting discovery.';
      const responseQuestion = shouldTrackQuestion ? fieldQuestionPurpose(responseText) : null;
      const responseQuestions = responseQuestion ? fieldQuestionPurposes(responseText) : [];
      const deliveredFollowUp = responseQuestion && !responseQuestion.ambiguous
        ? { text: responseQuestions[0].text,
            expectedAnswerType: responseQuestions[0].expectedAnswerType,
            ...(responseQuestions.length > 1 ? { remaining: responseQuestions.slice(1).map((question) => ({
              text: question.text, expectedAnswerType: question.expectedAnswerType,
            })) } : {}) }
        : undefined;
      const followUpQuestion = decision.reason === 'The reply does not match the pending answer type.' &&
        context.pendingQuestion
        ? { ...context.pendingQuestion }
        : decision.action === 'ask_clarifying_question' && responseText?.trim()
        ? decision.reason.startsWith('Confirm whether to switch') ||
          decision.reason === 'Clarify which service owns the proposed field question.'
          ? { text: responseText.trim().slice(0, 500), expectedAnswerType: 'service' }
          : decision.reason === 'Clarify which field the proposed question asks for.'
            ? { text: responseText.trim().slice(0, 500) }
            : deliveredFollowUp ?? { text: responseText.trim().slice(0, 500) }
        : (decision.reason === 'Save a location answer before starting discovery.' ||
            decision.reason === 'Save a preference before starting discovery.') && responseText?.includes('?')
          ? queuedFollowUp ?? deliveredFollowUp
        : queuedFollowUp ?? deliveredFollowUp;
      interpretation = { ...interpretation, responseText,
        followUpQuestion,
        question: decision.action === 'ask_clarifying_question' ? responseText : interpretation.question };
    }
    const memoryUpdate = this.memoryUpdater.prepareUpdate(context, decision,
      analysis.pendingAnswerMismatch ? undefined : interpretation?.memoryCandidates);

    const result: OrchestrationResult = {
      context,
      analysis,
      prompt,
      interpretation,
      decision,
      memoryUpdate,
    };
    result.ui = semanticDecision(result);
    return result;
  }
}

export function sessionStateToSnapshot(
  flow: OrchestrationFlow,
  state: SessionState,
  requiredFields: string[] = []
): OrchestrationSessionSnapshot {
  const collectedFields = { ...state.collectedFields };
  const missingFields = recalculateMissingFields(requiredFields, collectedFields);

  return {
    flow,
    state: state.currentStep,
    activeSchema: state.activeSchema,
    collectedFields,
    requiredFields: [...requiredFields],
    missingFields,
  };
}

export function recalculateMissingFields(
  requiredFields: string[],
  fields: Record<string, unknown>
): string[] {
  return requiredFields.filter((field) => isMissingValue(fields[field]));
}

export function isMissingValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}
