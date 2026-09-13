/**
 * Express Application Setup
 * Configures the Express server with middleware and routes
 */

import express, { Express } from 'express';
import webhookRoutes from './routes/webhook.js';
import openWaWebhookRoutes from './routes/openWaWebhook.js';
import metaWhatsAppWebhookRoutes from './routes/metaWhatsAppWebhook.js';
import demoRouter from './routes/demo.js';
import formsRouter from './routes/forms.js';
import mediaRouter from './routes/media.js';
import itineraryWorkspaceRouter from './routes/itineraryWorkspace.js';
import legalRouter from './routes/legal.js';
import hotelSearchAdminRouter from './routes/hotelSearchAdmin.js';
import humanHandoffAdminRouter from './routes/humanHandoffAdmin.js';
import operatorDashboardRouter from './routes/operatorDashboard.js';

/**
 * Creates and configures the Express application
 */
export function createApp(): Express {
  const app = express();
  const captureRawBody = (
    req: express.Request & { rawBody?: Buffer },
    _res: express.Response,
    buf: Buffer
  ) => {
    req.rawBody = Buffer.from(buf);
  };

  // Parse URL-encoded bodies (Twilio sends form-encoded data)
  app.use(express.urlencoded({ extended: true, verify: captureRawBody }));

  // Parse JSON bodies
  app.use(express.json({ verify: captureRawBody }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount webhook routes
  app.use('/', webhookRoutes);
  app.use('/', openWaWebhookRoutes);
  app.use('/', metaWhatsAppWebhookRoutes);

  // Mount secure external collection forms
  app.use('/', formsRouter);

  // Mount safe media proxy routes
  app.use('/', mediaRouter);

  // Mount interactive itinerary workspace routes
  app.use('/', itineraryWorkspaceRouter);

  // Mount public legal pages required by platform providers
  app.use('/', legalRouter);

  // Protected operational controls (disabled unless ADMIN_CONTROL_TOKEN is set).
  app.use('/', hotelSearchAdminRouter);
  app.use('/', humanHandoffAdminRouter);
  app.use('/', operatorDashboardRouter);

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
