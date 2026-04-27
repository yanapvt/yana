/**
 * Environment configuration loader
 * Reads from .env files and validates required configuration
 */

import { config } from 'dotenv';
import { z } from 'zod';

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
    accountSid: isNonProductionMode ? z.string().default('dev_account_sid') : z.string().min(1),
    authToken: isNonProductionMode ? z.string().default('dev_auth_token') : z.string().min(1),
    whatsappNumber: isNonProductionMode ? z.string().default('+1234567890') : z.string().min(1),
    webhookSecret: isNonProductionMode ? z.string().default('dev_webhook_secret') : z.string().min(1),
  }),

  // Database (optional in development/test)
  postgres: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    user: isNonProductionMode ? z.string().default('dev_user') : z.string().min(1),
    password: isNonProductionMode ? z.string().default('dev_password') : z.string().min(1),
  }),

  // Redis (optional in development/test)
  redis: z.object({
    enabled: z.boolean().default(true),
    host: isNonProductionMode ? z.string().default('localhost') : z.string().min(1),
    port: z.number().int().positive(),
    password: z.string().optional(),
    db: z.number().int().nonnegative().default(0),
  }),

  // LLM Provider (optional in development/test)
  llm: z.object({
    provider: z.string().min(1),
    apiKey: isNonProductionMode ? z.string().default('dev_api_key') : z.string().min(1),
    model: z.string().min(1),
    confidenceThreshold: z.number().min(0).max(1).default(0.85),
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

  // ── External Provider API Keys ──────────────────────────────────────────
  providers: z.object({
    // Google — free tier, used across hotels, restaurants, excursions, logistics
    googlePlacesApiKey: z.string().optional(),

    // Hotels
    literapiKey: z.string().optional(),       // liteapi.travel — hotel rates + inventory
    cloudbedsKey: z.string().optional(),      // cloudbeds.com  — PMS / boutique hotels
    bookingAffiliateToken: z.string().optional(), // Booking.com affiliate
    expediaApiKey: z.string().optional(),     // Expedia affiliate

    // Excursions
    viatorApiKey: z.string().optional(),      // viator.com — tours & activities
    guidegeekApiKey: z.string().optional(),   // guidegeek.com — AI travel guide

    // Logistics — deeplinks only, no key needed; kept for future direct API
    uberClientId: z.string().optional(),
    pickmeApiKey: z.string().optional(),

    // Restaurants — internal merchant onboarding + Genie
    genieMerchantApiKey: z.string().optional(),
    genieMerchantBaseUrl: z.string().optional(),

    // Margin config (percentage added on top of provider price)
    hotelMarginPercent: z.number().min(0).max(100).default(10),
  }),

  // Feature Flags
  features: z.object({
    ttsEnabled: z.boolean().default(false),
    proactiveMessagingEnabled: z.boolean().default(false),
    vendorCmsEnabled: z.boolean().default(false),
    /** When false, short-circuit rules (greetings, thanks, bye, etc.) are disabled and all messages go to the LLM */
    shortCircuitEnabled: z.boolean().default(true),
    /** When false, pre-defined welcome/greeting messages are disabled */
    predefinedMessagesEnabled: z.boolean().default(true),
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

    postgres: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'yana_ogo',
      user: process.env.POSTGRES_USER || '',
      password: process.env.POSTGRES_PASSWORD || '',
    },

    redis: {
      enabled: process.env.REDIS_ENABLED !== 'false',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    },

    llm: {
      provider: process.env.LLM_PROVIDER || 'openai',
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || 'gpt-4',
      confidenceThreshold: parseFloat(process.env.LLM_CONFIDENCE_THRESHOLD || '0.85'),
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

    providers: {
      googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY,
      literapiKey: process.env.LITEAPI_KEY,
      cloudbedsKey: process.env.CLOUDBEDS_KEY,
      bookingAffiliateToken: process.env.BOOKING_AFFILIATE_TOKEN,
      expediaApiKey: process.env.EXPEDIA_API_KEY,
      viatorApiKey: process.env.VIATOR_API_KEY,
      guidegeekApiKey: process.env.GUIDEGEEK_API_KEY,
      uberClientId: process.env.UBER_CLIENT_ID,
      pickmeApiKey: process.env.PICKME_API_KEY,
      genieMerchantApiKey: process.env.GENIE_MERCHANT_API_KEY,
      genieMerchantBaseUrl: process.env.GENIE_MERCHANT_BASE_URL,
      hotelMarginPercent: parseFloat(process.env.HOTEL_MARGIN_PERCENT || '10'),
    },

    features: {
      ttsEnabled: process.env.FEATURE_TTS_ENABLED === 'true',
      proactiveMessagingEnabled: process.env.FEATURE_PROACTIVE_MESSAGING_ENABLED === 'true',
      vendorCmsEnabled: process.env.FEATURE_VENDOR_CMS_ENABLED === 'true',
      shortCircuitEnabled: process.env.FEATURE_SHORT_CIRCUIT_ENABLED !== 'false',
      predefinedMessagesEnabled: process.env.FEATURE_PREDEFINED_MESSAGES_ENABLED !== 'false',
    },

    operational: {
      sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10),
      toolRetryMaxAttempts: parseInt(process.env.TOOL_RETRY_MAX_ATTEMPTS || '3', 10),
      paymentTimeoutMinutes: parseInt(process.env.PAYMENT_TIMEOUT_MINUTES || '15', 10),
      bookingHoldTimeoutMinutes: parseInt(process.env.BOOKING_HOLD_TIMEOUT_MINUTES || '10', 10),
    },
  };

  try {
    return EnvironmentSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment configuration validation failed:');
      console.error(JSON.stringify(error.errors, null, 2));
      throw new Error('Invalid environment configuration');
    }
    throw error;
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
