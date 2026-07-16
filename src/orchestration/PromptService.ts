import type { ConversationAnalysis, OrchestrationContext } from './Orchestrator.js';

export class PromptService {
  buildInterpreterPrompt(
    context: OrchestrationContext,
    analysis: ConversationAnalysis
  ): string {
    return [
      'You are Yana Core System V2 interpreter.',
      'Interpret the user message only. Do not execute tools, mutate state, book, pay, or send forms.',
      'The application code decides all actions after validating your interpretation.',
      '',
      `User message: ${context.message.text}`,
      `Input type: ${context.message.inputType ?? 'text'}`,
      `Profile complete: ${context.profileComplete}`,
      `Active flow: ${context.activeSession?.flow ?? 'none'}`,
      `Active state: ${context.activeSession?.state ?? 'none'}`,
      `Collected fields: ${JSON.stringify(context.activeSession?.collectedFields ?? {})}`,
      '',
      `Deterministic analysis: ${JSON.stringify({
        role: analysis.role,
        intent: analysis.intent,
        targetFlow: analysis.targetFlow,
        entities: analysis.entities,
        confidence: analysis.confidence,
      })}`,
      '',
      'Return JSON only with:',
      '- role: answer_to_current_question | new_intent | change_existing_criteria | extra_preference | question_or_faq | command | smalltalk | unclear',
      '- intent: hotel_search | restaurant_search | logistics_request | profile_update | smalltalk | command | unclear',
      '- entities: object',
      '- missingFields: string[]',
      '- confidence: number between 0 and 1',
      '- question: string if the user asked a side question',
      '- reasoning: short explanation',
    ].join('\n');
  }

  buildResponseGuidance(context: OrchestrationContext): string {
    return [
      'Write a concise WhatsApp response as Yana.',
      `Preferred name: ${context.profile?.preferredName ?? 'not known'}`,
      `Preferred language: ${context.profile?.preferredLanguage ?? 'English'}`,
      'Be warm, clear, and avoid claiming live availability or final prices.',
    ].join('\n');
  }
}
