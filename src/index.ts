/**
 * YANA / OGO Platform Entry Point
 */

import { env, isDevelopment } from './config/environment.js';
import { createApp } from './app.js';
import { logger } from './config/logger.js';

logger.info('Platform', 'YANA / OGO Platform starting...');
logger.info('Platform', 'Initializing environment', {
  environment: env.nodeEnv,
  isDevelopment: isDevelopment(),
  logEnabled: process.env.LOG_ENABLED !== 'false',
  logLevel: process.env.LOG_LEVEL || 'debug (dev) or info (prod)',
});

// Create Express application
const app = createApp();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('Platform', 'Server started', { port: PORT });
  logger.debug('Platform', 'Available endpoints', {
    health: `GET http://localhost:${PORT}/health`,
    webhook: `POST http://localhost:${PORT}/webhook/whatsapp`,
    demo: `http://localhost:${PORT}/demo`,
  });
});

// TODO: Initialize additional platform components
// - Session Manager
// - Orchestrator
// - MCP Interface
// - Provider Adapters
// - WhatsApp Renderer

export { env, app };
