/**
 * Express Application Setup
 * Configures the Express server with middleware and routes
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import webhookRoutes from './routes/webhook.js';
import demoRouter from './routes/demo.js';
import { logger } from './config/logger.js';

/**
 * Creates and configures the Express application
 */
export function createApp(): Express {
  const app = express();

  logger.debug('App', 'Creating Express application');

  // Parse URL-encoded bodies (Twilio sends form-encoded data)
  app.use(express.urlencoded({ extended: true }));

  // Parse JSON bodies
  app.use(express.json());

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.headers['x-correlation-id'] as string || 'unknown';
    logger.debug('HTTP', `Incoming ${req.method}`, {
      correlationId,
      method: req.method,
      path: req.path,
      contentType: req.headers['content-type'],
    });
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
    logger.debug('Health', 'Health check requested', healthStatus);
    res.status(200).json(healthStatus);
  });

  // Mount webhook routes
  app.use('/', webhookRoutes);

  // Mount demo/playground routes
  app.use('/demo', demoRouter);

  // Root redirect to demo
  app.get('/', (req, res) => {
    logger.debug('App', 'Root path redirecting to /demo');
    res.redirect('/demo');
  });

  // 404 handler
  app.use((req, res) => {
    logger.warn('HTTP', 'Not found', { method: req.method, path: req.path });
    res.status(404).json({ error: 'Not found' });
  });

  // Error handling middleware
  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.headers['x-correlation-id'] as string || 'unknown';
    logger.error('App', 'Unhandled error', {
      correlationId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Internal server error' });
  });

  logger.info('App', 'Express application configured successfully');
  return app;
}
