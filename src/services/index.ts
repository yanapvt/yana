/**
 * Services module exports
 */

export { StateStore, getStateStore, initStateStore, closeStateStore } from './StateStore.js';
export type { ToolCacheEntry } from './StateStore.js';

export { SessionManager } from './SessionManager.js';
export type {
  ContextPackage,
  UserProfileSummary,
  SchemaProgress,
  CreateSessionResult,
} from './SessionManager.js';

export { SchemaEngine } from './SchemaEngine.js';
export type {
  CollectedFields,
  FieldPrompt,
  FieldPromptOption,
  ValidationResult,
  FieldValidationError,
} from './SchemaEngine.js';

export { LLMService, getLLMService, initLLMService, LLMServiceError } from './LLMService.js';
export type { ContextPackage as LLMContextPackage, LLMConfig } from './LLMService.js';

export { Orchestrator, getOrchestrator, initOrchestrator } from './Orchestrator.js';
export type {
  ValidationResult as OrchestratorValidationResult,
  ValidationError as OrchestratorValidationError,
  OrchestratorConfig,
  ValidatedDecision,
} from './Orchestrator.js';

export { ToolRegistry } from './ToolRegistry.js';
export type {
  ToolDefinition,
  ToolParameters,
  ParameterDefinition,
  ParameterValidation,
  ProviderMapping,
  ExecutionPolicy,
  ToolPermissions,
  SchemaBindings,
  ToolRegistrationResult,
} from './ToolRegistry.js';

export { MCPInterface } from './MCPInterface.js';
export type { ProviderAdapter } from './MCPInterface.js';

export {
  TranslationService,
  getTranslationService,
  initTranslationService,
  TranslationServiceError,
} from './TranslationService.js';
export type {
  LanguageDetectionResult,
  TranslationResult,
  TranslationRecord,
  TranslationConfig,
} from './TranslationService.js';

export {
  LanguagePreferenceManager,
  getLanguagePreferenceManager,
  initLanguagePreferenceManager,
  LanguagePreferenceError,
} from './LanguagePreferenceManager.js';
export type { LanguagePreferenceResult } from './LanguagePreferenceManager.js';

export {
  WhatsAppRenderer,
  getWhatsAppRenderer,
  initWhatsAppRenderer,
  WhatsAppRendererError,
  WHATSAPP_LIMITS,
} from './WhatsAppRenderer.js';
export type {
  RenderableContent,
  TextRenderContent,
  ButtonsRenderContent,
  ListRenderContent,
  ConfirmationRenderContent,
  FieldPromptRenderContent,
  ButtonOption,
  ListSection,
  ListRow,
  ConfirmationSummary,
  WhatsAppMessage,
  WhatsAppMessagePart,
  WhatsAppTextMessage,
  WhatsAppButtonsMessage,
  WhatsAppListMessage,
  ValidationResult as WhatsAppValidationResult,
  ValidationError as WhatsAppValidationError,
  ValidationWarning as WhatsAppValidationWarning,
} from './WhatsAppRenderer.js';
