/**
 * Environment configuration loader
 * Reads from .env files and validates required configuration
 */

import { config } from 'dotenv';
import { z } from 'zod';
import {
  loadHotelSupplierEnvironment,
  type HotelSupplierEnvironment,
} from './hotelSuppliers.js';

// Load environment variables from .env file
config();

// ============================================================================
// Configuration Schema
// ============================================================================

// Check if we're in test or development mode
const isTestMode = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const isDevelopmentMode = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const isNonProductionMode = isTestMode || isDevelopmentMode;

const EnvironmentSchema = z.object({
  // Environment
  nodeEnv: z.enum(['development', 'staging', 'production', 'test']).default('development'),

  // Twilio / WhatsApp (optional in development/test)
  twilio: z.object({
    accountSid: z.string().default('dev_account_sid'),
    authToken: z.string().default('dev_auth_token'),
    whatsappNumber: z.string().default('+1234567890'),
    webhookSecret: z.string().default('dev_webhook_secret'),
  }),

  whatsapp: z.object({
    provider: z.enum(['twilio', 'openwa', 'meta']).default('twilio'),
  }),

  openwa: z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    sessionId: z.string().optional(),
    webhookSecret: z.string().optional(),
  }),

  meta: z.object({
    accessToken: isNonProductionMode ? z.string().optional() : z.string().min(1).optional(),
    phoneNumberId: isNonProductionMode ? z.string().optional() : z.string().min(1).optional(),
    verifyToken: isNonProductionMode ? z.string().optional() : z.string().min(1).optional(),
    appSecret: z.string().optional(),
    apiVersion: z.string().min(1).default('v20.0'),
    mediaProxySecret: z.string().optional(),
  }),

  // Database (optional in development/test)
  postgres: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    user: isNonProductionMode ? z.string().default('dev_user') : z.string().min(1),
    password: isNonProductionMode ? z.string().default('dev_password') : z.string().min(1),
  }),

  // Redis
  redis: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    password: z.string().optional(),
    db: z.number().int().nonnegative().default(0),
  }),

  // LLM Provider (optional in development/test)
  llm: z.object({
    provider: z.string().min(1),
    apiKey: isNonProductionMode ? z.string().default('dev_api_key') : z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().url().optional(),
    confidenceThreshold: z.number().min(0).max(1).default(0.85),
  }),

  voice: z.object({
    provider: z.string().min(1).default('openai'),
    apiKey: isNonProductionMode ? z.string().optional() : z.string().min(1),
    baseUrl: z.string().url().optional(),
    openAiApiKey: z.string().optional(),
    transcriptionModel: z.string().min(1),
    maxMb: z.number().positive().default(10),
  }),

  // Translation Service
  translation: z.object({
    provider: z.string().optional(),
    apiKey: z.string().optional(),
    defaultLanguage: z.string().default('en'),
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
  }),

  // Text-to-Speech
  tts: z.object({
    provider: z.string().optional(),
    apiKey: z.string().optional(),
    enabled: z.boolean().default(false),
  }),

  // Nango Integration
  nango: z.object({
    secretKey: z.string().optional(),
    publicKey: z.string().optional(),
    host: z.string().url().default('https://api.nango.dev'),
  }),

  // Multi-supplier hotel inventory orchestration
  hotelSuppliers: z.custom<HotelSupplierEnvironment>(),

  // Feature Flags
  features: z.object({
    ttsEnabled: z.boolean().default(false),
    proactiveMessagingEnabled: z.boolean().default(false),
    vendorCmsEnabled: z.boolean().default(false),
  }),

  // Operational Settings
  operational: z.object({
    sessionTtlSeconds: z.number().int().positive().default(3600),
    toolRetryMaxAttempts: z.number().int().nonnegative().default(3),
    paymentTimeoutMinutes: z.number().int().positive().default(15),
    bookingHoldTimeoutMinutes: z.number().int().positive().default(10),
  }),
});

export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

// ============================================================================
// Configuration Loader
// ============================================================================

function loadEnvironmentConfig(): EnvironmentConfig {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',

    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
      webhookSecret: process.env.TWILIO_WEBHOOK_SECRET || '',
    },

    whatsapp: {
      provider:
        process.env.WHATSAPP_PROVIDER === 'openwa'
          ? 'openwa'
          : process.env.WHATSAPP_PROVIDER === 'meta'
            ? 'meta'
            : 'twilio',
    },

    openwa: {
      baseUrl: process.env.OPENWA_BASE_URL,
      apiKey: process.env.OPENWA_API_KEY,
      sessionId: process.env.OPENWA_SESSION_ID,
      webhookSecret: process.env.OPENWA_WEBHOOK_SECRET,
    },

    meta: {
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN,
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
      verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN,
      appSecret: process.env.META_WHATSAPP_APP_SECRET,
      apiVersion: process.env.META_WHATSAPP_API_VERSION || 'v20.0',
      mediaProxySecret: process.env.META_WHATSAPP_MEDIA_PROXY_SECRET,
    },

    postgres: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'yana_ogo',
      user: process.env.POSTGRES_USER || '',
      password: process.env.POSTGRES_PASSWORD || '',
    },

    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    },

    llm: {
      provider: process.env.LLM_PROVIDER || 'openai',
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || 'gpt-4',
      baseUrl: process.env.LLM_BASE_URL,
      confidenceThreshold: parseFloat(process.env.LLM_CONFIDENCE_THRESHOLD || '0.85'),
    },

    voice: {
      provider: process.env.TRANSCRIPTION_PROVIDER || process.env.LLM_PROVIDER || 'openai',
      apiKey:
        process.env.TRANSCRIPTION_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.LLM_API_KEY,
      baseUrl: process.env.TRANSCRIPTION_BASE_URL || process.env.LLM_BASE_URL,
      openAiApiKey: process.env.OPENAI_API_KEY,
      transcriptionModel:
        process.env.TRANSCRIPTION_MODEL ||
        process.env.OPENAI_TRANSCRIPTION_MODEL ||
        process.env.GROQ_TRANSCRIPTION_MODEL ||
        '',
      maxMb: parseFloat(process.env.VOICE_NOTE_MAX_MB || '10'),
    },

    translation: {
      provider: process.env.TRANSLATION_PROVIDER,
      apiKey: process.env.TRANSLATION_API_KEY,
      defaultLanguage: process.env.TRANSLATION_DEFAULT_LANGUAGE || 'en',
      confidenceThreshold: parseFloat(process.env.TRANSLATION_CONFIDENCE_THRESHOLD || '0.7'),
    },

    tts: {
      provider: process.env.TTS_PROVIDER,
      apiKey: process.env.TTS_API_KEY,
      enabled: process.env.TTS_ENABLED === 'true',
    },

    nango: {
      secretKey: process.env.NANGO_SECRET_KEY,
      publicKey: process.env.NANGO_PUBLIC_KEY,
      host: process.env.NANGO_HOST || 'https://api.nango.dev',
    },

    hotelSuppliers: loadHotelSupplierEnvironment(),

    features: {
      ttsEnabled: process.env.FEATURE_TTS_ENABLED === 'true',
      proactiveMessagingEnabled: process.env.FEATURE_PROACTIVE_MESSAGING_ENABLED === 'true',
      vendorCmsEnabled: process.env.FEATURE_VENDOR_CMS_ENABLED === 'true',
    },

    operational: {
      sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10),
      toolRetryMaxAttempts: parseInt(process.env.TOOL_RETRY_MAX_ATTEMPTS || '3', 10),
      paymentTimeoutMinutes: parseInt(process.env.PAYMENT_TIMEOUT_MINUTES || '15', 10),
      bookingHoldTimeoutMinutes: parseInt(process.env.BOOKING_HOLD_TIMEOUT_MINUTES || '10', 10),
    },
  };

  try {
    const parsed = EnvironmentSchema.parse(rawConfig);
    validateProviderConfig(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment configuration validation failed:');
      console.error(JSON.stringify(error.errors, null, 2));
      throw new Error('Invalid environment configuration');
    }
    throw error;
  }
}

function validateProviderConfig(config: EnvironmentConfig): void {
  if (isNonProductionMode) {
    return;
  }

  const errors: Array<{ path: string[]; message: string }> = [];

  if (config.whatsapp.provider === 'twilio') {
    if (!config.twilio.accountSid || config.twilio.accountSid === 'dev_account_sid') {
      errors.push({ path: ['twilio', 'accountSid'], message: 'TWILIO_ACCOUNT_SID is required when WHATSAPP_PROVIDER=twilio' });
    }
    if (!config.twilio.authToken || config.twilio.authToken === 'dev_auth_token') {
      errors.push({ path: ['twilio', 'authToken'], message: 'TWILIO_AUTH_TOKEN is required when WHATSAPP_PROVIDER=twilio' });
    }
    if (!config.twilio.whatsappNumber || config.twilio.whatsappNumber === '+1234567890') {
      errors.push({ path: ['twilio', 'whatsappNumber'], message: 'TWILIO_WHATSAPP_NUMBER is required when WHATSAPP_PROVIDER=twilio' });
    }
  }

  if (config.whatsapp.provider === 'openwa') {
    if (!config.openwa.baseUrl) {
      errors.push({ path: ['openwa', 'baseUrl'], message: 'OPENWA_BASE_URL is required when WHATSAPP_PROVIDER=openwa' });
    }
    if (!config.openwa.apiKey) {
      errors.push({ path: ['openwa', 'apiKey'], message: 'OPENWA_API_KEY is required when WHATSAPP_PROVIDER=openwa' });
    }
    if (!config.openwa.sessionId) {
      errors.push({ path: ['openwa', 'sessionId'], message: 'OPENWA_SESSION_ID is required when WHATSAPP_PROVIDER=openwa' });
    }
  }

  if (config.whatsapp.provider === 'meta') {
    if (!config.meta.accessToken) {
      errors.push({ path: ['meta', 'accessToken'], message: 'META_WHATSAPP_ACCESS_TOKEN is required when WHATSAPP_PROVIDER=meta' });
    }
    if (!config.meta.phoneNumberId) {
      errors.push({ path: ['meta', 'phoneNumberId'], message: 'META_WHATSAPP_PHONE_NUMBER_ID is required when WHATSAPP_PROVIDER=meta' });
    }
    if (!config.meta.verifyToken) {
      errors.push({ path: ['meta', 'verifyToken'], message: 'META_WHATSAPP_VERIFY_TOKEN is required when WHATSAPP_PROVIDER=meta' });
    }
  }

  if (errors.length > 0) {
    console.error('Environment provider configuration validation failed:');
    console.error(JSON.stringify(errors, null, 2));
    throw new Error('Invalid environment configuration');
  }
}

// ============================================================================
// Export Singleton Configuration
// ============================================================================

export const env = loadEnvironmentConfig();

// ============================================================================
// Helper Functions
// ============================================================================

export function isProduction(): boolean {
  return env.nodeEnv === 'production';
}

export function isDevelopment(): boolean {
  return env.nodeEnv === 'development';
}

export function isStaging(): boolean {
  return env.nodeEnv === 'staging';
}
