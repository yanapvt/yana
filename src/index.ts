/**
 * YANA / OGO Platform Entry Point
 */

import { env, isDevelopment } from './config/environment.js';
import { createApp } from './app.js';

console.log('YANA / OGO Platform starting...');
console.log(`Environment: ${env.nodeEnv}`);
console.log(`Development mode: ${isDevelopment()}`);

// Create Express application
const app = createApp();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: POST http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`Health check: GET http://localhost:${PORT}/health`);
});

// TODO: Initialize additional platform components
// - Session Manager
// - Orchestrator
// - MCP Interface
// - Provider Adapters
// - WhatsApp Renderer

export { env, app };
