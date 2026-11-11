import { z } from 'zod';
import { WORKFLOW_DEFINITIONS, WORKFLOW_SCHEMA_VERSION, validateCriteria, type ServiceFlow } from './WorkflowDefinitions.js';
import type { OrchestrationResult } from './Orchestrator.js';

const schema = z.object({
  version: z.literal('1.0'), mode: z.enum(['chat_reply', 'clarification', 'clarification_form', 'results_list', 'itinerary_editor', 'confirmation']),
  workflow: z.enum(['hotel', 'restaurant', 'excursion', 'logistics', 'itinerary', 'profile', 'none']),
  correlationId: z.string().min(1).max(150), expectedRevision: z.number().int().nonnegative(),
  schemaId: z.string().optional(), schemaVersion: z.literal('1.0'), values: z.record(z.unknown()),
  formId: z.enum(['profile', 'hotel', 'restaurant', 'itinerary', 'excursion', 'excursion_booking', 'logistics', 'logistics_booking']).optional(),
  missingFields: z.array(z.string()).max(30), actions: z.array(z.enum(['reply', 'submit_form', 'next', 'details', 'edit_itinerary', 'confirm'])).max(6),
  text: z.string().max(4096), confirmedByBackend: z.boolean().default(false),
}).strict();
export type SemanticUI = z.infer<typeof schema>;
const allowedActions: Record<SemanticUI['mode'], SemanticUI['actions']> = {
  chat_reply: ['reply'], clarification: ['reply'], clarification_form: ['submit_form'],
  results_list: ['next', 'details'], itinerary_editor: ['edit_itinerary'], confirmation: ['confirm'],
};
export function validateSemanticUI(input: unknown, currentRevision?: number): SemanticUI {
  const value = schema.parse(input);
  const definition = WORKFLOW_DEFINITIONS[value.workflow as ServiceFlow];
  const expectedSchema = value.workflow === 'profile' ? 'profile' : definition?.schema;
  if (value.schemaId !== expectedSchema || value.actions.some((action) => !allowedActions[value.mode].includes(action))) throw new Error('Unapproved UI decision');
  if (value.formId && (value.mode !== 'clarification_form' || value.formId.replace(/_booking$/, '') !== value.workflow)) throw new Error('Unapproved form identifier');
  if (currentRevision !== undefined && value.expectedRevision !== currentRevision) throw new Error('Stale UI revision');
  if (value.mode === 'confirmation' && !value.confirmedByBackend) throw new Error('Confirmation requires backend evidence');
  if (value.mode === 'itinerary_editor' && value.workflow !== 'itinerary') throw new Error('Invalid editor workflow');
  if (definition) {
    value.values = validateCriteria(value.workflow, value.values);
    if (value.missingFields.some((key) => !(definition.fields as readonly string[]).includes(key))) throw new Error('Unknown missing field');
  } else if (Object.keys(value.values).length && value.workflow !== 'profile') throw new Error('Unexpected UI values');
  return value;
}
export function semanticDecision(plan: OrchestrationResult): SemanticUI {
  const decision = plan.decision;
  const proposedMode = plan.interpretation?.uiRecommendation?.mode;
  const backendMode: SemanticUI['mode'] = decision.action === 'send_form' || decision.action === 'require_profile' ? 'clarification_form'
    : decision.action === 'ask_clarifying_question' ? 'clarification' : 'chat_reply';
  const hasCurrentResults = Boolean(plan.context.activeSession?.flow === decision.targetFlow &&
    plan.context.activeSession.verifiedResults?.items.length);
  const hasEditableItinerary = decision.targetFlow === 'itinerary' &&
    Boolean(plan.context.activeSession?.flow === 'itinerary' && plan.context.activeSession.itinerary);
  // The model may choose among renderers only when the backend has the data
  // and state required by that renderer. Provider results and UI actions remain
  // owned by the existing service/channel renderers.
  const supportedProposal = proposedMode === backendMode ||
    (proposedMode === 'results_list' && hasCurrentResults &&
      ['continue_flow', 'handle_command', 'answer_general_question'].includes(decision.action)) ||
    (proposedMode === 'itinerary_editor' && hasEditableItinerary &&
      ['continue_flow', 'handle_command'].includes(decision.action));
  const safeMode = supportedProposal ? proposedMode! : backendMode;
  return validateSemanticUI({ version: '1.0', schemaVersion: WORKFLOW_SCHEMA_VERSION, mode: safeMode,
    workflow: decision.targetFlow, schemaId: decision.targetFlow === 'profile' ? 'profile' : WORKFLOW_DEFINITIONS[decision.targetFlow as ServiceFlow]?.schema,
    correlationId: String(plan.context.metadata.correlationId ?? plan.context.message.messageId),
    expectedRevision: plan.context.activeSession?.revision ?? 0,
    values: validateCriteria(decision.targetFlow, decision.entities, false), missingFields: decision.missingFields,
    actions: allowedActions[safeMode], text: plan.interpretation?.responseText ?? plan.interpretation?.question ?? '', confirmedByBackend: false });
}
export function renderWhatsAppDecision(input: unknown): { text: string; mode: SemanticUI['mode']; schemaId?: string; formId?: SemanticUI['formId'] } {
  const decision = validateSemanticUI(input);
  return { text: decision.text, mode: decision.mode, schemaId: decision.schemaId, formId: decision.formId };
}
export function renderWebsiteDecision(input: unknown): { text: string; mode: SemanticUI['mode']; schemaId?: string; formId?: SemanticUI['formId']; initialValues: Record<string, unknown> } {
  const decision = validateSemanticUI(input);
  return { ...renderWhatsAppDecision(decision), initialValues: decision.values };
}
