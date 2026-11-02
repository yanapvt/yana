/**
 * YANA / OGO Platform Entry Point
 */

import { env, isDevelopment } from './config/environment.js';
import { createApp } from './app.js';
import { getHumanHandoffRuntime } from './services/handoff/HumanHandoffRuntime.js';
import { getUnfinishedWorkflowReminderService } from './services/UnfinishedWorkflowReminderService.js';

console.log('YANA / OGO Platform starting...');
console.log(`Environment: ${env.nodeEnv}`);
console.log(`Development mode: ${isDevelopment()}`);

// Create Express application
const app = createApp();

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: POST http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`Health check: GET http://localhost:${PORT}/health`);
});

const humanHandoffRuntime = getHumanHandoffRuntime();
humanHandoffRuntime.start();
const reminderTimer = env.features.proactiveMessagingEnabled && env.whatsapp.provider === 'openwa'
  ? setInterval(() => {
      getUnfinishedWorkflowReminderService().processOne().catch(() => undefined);
    }, 60_000)
  : null;
reminderTimer?.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    humanHandoffRuntime.stop();
    if (reminderTimer) clearInterval(reminderTimer);
    server.close();
  });
}

// TODO: Initialize additional platform components
// - Session Manager
// - Orchestrator
// - MCP Interface
// - Provider Adapters
// - WhatsApp Renderer

export { env, app };
