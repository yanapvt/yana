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
import { expectedFieldForConversation, explicitFieldsInPendingAnswer,
  fieldQuestionPurpose, isExplicitServiceRequest } from './ConversationAnalyzer.js';
import { isInformationalRequest, requestsExplicitFieldChange, supportedWorkflowFields } from './MutationAuthority.js';
import { canonicalField, missingFields as computeMissing, requiredFieldsForAction, validateCriteria, workflow, type WorkflowActionStage } from './WorkflowDefinitions.js';

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
    if (input.context.pendingQuestion && input.analysis.role !== 'answer_to_current_question') {
      const current = input.context.activeSession;
      if (current && model?.role === 'change_existing_criteria' &&
          (!input.analysis.pendingAnswerMismatch || requestsExplicitFieldChange(input.context.message.text)) &&
          resolveTargetFlow(model.intent) === current.flow &&
          !model.clarificationRequired && model.confidence >= env.llm.confidenceThreshold &&
          model.taskTransition !== 'switch' && model.taskTransition !== 'pause' &&
          (!model.proposedAction || model.proposedAction.name === 'none')) {
        const candidates = supportedWorkflowFields(current.flow, model.entities, input.context.message.text,
          { existingFields: current.collectedFields,
            pendingField: expectedFieldForConversation(current.flow, input.context.pendingQuestion.expectedAnswerType),
            confirmedLocation: current.pendingDecisions?.locationConfirmation });
        const corrections = Object.fromEntries(Object.entries(candidates).filter(([field, value]) =>
          current.collectedFields[field] !== undefined &&
          JSON.stringify(current.collectedFields[field]) !== JSON.stringify(value)));
        if (Object.keys(corrections).length) {
          const sessionPatch = buildPatchedSession(current, current.flow, corrections,
            current.requiredFields);
          return { action: 'continue_flow', intent: model.intent, targetFlow: current.flow,
            confidence: model.confidence, entities: corrections,
            missingFields: sessionPatch?.missingFields ?? [], sessionPatch,
            reason: 'Persist the corrected fields without running a new action.' };
        }
      }
      if (input.analysis.pendingAnswerMismatch) {
        return { action: 'ask_clarifying_question', intent: input.analysis.intent,
          targetFlow: input.analysis.targetFlow, confidence: input.analysis.confidence,
          entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
          reason: 'The reply does not match the pending answer type.' };
      }
    }
    if (model?.taskTransition === 'pause' && input.context.activeSession &&
        !model.clarificationRequired && model.confidence >= env.llm.confidenceThreshold) {
      return {
        action: 'pause_flow', intent: model.intent, targetFlow: input.context.activeSession.flow,
        confidence: model.confidence, entities: {}, missingFields: input.context.activeSession.missingFields,
        reason: 'Validated model interpretation requested pausing the active workflow.',
      };
    }
    const continuationFlow = input.analysis.role === 'answer_to_current_question'
      ? input.analysis.targetFlow : 'none';
    const continuationField = expectedFieldForConversation(continuationFlow,
      input.context.pendingQuestion?.expectedAnswerType);
    const continuationValue = continuationField && input.analysis.entities[continuationField];
    if (!input.context.activeSession && continuationFlow !== 'none' && continuationField &&
        continuationValue !== undefined &&
        !model?.clarificationRequired) {
      const entities = validateCriteria(continuationFlow, {
        ...explicitAdditionalFields(input.context.message.text, continuationField),
        [continuationField]: continuationValue,
      }, false);
      const sessionPatch = buildPatchedSession(undefined, continuationFlow, entities,
        requiredFieldsForAction(continuationFlow, 'discovery'));
      return { action: 'continue_flow', intent: input.analysis.intent, targetFlow: continuationFlow,
        confidence: input.analysis.confidence, entities,
        missingFields: sessionPatch?.missingFields ?? [], sessionPatch,
        reason: 'Save a location answer before starting discovery.' };
    }
    const proposedQuestion = fieldQuestionPurpose(model?.responseText, model?.followUpQuestion);
    if (proposedQuestion?.ambiguous) {
      return { action: 'ask_clarifying_question', intent: input.analysis.intent,
        targetFlow: input.context.activeSession?.flow ?? 'none',
        confidence: model?.confidence ?? input.analysis.confidence, entities: {},
        missingFields: input.context.activeSession?.missingFields ?? [],
        reason: proposedQuestion.ambiguousField
          ? 'Clarify which field the proposed question asks for.'
          : 'Clarify which service owns the proposed field question.' };
    }
    const questionOwner = proposedQuestion && proposedQuestion.flow !== 'none' ? proposedQuestion.flow
      : model && resolveTargetFlow(model.intent) !== 'none' ? resolveTargetFlow(model.intent)
      : input.analysis.role === 'new_intent' ? input.analysis.targetFlow : 'none';
    const activeFlow = input.context.activeSession?.flow;
    const acceptedTopic = input.context.conversationTopic;
    const ownedFlow = activeFlow ?? (acceptedTopic === 'hotel' || acceptedTopic === 'restaurant' ||
      acceptedTopic === 'excursion' || acceptedTopic === 'logistics' || acceptedTopic === 'itinerary'
      ? acceptedTopic : undefined);
    // A clear traveller request remains authoritative when the model omits its
    // optional transition hint. Require independent analyzer evidence and an
    // agreeing interpreted service; a service mentioned in a question is not a switch.
    const explicitSwitch = Boolean(ownedFlow && input.analysis.role === 'new_intent' &&
      input.analysis.targetFlow !== 'none' && input.analysis.targetFlow !== ownedFlow &&
      input.analysis.confidence >= env.llm.confidenceThreshold &&
      isExplicitServiceRequest(input.context.message.text.trim().toLocaleLowerCase(),
        input.analysis.targetFlow, ownedFlow) &&
      !isInformationalRequest(input.context.message.text) &&
      (!model || resolveTargetFlow(model.intent) === input.analysis.targetFlow));
    const acceptedSwitch = (model?.taskTransition === 'switch' &&
      !isInformationalRequest(input.context.message.text) &&
      model.confidence >= env.llm.confidenceThreshold && resolveTargetFlow(model.intent) === questionOwner) ||
      (explicitSwitch && questionOwner === input.analysis.targetFlow);
    if (proposedQuestion && ownedFlow && questionOwner !== 'none' && questionOwner !== ownedFlow &&
        !acceptedSwitch) {
      return { action: 'ask_clarifying_question', intent: input.analysis.intent,
        targetFlow: ownedFlow, confidence: model?.confidence ?? input.analysis.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: `Confirm whether to switch from ${ownedFlow} to ${questionOwner}.` };
    }
    if (proposedQuestion && ownedFlow && !activeFlow && questionOwner !== 'none' &&
        questionOwner !== ownedFlow && acceptedSwitch) {
      return { action: 'answer_general_question', intent: model!.intent, targetFlow: questionOwner,
        confidence: model!.confidence, entities: {}, missingFields: [],
        reason: 'Validated conversational topic switch without an active workflow.' };
    }
    // A validated conversational answer takes precedence over keyword hints.
    // A side question can mention another service without requesting a switch.
    if (model?.intent === 'general_inquiry' && model.role === 'question_or_faq' &&
        model.responseText && !model.clarificationRequired && model.taskTransition !== 'switch' &&
        model.confidence >= env.llm.confidenceThreshold &&
        !(model.followUpQuestion && input.context.activeSession &&
          input.analysis.role === 'new_intent' && input.analysis.targetFlow !== 'none' &&
          input.analysis.targetFlow !== input.context.activeSession.flow)) {
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
    const awaitedField = active?.flow === continuationFlow && continuationField
      ? continuationField : active?.awaitedField;
    const awaitedValue = awaitedField && input.analysis.role === 'answer_to_current_question'
      ? input.analysis.entities[awaitedField] : undefined;
    const groundedAnswer = active && awaitedField && awaitedValue !== undefined &&
      input.analysis.targetFlow === active.flow &&
      !/[?]/.test(input.context.message.text);
    if (groundedAnswer && model?.clarificationRequired) {
      return { action: 'ask_clarifying_question', intent: model.intent,
        targetFlow: active.flow, confidence: model.confidence, entities: { [awaitedField]: awaitedValue },
        missingFields: active.missingFields,
        reason: 'Clarify the answer to the current question without changing saved fields.' };
    }
    if (groundedAnswer) {
      const entities = validateCriteria(active.flow, {
        [awaitedField]: awaitedValue,
        ...explicitAdditionalFields(input.context.message.text, awaitedField),
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
      const proposedPreference = supportedWorkflowFields('restaurant', {
        additionalPreferences: model.entities.additionalPreferences ??
          model.entities.diningStyle ?? preferenceReply,
        ...explicitFieldsInPendingAnswer(input.context.message.text),
      }, input.context.message.text, { existingFields: active.collectedFields });
      const entities = validateCriteria('restaurant', {
        ...proposedPreference,
        ...(proposedPreference.additionalPreferences === undefined
          ? supportedWorkflowFields('restaurant', { additionalPreferences: preferenceReply },
              input.context.message.text, { existingFields: active.collectedFields }) : {}),
      }, false);
      if (!Object.keys(entities).length) {
        return { action: 'ask_clarifying_question', intent: 'restaurant_search',
          targetFlow: 'restaurant', confidence: model.confidence, entities: {},
          missingFields: active.missingFields,
          reason: 'Clarify a preference that was not supported by the traveller reply.' };
      }
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
    const modelEntities = input.interpretation?.entities ?? {};
    const informationalQuestion = isInformationalRequest(input.context.message.text);
    if (informationalQuestion && input.context.activeSession?.flow === targetFlow &&
        !model?.clarificationRequired) {
      return { action: 'answer_general_question', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities: {}, missingFields: input.context.activeSession.missingFields,
        reason: 'Answer an informational question without changing saved workflow fields.' };
    }
    const supportedModelFields = supportedWorkflowFields(targetFlow, modelEntities, input.context.message.text,
      { existingFields: input.context.activeSession?.flow === targetFlow
        ? input.context.activeSession.collectedFields : undefined,
        pendingField: expectedFieldForConversation(targetFlow, input.context.pendingQuestion?.expectedAnswerType),
        confirmedLocation: input.context.activeSession?.flow === targetFlow
          ? input.context.activeSession.pendingDecisions?.locationConfirmation : undefined });
    const entities: Record<string, unknown> = input.interpretation && input.analysis.role !== 'command'
      ? { ...Object.fromEntries(Object.entries(modelEntities).filter(([field]) => !canonicalField(targetFlow, field))),
          ...supportedModelFields, ...groundedResultReference }
      : { ...input.analysis.entities };
    if (model?.entities.additionalPreferences && entities.additionalPreferences === undefined &&
        input.context.activeSession?.flow === targetFlow && input.analysis.role === 'extra_preference' &&
        model.role === 'change_existing_criteria' && !/[?]/.test(input.context.message.text)) {
      const statedPreference = input.context.message.text.trim();
      Object.assign(entities, supportedWorkflowFields(targetFlow,
        { additionalPreferences: statedPreference }, input.context.message.text,
        { existingFields: input.context.activeSession.collectedFields }));
    }
    const unsupportedExistingChange = input.context.activeSession?.flow === targetFlow &&
      Object.entries(modelEntities).some(([field, value]) => {
        const canonical = canonicalField(targetFlow, field);
        return canonical && input.context.activeSession?.collectedFields[canonical] !== undefined &&
          JSON.stringify(input.context.activeSession.collectedFields[canonical]) !== JSON.stringify(value) &&
          supportedModelFields[canonical] === undefined;
      });
    if (unsupportedExistingChange && input.analysis.role !== 'question_or_faq' &&
        Object.keys(supportedModelFields).length === 0 && entities.additionalPreferences === undefined) {
      return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Clarify a conflicting field proposal without changing saved fields.' };
    }
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

    const crossFlowQuestion = Boolean(current && targetFlow !== 'none' &&
      targetFlow !== current.flow && (model?.taskTransition === 'switch' || model?.followUpQuestion ||
        explicitSwitch));
    if (model?.responseText && (!model.proposedAction || model.proposedAction.name === 'none') &&
        model.taskTransition !== 'switch' && model.taskTransition !== 'resume' &&
        model.suggestedAction !== 'execute_tool' && Object.keys(entities).length === 0 &&
        !crossFlowQuestion &&
        (model.role === 'question_or_faq' || input.context.activeSession?.flow === targetFlow)) {
      return {
        action: 'answer_general_question', intent: signal.intent,
        targetFlow: input.context.activeSession?.flow ??
          (model.followUpQuestion && model.intent === signal.intent ? targetFlow : 'none'),
        confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Use the primary conversational reply without advancing a workflow field.',
      };
    }

    if (signal.role === 'question_or_faq' && !crossFlowQuestion) {
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
      const modelSwitch = model?.taskTransition === 'switch' &&
        !isInformationalRequest(input.context.message.text) &&
        model.confidence >= env.llm.confidenceThreshold && resolveTargetFlow(model.intent) === targetFlow;
      if (!(modelSwitch || (explicitSwitch && input.analysis.targetFlow === targetFlow))) {
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
      return { action: 'answer_general_question', intent: signal.intent,
        targetFlow: proposedQuestion && model.confidence >= env.llm.confidenceThreshold &&
          model.intent === signal.intent && questionOwner === targetFlow ? targetFlow : 'none',
        confidence: model.confidence, entities: {}, missingFields: [],
        reason: 'A service mention alone does not activate a workflow.' };
    }
    const targetSession = current?.flow === targetFlow ? current
      : input.context.pausedSessions?.find((session) => session.flow === targetFlow);
    const requiredFields = model && (actionRequested || !targetSession)
      ? requiredFieldsForAction(targetFlow, requestedStage)
      : targetSession?.requiredFields ?? workflow(targetFlow)?.required ?? [];
    const combinedFields = { ...targetSession?.collectedFields, ...entities };
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
    const patchedSession = buildPatchedSession(targetSession, targetFlow, entities, requiredFields);
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

  /** Validate the question actually selected for delivery before any workflow
   * transition is applied. This is independent of optional model metadata. */
  validateResponseQuestion(input: DecisionEngineInput, decision: OrchestrationDecision,
    responseText?: string): OrchestrationDecision {
    const question = fieldQuestionPurpose(responseText);
    if (!question) return decision;
    const active = input.context.activeSession?.flow;
    const acceptedTopic = input.context.conversationTopic;
    const owner = active ?? (acceptedTopic === 'hotel' || acceptedTopic === 'restaurant' ||
      acceptedTopic === 'excursion' || acceptedTopic === 'logistics' || acceptedTopic === 'itinerary'
      ? acceptedTopic : undefined);
    if (!question.ambiguous && (question.flow === 'none' ||
        question.flow === decision.targetFlow &&
        (question.flow === owner || decision.action === 'switch_flow' ||
          decision.reason === 'Validated conversational topic switch without an active workflow.' || !owner))) {
      return decision;
    }
    return { action: 'ask_clarifying_question', intent: input.analysis.intent,
      targetFlow: owner ?? 'none', confidence: input.interpretation?.confidence ?? input.analysis.confidence,
      entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
      reason: question.ambiguousField ? 'Clarify which field the proposed question asks for.'
        : question.ambiguous ? 'Clarify which service owns the proposed field question.'
        : `Confirm whether to switch from ${owner ?? 'the current topic'} to ${question.flow}.` };
  }
}

/** Additional pending-answer fields come from the traveller's message, not
 * from the model proposal. The caller validates them for its workflow. */
function explicitAdditionalFields(message: string, answeredField: string): Record<string, unknown> {
  const supported = explicitFieldsInPendingAnswer(message);
  delete supported[answeredField];
  return supported;
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
