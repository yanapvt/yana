/**
 * Express Application Setup
 * Configures the Express server with middleware and routes
 */

import express, { Express } from 'express';
import webhookRoutes from './routes/webhook.js';
import demoRouter from './routes/demo.js';
import formsRouter from './routes/forms.js';
import mediaRouter from './routes/media.js';

/**
 * Creates and configures the Express application
 */
export function createApp(): Express {
  const app = express();

  // Parse URL-encoded bodies (Twilio sends form-encoded data)
  app.use(express.urlencoded({ extended: true }));

  // Parse JSON bodies
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount webhook routes
  app.use('/', webhookRoutes);

  // Mount secure external collection forms
  app.use('/', formsRouter);

  // Mount safe media proxy routes
  app.use('/', mediaRouter);

  // Mount demo/playground routes
  app.use('/demo', demoRouter);

  // Root redirect to demo
  app.get('/', (req, res) => {
    res.redirect('/demo');
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
