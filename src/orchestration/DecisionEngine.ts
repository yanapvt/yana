import type {
  ConversationAnalysis,
  LLMInterpretation,
  OrchestrationContext,
  OrchestrationDecision,
  OrchestrationFlow,
  OrchestrationIntent,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';
import { env } from '../config/environment.js';
import { missingFields as computeMissing, requiredFieldsForAction, validateCriteria, workflow, type WorkflowActionStage } from './WorkflowDefinitions.js';

export interface DecisionEngineInput {
  context: OrchestrationContext;
  analysis: ConversationAnalysis;
  interpretation?: LLMInterpretation;
}

export class DecisionEngine {
  decide(input: DecisionEngineInput): OrchestrationDecision {
    const model = input.interpretation;
    if (model && !input.context.profileComplete && requiresProfile(model.intent)) {
      return { action: 'require_profile', intent: model.intent, targetFlow: 'profile', confidence: model.confidence,
        entities: {}, missingFields: [], reason: 'Profile-first gate required before interpreting workflow proposals.' };
    }
    if (model?.taskTransition === 'pause' && input.context.activeSession &&
        !model.clarificationRequired && model.confidence >= env.llm.confidenceThreshold) {
      return {
        action: 'pause_flow', intent: model.intent, targetFlow: input.context.activeSession.flow,
        confidence: model.confidence, entities: {}, missingFields: input.context.activeSession.missingFields,
        reason: 'Validated model interpretation requested pausing the active workflow.',
      };
    }
    // A validated conversational answer takes precedence over keyword hints.
    // A side question can mention another service without requesting a switch.
    if (model?.intent === 'general_inquiry' && model.role === 'question_or_faq' &&
        model.responseText && !model.clarificationRequired && model.taskTransition !== 'switch' &&
        model.confidence >= env.llm.confidenceThreshold) {
      return {
        action: 'answer_general_question', intent: 'general_inquiry',
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Answer the side question without changing the active workflow.',
      };
    }
    if (model?.intent === 'smalltalk' && model.responseText && !model.clarificationRequired &&
        model.taskTransition !== 'switch' && model.confidence >= env.llm.confidenceThreshold) {
      return { action: 'answer_smalltalk', intent: 'smalltalk',
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: [], reason: 'A courtesy reply does not advance an active workflow.' };
    }
    // The prior assistant question and the active snapshot ground a short slot
    // answer. A generic model classification must not erase that evidence.
    // Explicit side questions, corrections and task switches still take priority.
    const active = input.context.activeSession;
    const awaitedField = active?.awaitedField;
    const awaitedValue = awaitedField && input.analysis.role === 'answer_to_current_question'
      ? input.analysis.entities[awaitedField] : undefined;
    const groundedAnswer = active && awaitedField && awaitedValue !== undefined &&
      input.analysis.targetFlow === active.flow &&
      !/[?]/.test(input.context.message.text) &&
      model?.role !== 'question_or_faq' && model?.role !== 'change_existing_criteria' &&
      model?.taskTransition !== 'switch' && model?.taskTransition !== 'pause' &&
      (!model || model.intent === 'unclear' || model.intent === 'general_inquiry' ||
        resolveTargetFlow(model.intent) === active.flow);
    if (groundedAnswer && model?.clarificationRequired) {
      return { action: 'ask_clarifying_question', intent: model.intent,
        targetFlow: active.flow, confidence: model.confidence, entities: { [awaitedField]: awaitedValue },
        missingFields: active.missingFields,
        reason: 'Clarify the answer to the current question without changing saved fields.' };
    }
    if (groundedAnswer) {
      const entities = validateCriteria(active.flow, {
        [awaitedField]: model?.entities[awaitedField] ?? awaitedValue,
        ...Object.fromEntries(Object.entries(model?.entities ?? {}).filter(([field]) =>
          field !== awaitedField)),
      }, false);
      const patchedSession = buildPatchedSession(active, active.flow, entities, active.requiredFields);
      return { action: 'continue_flow', intent: input.analysis.intent,
        targetFlow: active.flow, confidence: input.analysis.confidence, entities,
        missingFields: patchedSession?.missingFields ?? [], sessionPatch: patchedSession,
        reason: 'Persist the grounded answer to the current question.' };
    }
    // A short answer to the assistant's location question can precede the
    // creation of a workflow draft. Do not let a model's new clarification
    // (such as asking for a booking date) discard that grounded answer.
    const pendingFlow = resolveTargetFlow(model?.intent ?? input.analysis.intent);
    const pendingPlaceField = pendingFlow === 'excursion' ? 'destination'
      : pendingFlow === 'hotel' || pendingFlow === 'restaurant' ? 'location' : undefined;
    const shortPlaceReply = input.context.message.text.trim().replace(/[.!?]+$/, '').trim();
    const contextualPlace = /\b(?:which|what|where)\b.*\b(?:town|area|location|dine|stay|search)\b/i.test(
      input.context.pendingQuestion?.text ?? '') &&
      /^[A-Z][\p{L}'-]{2,}$/u.test(shortPlaceReply) ? shortPlaceReply : undefined;
    const pendingPlace = pendingPlaceField &&
      (model?.entities[pendingPlaceField] ?? input.analysis.entities[pendingPlaceField] ?? contextualPlace);
    if (!active && model && (model.clarificationRequired || model.suggestedAction === 'clarify') &&
        pendingPlaceField && typeof pendingPlace === 'string' &&
        /\b(?:which|what|where)\b.*\b(?:town|area|location|dine|stay|search)\b/i.test(input.context.pendingQuestion?.text ?? '') &&
        input.context.message.text.trim().replace(/[.!?]+$/, '').toLocaleLowerCase() === pendingPlace.trim().toLocaleLowerCase() &&
        (!model?.recommendedSchema || model.recommendedSchema === workflow(pendingFlow)?.schema) &&
        (!model?.proposedAction?.arguments.schemaId || model.proposedAction.arguments.schemaId === workflow(pendingFlow)?.schema)) {
      const occasion = pendingFlow === 'restaurant' ? recentRestaurantOccasion(input.context) : undefined;
      const entities = validateCriteria(pendingFlow, {
        [pendingPlaceField]: pendingPlace,
        ...(occasion ? { specialOccasion: occasion } : {}),
      }, false);
      const sessionPatch = buildPatchedSession(undefined, pendingFlow, entities,
        requiredFieldsForAction(pendingFlow, 'discovery'));
      return { action: 'continue_flow', intent: model?.intent ?? input.analysis.intent,
        targetFlow: pendingFlow, confidence: model?.confidence ?? input.analysis.confidence,
        entities, missingFields: sessionPatch?.missingFields ?? [], sessionPatch,
        reason: 'Save a location answer before starting discovery.' };
    }
    // The assistant explicitly invited an atmosphere or other preference for
    // this restaurant draft. A short reply supplies that preference even when
    // the model prematurely proposes a search or booking-field question. Keep the user's
    // wording if the model did not map it to a validated preference field.
    const preferenceReply = input.context.message.text.trim().replace(/[.!?]+$/, '').trim();
    if (active?.flow === 'restaurant' && active.state === 'awaiting_preferences' && model &&
        (resolveTargetFlow(model.intent) === 'restaurant' || model.intent === 'unclear') &&
        model.taskTransition !== 'switch' && model.taskTransition !== 'pause' &&
        input.analysis.role === 'extra_preference' &&
        /\b(?:atmosphere|preference|style)\b/i.test(input.context.pendingQuestion?.text ?? '') &&
        preferenceReply.length > 0 && preferenceReply.length <= 120 &&
        !/[?]/.test(input.context.message.text) &&
        !/\b(?:show|search|find|list|options|recommend|book|reserve)\b/i.test(preferenceReply) &&
        !hasExplicitBookingRequest(input.context.message.text)) {
      const entities = validateCriteria('restaurant', {
        additionalPreferences: model.entities.additionalPreferences ??
          model.entities.diningStyle ?? preferenceReply,
      }, false);
      const sessionPatch = buildPatchedSession(active, 'restaurant', entities,
        requiredFieldsForAction('restaurant', 'discovery'));
      return { action: 'continue_flow', intent: 'restaurant_search', targetFlow: 'restaurant',
        confidence: model.confidence, entities, missingFields: sessionPatch?.missingFields ?? [],
        sessionPatch, reason: 'Save a preference before starting discovery.' };
    }
    if (model?.clarificationRequired || model?.suggestedAction === 'handoff' || model?.suggestedAction === 'clarify' ||
        (model && model.confidence < env.llm.confidenceThreshold)) {
      return {
        action: model.suggestedAction === 'handoff' && model.confidence >= env.llm.confidenceThreshold ? 'handoff' : 'ask_clarifying_question',
        intent: model.intent, targetFlow: input.context.activeSession?.flow ?? 'none',
        confidence: model.confidence, entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Model proposal requires clarification or an authorized human handoff.',
      };
    }
    const signal = mergeSignals(input.analysis, input.interpretation);
    // A model proposal cannot turn a travel statement or a request for ideas
    // into a booking form. The traveller must explicitly ask to proceed.
    if (model?.proposedAction?.name === 'open_form' &&
        !hasExplicitBookingRequest(input.context.message.text)) {
      return { action: 'answer_general_question', intent: 'general_inquiry',
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'A booking form requires an explicit traveller request to proceed.' };
    }
    const targetFlow = resolveTargetFlow(signal.intent, input.context.activeSession?.flow);
    const registeredSchema = workflow(targetFlow)?.schema;
    const proposedSchema = model?.proposedAction?.arguments.schemaId;
    if (model && registeredSchema &&
        ((model.recommendedSchema && model.recommendedSchema !== registeredSchema) ||
          (proposedSchema && proposedSchema !== registeredSchema))) {
      return { action: 'ask_clarifying_question', intent: signal.intent,
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'The proposed schema does not match the interpreted workflow.' };
    }
    // The analyzer supplies hints. Once the primary model has interpreted a
    // conversational turn, an awaited-field guess cannot become a field update.
    const claimedSelection = input.analysis.entities.selection;
    const verifiedResult = typeof claimedSelection === 'number'
      ? input.context.activeSession?.verifiedResults?.items.find((item) =>
        item.position === claimedSelection && item.resultId === input.analysis.entities.resultId)
      : undefined;
    const groundedResultReference = verifiedResult ? {
      selection: verifiedResult.position,
      resultId: verifiedResult.resultId,
      referencedResultName: verifiedResult.name,
    } : {};
    const entities: Record<string, unknown> = input.interpretation && input.analysis.role !== 'command'
      ? { ...input.interpretation.entities, ...groundedResultReference }
      : { ...input.analysis.entities };
    if (!active && pendingPlaceField && contextualPlace && entities[pendingPlaceField] === undefined) {
      entities[pendingPlaceField] = contextualPlace;
    }
    if (targetFlow === 'restaurant' && entities.specialOccasion === undefined) {
      const occasion = recentRestaurantOccasion(input.context);
      if (occasion) entities.specialOccasion = occasion;
    }
    const placeField = targetFlow === 'logistics' ? 'pickupLocation'
      : targetFlow === 'excursion' ? 'destination'
      : targetFlow === 'hotel' || targetFlow === 'restaurant' ? 'location' : undefined;
    if (placeField && entities[placeField] === undefined && !input.context.activeSession?.collectedFields[placeField]) {
      const location = input.context.travellerMemories?.find((fact) =>
        fact.status === 'confirmed' && fact.key === 'current_location' &&
        (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now()));
      if (location && !/\b(in|at|to|around|near)\s+[A-Z][\p{L}-]{2,}/u.test(input.context.message.text)) {
        entities[placeField] = location.value;
      }
    }
    const current = input.context.activeSession;
    const pendingLocationAnswer = !current && targetFlow !== 'none' &&
      /\b(?:which|what|where)\b.*\b(?:town|area|location|dine|stay|search)\b/i.test(input.context.pendingQuestion?.text ?? '') &&
      typeof entities[placeField ?? ''] === 'string' &&
      input.context.message.text.trim().replace(/[.!?]+$/, '').toLocaleLowerCase() ===
        String(entities[placeField ?? '']).trim().toLocaleLowerCase();
    if (pendingLocationAnswer) {
      const sessionPatch = buildPatchedSession(undefined, targetFlow, entities,
        requiredFieldsForAction(targetFlow, 'discovery'));
      return { action: 'continue_flow', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities, missingFields: sessionPatch?.missingFields ?? [],
        sessionPatch, reason: 'Save a location answer before starting discovery.' };
    }
    const preferenceOnlyAnswer = model?.proposedAction?.name === 'search' && targetFlow === 'restaurant' &&
      (typeof entities.additionalPreferences === 'string' || typeof entities.diningStyle === 'string') &&
      input.context.message.text.trim().split(/\s+/).length <= 5 &&
      !/\b(?:show|search|find|list|options|recommend|restaurants?|dining|book|reserve)\b/i.test(input.context.message.text);
    if (preferenceOnlyAnswer) {
      const sessionPatch = buildPatchedSession(current, targetFlow, entities,
        requiredFieldsForAction(targetFlow, 'discovery'));
      return { action: 'continue_flow', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities, missingFields: sessionPatch?.missingFields ?? [],
        sessionPatch, reason: 'Save a preference before starting discovery.' };
    }
    if (model && current?.flow === targetFlow && model.role !== 'change_existing_criteria' &&
        model.role !== 'answer_to_current_question' &&
        Object.entries(entities).some(([key, value]) => current.collectedFields[key] !== undefined &&
          JSON.stringify(current.collectedFields[key]) !== JSON.stringify(value))) {
      return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities: {}, missingFields: current.missingFields,
        reason: 'Clarify a conflicting field proposal that was not interpreted as an update.' };
    }
    if (!input.context.profileComplete && requiresProfile(signal.intent)) {
      return {
        action: 'require_profile',
        intent: signal.intent,
        targetFlow: 'profile',
        confidence: signal.confidence,
        entities,
        missingFields: [],
        reason: 'Profile-first gate required before service orchestration.',
      };
    }

    if (signal.intent === 'profile_update') {
      return { action: 'send_form', intent: signal.intent, targetFlow: 'profile', confidence: signal.confidence,
        entities: {}, missingFields: [], reason: 'Profile corrections require a validated profile form.' };
    }

    if (input.analysis.role === 'command') {
      return {
        action: 'handle_command',
        intent: 'command',
        targetFlow,
        confidence: input.analysis.confidence,
        entities,
        missingFields: [],
        reason: `Handle deterministic command${input.analysis.command ? `: ${input.analysis.command}` : ''}.`,
      };
    }

    const awaitingRestaurantOptions = input.context.activeSession?.flow === 'restaurant' &&
      input.context.activeSession.state === 'awaiting_preferences' &&
      /^(?:(?:yes|sure)[,!]?\s*(?:please)?\s*(?:show(?: me)?(?: a few| some| the)? options)?|show(?: me)?(?: a few| some| the)? options|search now)[.!?\s]*$/i.test(input.context.message.text.trim());
    if (awaitingRestaurantOptions && model?.taskTransition !== 'switch' && model?.taskTransition !== 'pause') {
      const sessionPatch = buildPatchedSession(input.context.activeSession, 'restaurant', {},
        requiredFieldsForAction('restaurant', 'provider_search'));
      if (sessionPatch && sessionPatch.missingFields.length === 0) {
        return { action: 'execute_search', intent: 'restaurant_search', targetFlow: 'restaurant',
          confidence: signal.confidence, entities: {}, missingFields: [], sessionPatch,
          reason: 'The traveller explicitly requested options for the saved draft.' };
      }
    }

    if (signal.intent === 'smalltalk') {
      return {
        action: 'answer_smalltalk',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields: [],
        reason: 'Smalltalk should not mutate service flow state.',
      };
    }

    if (signal.intent === 'general_inquiry') {
      return {
        action: 'answer_general_question', intent: signal.intent, targetFlow: input.context.activeSession?.flow ?? 'none',
        confidence: signal.confidence, entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Answer the general question without activating a transactional workflow.',
      };
    }

    if (model?.responseText && (!model.proposedAction || model.proposedAction.name === 'none') &&
        model.taskTransition !== 'switch' && model.taskTransition !== 'resume' &&
        model.suggestedAction !== 'execute_tool' && Object.keys(entities).length === 0 &&
        (model.role === 'question_or_faq' || input.context.activeSession?.flow === targetFlow)) {
      return {
        action: 'answer_general_question', intent: signal.intent,
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Use the primary conversational reply without advancing a workflow field.',
      };
    }

    if (signal.role === 'question_or_faq') {
      return {
        action: 'answer_general_question',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Answer side question, then resume the current flow.',
      };
    }

    // A workflow change is a state transition, not an implicit consequence of
    // an uncertain classification. Require a confident explicit route or a
    // confident model switch proposal before replacing active journey state.
    if (current && targetFlow !== 'none' && targetFlow !== current.flow) {
      const explicitSwitch = input.analysis.role === 'new_intent' &&
        input.analysis.confidence >= env.llm.confidenceThreshold &&
        resolveTargetFlow(input.analysis.intent) === targetFlow;
      const modelSwitch = model?.taskTransition === 'switch' &&
        model.confidence >= env.llm.confidenceThreshold && resolveTargetFlow(model.intent) === targetFlow;
      if (!(model ? modelSwitch : explicitSwitch)) {
        return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow: current.flow,
          confidence: signal.confidence, entities: {}, missingFields: current.missingFields,
          reason: `Confirm whether to switch from ${current.flow} to ${targetFlow}.` };
      }
      if (model?.proposedAction?.name === 'open_form' && hasExplicitBookingRequest(input.context.message.text)) {
        return { action: 'send_form', intent: signal.intent, targetFlow,
          confidence: signal.confidence, entities, missingFields: [],
          reason: `The traveller explicitly requested a ${targetFlow} booking form while switching tasks.` };
      }
    }

    const requestedStage: WorkflowActionStage = model?.proposedAction?.name === 'open_form' ? 'booking'
      : model?.proposedAction?.name === 'search' ||
          (!model?.proposedAction && (model?.suggestedAction === 'execute_tool' ||
            model?.suggestedAction === 'ask_missing')) ? 'provider_search' : 'discovery';
    const actionRequested = requestedStage !== 'discovery';
    if (model && !actionRequested && !current && model.taskTransition !== 'switch') {
      return { action: 'answer_general_question', intent: signal.intent, targetFlow: 'none',
        confidence: model.confidence, entities: {}, missingFields: [],
        reason: 'A service mention alone does not activate a workflow.' };
    }
    const requiredFields = model && (actionRequested || current?.flow !== targetFlow)
      ? requiredFieldsForAction(targetFlow, requestedStage)
      : current?.flow === targetFlow ? current.requiredFields : workflow(targetFlow)?.required ?? [];
    const combinedFields = { ...(current?.flow === targetFlow ? current.collectedFields : {}), ...entities };
    if (targetFlow === 'hotel' || targetFlow === 'itinerary') {
      const [start, end] = targetFlow === 'hotel'
        ? ['checkinDate', 'checkoutDate'] : ['arrivalDate', 'departureDate'];
      if (typeof combinedFields[start] === 'string' && typeof combinedFields[end] === 'string' &&
          combinedFields[end] <= combinedFields[start]) {
        return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow,
          confidence: signal.confidence, entities: {}, missingFields: current?.missingFields ?? [],
          reason: `Clarify the ${end} after the proposed ${start} change.` };
      }
    }
    const patchedSession = buildPatchedSession(input.context.activeSession, targetFlow, entities, requiredFields);
    const missingFields = patchedSession?.missingFields ?? [];

    if (
      input.context.activeSession &&
      targetFlow !== 'none' &&
      targetFlow !== input.context.activeSession.flow
    ) {
      return {
        action: 'switch_flow',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: `Switch from ${input.context.activeSession.flow} to ${targetFlow}.`,
      };
    }

    if (current?.flow === targetFlow && model?.role === 'change_existing_criteria' &&
        (!model.proposedAction || model.proposedAction.name === 'none') && model.suggestedAction !== 'execute_tool') {
      return { action: 'continue_flow', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities, missingFields,
        sessionPatch: patchedSession,
        reason: 'Persist the corrected fields without running a new action.' };
    }

    if (targetFlow !== 'none' && requestedStage === 'booking') {
      return { action: 'send_form', intent: signal.intent, targetFlow, confidence: signal.confidence,
        entities, missingFields, sessionPatch: patchedSession,
        reason: 'The traveller requested a structured service request; the backend form validates booking details.' };
    }

    if (model && !actionRequested && current?.flow === targetFlow) {
      return { action: Object.keys(entities).length ? 'continue_flow' : 'answer_general_question',
        intent: signal.intent, targetFlow, confidence: signal.confidence, entities,
        missingFields, sessionPatch: Object.keys(entities).length ? patchedSession : undefined,
        reason: 'Keep the active journey without automatically searching or collecting another field.' };
    }

    if (targetFlow !== 'none' && missingFields.length > 0) {
      return {
        action: model ? 'continue_flow' : input.context.activeSession ? 'continue_flow' : 'send_form',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: `Missing required fields: ${missingFields.join(', ')}.`,
      };
    }

    if (targetFlow !== 'none' && (!model || actionRequested)) {
      return {
        action: 'execute_search',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: 'Required criteria are complete after merging entities.',
      };
    }

    return {
      action: signal.confidence < 0.5 ? 'ask_clarifying_question' : 'no_op',
      intent: signal.intent,
      targetFlow: 'none',
      confidence: signal.confidence,
      entities,
      missingFields: [],
      reason: 'No executable service flow was identified.',
    };
  }
}

function hasExplicitBookingRequest(message: string): boolean {
  return /\b(?:book|reserve|purchase|pay)\b|\bconfirm\s+(?:the\s+|my\s+)?(?:booking|reservation|order)\b|\bproceed\s+with\s+(?:the\s+|my\s+)?(?:booking|reservation|order)\b|\bplace\s+(?:the\s+|an?\s+)?order\b/i.test(message);
}

function mergeSignals(
  analysis: ConversationAnalysis,
  interpretation?: LLMInterpretation
): {
  role: ConversationAnalysis['role'];
  intent: OrchestrationIntent;
  confidence: number;
} {
  if (!interpretation) {
    return {
      role: analysis.role,
      intent: analysis.intent,
      confidence: analysis.confidence,
    };
  }

  const interpretationWins = analysis.role !== 'command';
  return {
    role: interpretationWins ? interpretation.role : analysis.role,
    intent: interpretationWins ? interpretation.intent : analysis.intent,
    confidence: Math.max(analysis.confidence, interpretation.confidence),
  };
}

function recentRestaurantOccasion(context: OrchestrationContext): string | undefined {
  const recentUserText = (context.conversationHistory ?? []).slice(-6)
    .filter((turn) => turn.role === 'user').map((turn) => turn.content.toLocaleLowerCase()).join(' ');
  const occasion = context.travellerMemories?.find((fact) =>
    fact.key === 'occasion' && fact.status === 'confirmed' && fact.value.length > 2 &&
    recentUserText.includes(fact.value.toLocaleLowerCase()));
  if (occasion) return occasion.value;
  return /\banniversary\b/i.test(recentUserText) ? 'anniversary' : undefined;
}

function buildPatchedSession(
  current: OrchestrationSessionSnapshot | undefined,
  targetFlow: OrchestrationFlow,
  entities: Record<string, unknown>,
  requestedFields?: readonly string[]
): OrchestrationSessionSnapshot | undefined {
  if (targetFlow === 'none' || targetFlow === 'profile') {
    return undefined;
  }

  const requiredFields = requestedFields ?? (current?.flow === targetFlow
    ? current.requiredFields
    : defaultRequiredFields(targetFlow));
  const collectedFields = {
    ...(current?.flow === targetFlow ? current.collectedFields : {}),
    ...validateCriteria(targetFlow, entities, false),
  };

  return {
    id: current?.flow === targetFlow ? current.id : undefined,
    revision: current?.flow === targetFlow ? current.revision : undefined,
    flow: targetFlow,
    state: current?.flow === targetFlow ? current.state : 'collecting_required_details',
    activeSchema: schemaForFlow(targetFlow),
    collectedFields,
    requiredFields: [...requiredFields],
    missingFields: computeMissing(targetFlow, collectedFields, requiredFields),
    updatedAt: current?.updatedAt,
  };
}

function resolveTargetFlow(
  intent: OrchestrationIntent,
  activeFlow?: OrchestrationFlow
): OrchestrationFlow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'excursion_search') return 'excursion';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'itinerary_plan') return 'itinerary';
  if (intent === 'profile_update') return 'profile';
  if (intent === 'smalltalk' || intent === 'command' || intent === 'unclear') {
    return activeFlow ?? 'none';
  }
  return 'none';
}

function requiresProfile(intent: OrchestrationIntent): boolean {
  return intent === 'hotel_search' ||
    intent === 'restaurant_search' ||
    intent === 'excursion_search' ||
    intent === 'logistics_request' ||
    intent === 'itinerary_plan';
}

function defaultRequiredFields(flow: OrchestrationFlow): string[] {
  return [...(workflow(flow)?.required ?? [])];
}

function schemaForFlow(flow: OrchestrationFlow): string | undefined {
  return workflow(flow)?.schema;
}

function removeUndefinedValues(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}
