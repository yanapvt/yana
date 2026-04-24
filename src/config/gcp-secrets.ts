/**
 * Google Cloud Secret Manager integration
 * Loads secrets from GCP Secret Manager at runtime
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export interface GCPSecrets {
  database: {
    password: string;
  };
  twilio: {
    authToken: string;
    webhookSecret: string;
  };
  llm: {
    apiKey: string;
  };
  payment: {
    stripeApiKey: string;
    stripeWebhookSecret: string;
  };
  jwt: {
    secret: string;
  };
  nango: {
    secretKey: string;
  };
}

/**
 * Load secrets from Google Cloud Secret Manager
 */
export async function loadGCPSecrets(): Promise<GCPSecrets> {
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GCP_PROJECT_ID;

  if (!projectId) {
    throw new Error('GCP_PROJECT_ID environment variable is required');
  }

  async function accessSecret(secretName: string): Promise<string> {
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    try {
      const [version] = await client.accessSecretVersion({ name });
      const payload = version.payload?.data?.toString();
      if (!payload) {
        throw new Error(`Secret ${secretName} has no payload`);
      }
      return payload;
    } catch (error) {
      console.error(`Failed to access secret ${secretName}:`, error);
      throw error;
    }
  }

  // Load all secrets in parallel
  const [
    postgresPassword,
    twilioAuthToken,
    twilioWebhookSecret,
    llmApiKey,
    stripeApiKey,
    stripeWebhookSecret,
    jwtSecret,
    nangoSecretKey,
  ] = await Promise.all([
    accessSecret('postgres-password'),
    accessSecret('twilio-auth-token'),
    accessSecret('twilio-webhook-secret'),
    accessSecret('llm-api-key'),
    accessSecret('stripe-api-key'),
    accessSecret('stripe-webhook-secret'),
    accessSecret('jwt-secret'),
    accessSecret('nango-secret-key'),
  ]);

  return {
    database: {
      password: postgresPassword,
    },
    twilio: {
      authToken: twilioAuthToken,
      webhookSecret: twilioWebhookSecret,
    },
    llm: {
      apiKey: llmApiKey,
    },
    payment: {
      stripeApiKey,
      stripeWebhookSecret,
    },
    jwt: {
      secret: jwtSecret,
    },
    nango: {
      secretKey: nangoSecretKey,
    },
  };
}

/**
 * Check if running on Google Cloud Platform
 */
export function isRunningOnGCP(): boolean {
  return !!(
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.K_SERVICE || // Cloud Run
    process.env.GAE_SERVICE // App Engine
  );
}

/**
 * Get GCP project ID
 */
export function getGCPProjectId(): string | undefined {
  return (
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT
  );
}

/**
 * Get GCP region
 */
export function getGCPRegion(): string {
  return process.env.GCP_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
}
