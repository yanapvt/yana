/**
 * Demo/Playground Routes
 * Manual testing endpoints for completed components
 */

import { Router, Request, Response } from 'express';
import { MCPInterface, ProviderAdapter } from '../services/MCPInterface.js';
import { ToolRegistry } from '../services/ToolRegistry.js';
import { SessionManager } from '../services/SessionManager.js';
import { SchemaEngine } from '../services/SchemaEngine.js';
import { CorrelationContext, ToolCallRequest } from '../types/core.js';

const router = Router();

// ============================================================================
// Mock Provider Adapter for Demo
// ============================================================================

class DemoHotelAdapter implements ProviderAdapter {
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    return {
      results: [
        {
          name: 'Galle Face Hotel',
          location: params.location || 'Galle',
          price: 150,
          currency: 'USD',
          rating: 4.5,
          reviewCount: 1250,
          amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa'],
          cancellationPolicy: 'Free cancellation up to 24 hours before check-in',
          bookingToken: 'demo_token_123',
        },
        {
          name: 'Jetwing Lighthouse',
          location: params.location || 'Galle',
          price: 200,
          currency: 'USD',
          rating: 4.8,
          reviewCount: 890,
          amenities: ['WiFi', 'Pool', 'Beach Access', 'Restaurant'],
          cancellationPolicy: 'Free cancellation up to 48 hours before check-in',
          bookingToken: 'demo_token_456',
        },
      ],
    };
  }

  getProviderName(): string {
    return 'demo_hotel_provider';
  }
}

// ============================================================================
// Initialize Services
// ============================================================================

const toolRegistry = new ToolRegistry();
const mcpInterface = new MCPInterface(toolRegistry);

// ⚠️ kept as-is (your current constructor mismatch workaround)
const sessionManager = new SessionManager(
  {} as any,
  {} as any,
  {} as any,
  {} as any
);

const schemaEngine = new SchemaEngine();

// Register demo hotel search tool
toolRegistry.registerTool({
  name: 'search_hotels',
  version: '1.0',
  description: 'Search for hotels by location and dates',
  parameters: {
    required: [
      { name: 'location', type: 'string', description: 'Hotel location' },
      { name: 'checkin_date', type: 'date', description: 'Check-in date' },
    ],
    optional: [
      { name: 'checkout_date', type: 'date', description: 'Check-out date' },
      { name: 'guests', type: 'number', description: 'Number of guests' },
    ],
  },
  providerMapping: {
    providerName: 'demo_hotels',
    adapterClass: 'DemoHotelAdapter',
  },
  executionPolicy: {
    retryCount: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
    idempotent: true,
  },
  permissions: {
    requiredRoles: [],
  },
  schemaBindings: {
    triggerSchemas: ['search_hotels'],
  },
});

mcpInterface.registerAdapter('DemoHotelAdapter', new DemoHotelAdapter());

// ============================================================================
// Demo Home Page
// ============================================================================

router.get('/', (req: Request, res: Response) => {
  res.send(`<html><body><h1>Demo Playground</h1></body></html>`);
});

// ============================================================================
// Status Endpoint
// ============================================================================

router.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'operational',
    components: {
      mcpInterface: { status: 'available' },
      toolRegistry: { status: 'available' },
      sessionManager: { status: 'available' },
      schemaEngine: { status: 'available' },
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Tool Call
// ============================================================================

router.post('/tool-call', async (req: Request, res: Response) => {
  try {
    const { tool, params } = req.body;

    const toolCallRequest: ToolCallRequest = {
      tool,
      params,
      context: {
        userLanguage: 'en',
        canonicalLanguage: 'en',
        sessionId: 'demo-' + Date.now(),
        requestId: 'req-' + Date.now(),
      },
    };

    const correlationCtx: CorrelationContext = {
      correlationId: 'corr-' + Date.now(),
      sessionId: toolCallRequest.context.sessionId,
      userId: 'demo-user',
      requestTimestamp: new Date(),
    };

    const result = await mcpInterface.executeToolCall(toolCallRequest, correlationCtx);

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error });
  }
});

// ============================================================================
// Session (fixed typing issues)
// ============================================================================

router.post('/session', async (req: Request, res: Response) => {
  try {
    const session = await sessionManager.createSession({
      phoneNumber: req.body.phoneNumber || '+94771234567',
      phoneHash: 'demo',
      preferredLanguage: 'en',
    });

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        phoneNumber: (session as any).phoneNumber,
        createdAt: (session as any).createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error });
  }
});

// ============================================================================
// FIXED Schema Validation (THIS WAS YOUR MAIN ERROR)
// ============================================================================

router.post('/schema-validation', async (req: Request, res: Response) => {
  try {
    const fields = req.body.fields;

    const schemaDefinition = {
      schemaName: 'search_hotels',
      name: 'search_hotels',
      version: '1.0',
      requiredFields: ['location', 'checkin_date'],
      optionalFields: ['checkout_date', 'guests'],
      fields: {
        location: {
          name: 'location',
          type: 'text' as const,
          ui: { promptKey: 'location', mode: 'text' as const },
          validation: { required: true },
        },
        checkin_date: {
          name: 'checkin_date',
          type: 'date' as const,
          ui: { promptKey: 'checkin_date', mode: 'text' as const },
          validation: { required: true },
        },
        checkout_date: {
          name: 'checkout_date',
          type: 'date' as const,
          ui: { promptKey: 'checkout_date', mode: 'text' as const },
          validation: { required: false },
        },
        guests: {
          name: 'guests',
          type: 'number' as const,
          ui: { promptKey: 'guests', mode: 'text' as const },
          validation: { required: false, min: 1, max: 10 },
        },
      },
    };

    const missingFields = schemaEngine.getMissingFields(schemaDefinition, fields);
    const isComplete = schemaEngine.isComplete(schemaDefinition, fields);
    const validationResult = schemaEngine.validateFields(schemaDefinition, fields);

    res.json({
      success: true,
      validation: {
        isComplete,
        missingFields,
        isValid: validationResult.valid,
        errors: validationResult.errors,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error });
  }
});

// ============================================================================
// Tools
// ============================================================================

router.get('/tools', async (req: Request, res: Response) => {
  const tools = await toolRegistry.listTools();
  res.json({ success: true, tools });
});

// ============================================================================
// Hotel Card Demo — sends a sample hotel card to a WhatsApp number
// POST /demo/hotel-card  { "to": "whatsapp:+94770677470" }
// ============================================================================

router.post('/hotel-card', async (req: Request, res: Response) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ success: false, error: 'Missing "to" field (e.g. whatsapp:+94770677470)' });
    }

    const { default: twilio } = await import('twilio');
    const { env } = await import('../config/environment.js');
    const { sendHotelCard, sendHotelList } = await import('../utils/hotelCard.js');

    const twilioClient = twilio(env.twilio.accountSid, env.twilio.authToken);
    const from = `whatsapp:${env.twilio.whatsappNumber}`;

    // Sample hotel results with all link types populated
    const sampleHotels = [
      {
        name: 'Galle Face Hotel',
        price: 150,
        currency: 'USD',
        rating: 4.5,
        reviewCount: 1250,
        location: 'Colombo, Sri Lanka',
        distance: 0.5,
        amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa', 'Beach Access'],
        cancellationPolicy: 'Free cancellation up to 24 hours before check-in',
        bookingToken: 'demo_gfh',
        photoUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
        bookingComUrl: 'https://www.booking.com/hotel/lk/galle-face.html',
        tripAdvisorUrl: 'https://www.tripadvisor.com/Hotel_Review-g304138-d301416-Reviews-Galle_Face_Hotel-Colombo_Western_Province.html',
        websiteUrl: 'https://www.gallefacehotel.com',
        googleMapsUrl: 'https://maps.google.com/?q=Galle+Face+Hotel+Colombo',
      },
      {
        name: 'Jetwing Lighthouse',
        price: 200,
        currency: 'USD',
        rating: 4.8,
        reviewCount: 890,
        location: 'Galle, Sri Lanka',
        distance: 1.2,
        amenities: ['WiFi', 'Pool', 'Beach Access', 'Restaurant', 'Bar'],
        cancellationPolicy: 'Free cancellation up to 48 hours before check-in',
        bookingToken: 'demo_jlh',
        photoUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80',
        bookingComUrl: 'https://www.booking.com/hotel/lk/jetwing-lighthouse.html',
        tripAdvisorUrl: 'https://www.tripadvisor.com/Hotel_Review-g297896-d301418-Reviews-Jetwing_Lighthouse-Galle_Southern_Province.html',
        websiteUrl: 'https://www.jetwinghotels.com/jetwingleighthouse',
        googleMapsUrl: 'https://maps.google.com/?q=Jetwing+Lighthouse+Galle',
      },
    ];

    // Send as a list first, then full card for the first result
    await sendHotelList(twilioClient as any, to, from, sampleHotels, 'Hotels near Galle 🏨');
    await sendHotelCard(twilioClient as any, to, from, sampleHotels[0]);

    res.json({ success: true, message: `Sent ${sampleHotels.length} hotel results + 1 full card to ${to}` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;