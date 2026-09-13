/**
 * Core type definitions for YANA / OGO Platform
 */

// ============================================================================
// Enums
// ============================================================================

export enum BookingState {
  INITIATED = 'initiated',
  HOLD_REQUESTED = 'hold_requested',
  HOLD_CONFIRMED = 'hold_confirmed',
  PAYMENT_PENDING = 'payment_pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
}

export enum PaymentState {
  INITIATED = 'initiated',
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
  REFUNDED_OR_CANCELLED = 'refunded_or_cancelled',
}

export enum ErrorCategory {
  USER_INPUT_ERROR = 'user_input_error',
  SCHEMA_ERROR = 'schema_error',
  PROVIDER_FAILURE = 'provider_failure',
  PAYMENT_FAILURE = 'payment_failure',
  TRANSLATION_FAILURE = 'translation_failure',
  INTERNAL_SYSTEM_ERROR = 'internal_system_error',
}

export enum IntentMode {
  EXPLORE = 'explore',
  BOOK_NOW = 'book_now',
  COMPARE = 'compare',
}

// ============================================================================
// Inbound Message Types
// ============================================================================

export interface InboundMessage {
  messageId: string;
  from: string;
  to: string;
  timestamp: Date;
  type: 'text' | 'media' | 'audio' | 'interactive';
  inputType?: 'text' | 'voice' | 'media' | 'interactive';
  content: MessageContent;
  metadata?: Record<string, unknown>;
}

export type MessageContent =
  | TextContent
  | MediaContent
  | AudioContent
  | InteractiveContent;

export interface TextContent {
  type: 'text';
  body: string;
}

export interface MediaContent {
  type: 'media';
  mediaType: 'image' | 'video' | 'document';
  mediaUrl: string;
  caption?: string;
}

export interface AudioContent {
  type: 'audio';
  audioUrl: string;
  contentType?: string;
}

export interface InteractiveContent {
  type: 'interactive';
  interactionType: 'button_reply' | 'list_reply';
  selectedId: string;
  selectedTitle?: string;
}

// ============================================================================
// Session and User Types
// ============================================================================

export interface Session {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
  state: SessionState;
  conversationHistory: ConversationMessage[];
}

export interface SessionState {
  currentIntent?: string;
  currentStep?: string;
  activeSchema?: string;
  schemaVersion?: string;
  missingFields: string[];
  collectedFields: Record<string, unknown>;
  pendingOptions?: PendingOption[];
  bookingProgress?: BookingProgress;
  paymentProgress?: PaymentProgress;
  humanHandoff?: { handoffId: string; status: 'handed_off' };
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface PendingOption {
  id: string;
  title: string;
  description?: string;
}

export interface BookingProgress {
  bookingId?: string;
  state: BookingState;
  selectedService?: unknown;
}

export interface PaymentProgress {
  paymentId?: string;
  state: PaymentState;
  amount?: number;
  currency?: string;
}

export interface UserProfile {
  userId: string;
  phoneNumber: string;
  name?: string;
  nationality?: string;
  preferredLanguage: string;
  homeLocation?: string;
  preferredCurrency: string;
  communicationPreferences: CommunicationPreferences;
  behavioralMemory: BehavioralMemory;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunicationPreferences {
  ttsEnabled: boolean;
  proactiveMessagingEnabled: boolean;
  notificationPreferences: Record<string, boolean>;
}

export interface BehavioralMemory {
  recentActions: string[];
  frequentServices: string[];
  commonDestinations: string[];
  preferredVendors: string[];
  pastBookings: string[];
  timingPatterns?: Record<string, unknown>;
}

// ============================================================================
// Schema Types
// ============================================================================

export interface SchemaDefinition {
  schemaName: string;
  version: string;
  requiredFields: string[];
  optionalFields: string[];
  fields: Record<string, SchemaField>;
  metadata?: Record<string, unknown>;
}

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  ui: SchemaFieldUI;
  validation: SchemaFieldValidation;
  conditional?: SchemaFieldConditional;
}

export type SchemaFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'location'
  | 'location_or_text'
  | 'currency'
  | 'boolean'
  | 'enum';

export interface SchemaFieldUI {
  promptKey: string;
  mode: 'text' | 'buttons' | 'list' | 'list_or_text';
  options?: SchemaFieldOption[];
  placeholder?: string;
}

export interface SchemaFieldOption {
  id: string;
  labelKey: string;
  value: unknown;
}

export interface SchemaFieldValidation {
  required: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  customValidator?: string;
}

export interface SchemaFieldConditional {
  dependsOn: string;
  condition: 'equals' | 'not_equals' | 'exists' | 'not_exists';
  value?: unknown;
}

// ============================================================================
// LLM Decision Types
// ============================================================================

export interface LLMDecisionOutput {
  intent: string;
  parameters: Record<string, unknown>;
  missingFields: string[];
  suggestedAction: 'ask_missing' | 'execute_tool' | 'clarify' | 'handoff';
  confidence: number;
  reasoning?: string;
}

// ============================================================================
// Tool Call Types
// ============================================================================

export interface ToolCallRequest {
  tool: string;
  params: Record<string, unknown>;
  context: ToolCallContext;
}

export interface ToolCallContext {
  userLanguage: string;
  canonicalLanguage: string;
  sessionId: string;
  requestId: string;
  userId?: string;
}

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: ToolCallError;
  metadata: ToolCallMetadata;
}

export interface ToolCallError {
  category: ErrorCategory;
  message: string;
  code?: string;
  retryable: boolean;
}

export interface ToolCallMetadata {
  toolName: string;
  executionTimeMs: number;
  attemptNumber: number;
  provider?: string;
  timestamp: Date;
}

// ============================================================================
// Provider Failure Types
// ============================================================================

/**
 * Structured failure state returned when provider exhausts retry policy
 * 
 * Requirements: 6.6, 13.2
 */
export interface ProviderFailureState {
  /** Error classification category */
  category: ErrorCategory;
  /** Human-readable error message */
  message: string;
  /** Error code (if available) */
  code?: string;
  /** Whether the error is retryable (should be false after exhaustion) */
  retryable: boolean;
  /** Provider-specific error code */
  providerCode?: string;
  /** Provider-specific error message */
  providerMessage?: string;
  /** Context about the failure */
  context: ProviderFailureContext;
}

/**
 * Context information about a provider failure
 */
export interface ProviderFailureContext {
  /** Name of the provider that failed */
  providerName: string;
  /** Number of attempts made before failure */
  attemptCount: number;
  /** Total time spent attempting the operation (ms) */
  totalExecutionTimeMs: number;
  /** Timestamp of the final failure */
  timestamp: Date;
  /** Correlation context for tracing */
  correlationId: string;
  /** Last HTTP status code (if applicable) */
  lastStatusCode?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Booking Types
// ============================================================================

export interface BookingRecord {
  bookingId: string;
  userId: string;
  sessionId: string;
  state: BookingState;
  serviceType: string;
  serviceDetails: Record<string, unknown>;
  providerName?: string;
  providerBookingRef?: string;
  amount?: number;
  currency?: string;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  timedOutAt?: Date;
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentRecord {
  paymentId: string;
  bookingId: string;
  userId: string;
  state: PaymentState;
  amount: number;
  currency: string;
  paymentMethod: 'telco_billing' | 'payment_link' | 'other';
  providerName: string;
  providerPaymentRef?: string;
  paymentUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  succeededAt?: Date;
  failedAt?: Date;
  timedOutAt?: Date;
}

// ============================================================================
// Audit and Logging Types
// ============================================================================

export interface AuditLogEntry {
  logId: string;
  correlationId: string;
  sessionId?: string;
  userId?: string;
  phoneHash?: string;
  actionType: string;
  modelUsed?: string;
  toolUsed?: string;
  providerUsed?: string;
  executionStatus: 'success' | 'failure' | 'pending';
  latencyMs?: number;
  errorCode?: string;
  errorCategory?: ErrorCategory;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface CorrelationContext {
  correlationId: string;
  sessionId?: string;
  userId?: string;
  requestTimestamp: Date;
}
