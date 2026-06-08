import { describe, expect, it, vi } from 'vitest';
import { ErrorCategory, type ToolCallResult } from '../types/core.js';
import type { MCPInterface } from './MCPInterface.js';
import { HotelSearchFlowService } from './HotelSearchFlowService.js';
import type { ToolRegistry } from './ToolRegistry.js';

const completeCriteria = {
  location: 'Galle',
  checkinDate: '2026-06-12',
  checkoutDate: '2026-06-15',
  guests: 2,
  boardBasis: 'bnb' as const,
  budgetPerNight: {
    amount: 120,
    currency: 'USD',
  },
};

describe('HotelSearchFlowService', () => {
  it('returns provider-not-connected response when provider execution is disabled', async () => {
    const toolRegistry = {
      isToolAvailable: vi.fn().mockResolvedValue(false),
      registerTool: vi.fn(),
    } as unknown as ToolRegistry;
    const mcpInterface = {
      executeToolCall: vi.fn(),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry,
      mcpInterface,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(false),
        searchHotels: vi.fn(),
      } as any,
      providerConfigured: false,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('provider_not_connected');
    expect(result.reply).toContain('location Galle');
    expect(result.reply).toContain('live property browsing is not configured');
    expect(mcpInterface.executeToolCall).not.toHaveBeenCalled();
  });

  it('returns top browse links from Google Places when booking provider is disabled but browse search is configured', async () => {
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchHotels: vi.fn().mockResolvedValue({
        provider: 'google_places',
        results: [
          {
            name: 'Colombo Court Hotel',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.3,
            reviewCount: 800,
            priceRange: '$$$',
            googleMapsUri: 'https://maps.google.com/?cid=1',
            thumbnailUrl: 'https://forms.yana.example/media/google-place-photo?name=places%2F1',
          },
          {
            name: 'Hotel MaRadha Colombo',
            address: 'Marine Drive, Colombo',
            rating: 4.4,
            reviewCount: 600,
            googleMapsUri: 'https://maps.google.com/?cid=2',
          },
          {
            name: 'Mandarina Colombo',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.2,
            reviewCount: 1200,
            googleMapsUri: 'https://maps.google.com/?cid=3',
          },
          {
            name: 'Fourth Colombo Hotel',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.1,
            reviewCount: 300,
            googleMapsUri: 'https://maps.google.com/?cid=4',
          },
        ],
      }),
    };

    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn().mockResolvedValue(false),
      } as unknown as ToolRegistry,
      mcpInterface: {
        executeToolCall: vi.fn(),
      } as unknown as MCPInterface,
      browsingService: browsingService as any,
      providerConfigured: false,
    });

    const result = await service.handleCompletedIntake(
      {
        ...completeCriteria,
        location: 'Colombo 03',
        budgetPerNight: {
          amount: 50,
          currency: 'USD',
        },
      },
      { correlationId: 'corr-browse' }
    );

    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('Colombo Court Hotel');
    expect(result.reply).not.toContain('https://maps.google.com/?cid=1');
    expect(result.reply).toContain('Reply "next"');
    expect(result.reply).not.toContain('Thumbnail:');
    expect(result.browseResponse?.results[0].googleMapsUri).toBe('https://maps.google.com/?cid=1');
    expect(result.browseResponse?.results[0].thumbnailUrl).toBe(
      'https://forms.yana.example/media/google-place-photo?name=places%2F1'
    );
    expect(result.browseResponse?.results).toHaveLength(4);
  });

  it('validates completed criteria before provider execution', async () => {
    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn(),
      } as unknown as ToolRegistry,
      mcpInterface: {
        executeToolCall: vi.fn(),
      } as unknown as MCPInterface,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(
      {
        ...completeCriteria,
        checkinDate: 'tomorrow',
      },
      { correlationId: 'corr-2' }
    );

    expect(result.status).toBe('validation_failed');
    expect(result.reply).toContain('valid check-in date');
  });

  it('executes search_hotels and renders hotel results when provider is connected', async () => {
    const toolRegistry = {
      isToolAvailable: vi.fn().mockResolvedValue(true),
      registerTool: vi.fn(),
    } as unknown as ToolRegistry;
    const successResult: ToolCallResult = {
      success: true,
      data: {
        results: [
          {
            name: 'Galle Face Hotel',
            price: 150,
            currency: 'USD',
            rating: 4.5,
            reviewCount: 1200,
            location: 'Galle',
            distance: 1.2,
            amenities: ['WiFi', 'Pool'],
            cancellationPolicy: 'Free cancellation',
            bookingToken: 'hotel-token-1',
          },
        ],
        totalResults: 1,
      },
      metadata: {
        toolName: 'search_hotels',
        executionTimeMs: 12,
        attemptNumber: 1,
        provider: 'mock_hotels',
        timestamp: new Date(),
      },
    };
    const mcpInterface = {
      executeToolCall: vi.fn().mockResolvedValue(successResult),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry,
      mcpInterface,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-3',
      sessionId: 'session-3',
      userId: 'user-3',
      userLanguage: 'en',
    });

    expect(result.status).toBe('success');
    expect(mcpInterface.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'search_hotels',
        params: expect.objectContaining({
          location: 'Galle',
          checkin_date: '2026-06-12',
          checkout_date: '2026-06-15',
          guests: 2,
          budget: 120,
          currency: 'USD',
        }),
      }),
      expect.objectContaining({
        correlationId: 'corr-3',
        sessionId: 'session-3',
        userId: 'user-3',
      })
    );
    expect(result.reply).toContain('Found 1 hotel for Galle');
    expect(result.reply).toContain('Galle Face Hotel');
    expect(result.renderedMessage?.messages[0]?.type).toBe('list');
  });

  it('returns deterministic provider failure copy on tool failure', async () => {
    const mcpInterface = {
      executeToolCall: vi.fn().mockResolvedValue({
        success: false,
        error: {
          category: ErrorCategory.PROVIDER_FAILURE,
          message: 'Provider timeout',
          retryable: false,
        },
        metadata: {
          toolName: 'search_hotels',
          executionTimeMs: 1,
          attemptNumber: 1,
          timestamp: new Date(),
        },
      } satisfies ToolCallResult),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn().mockResolvedValue(true),
      } as unknown as ToolRegistry,
      mcpInterface,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-4',
    });

    expect(result.status).toBe('provider_failed');
    expect(result.reply).toContain('hotel provider failed');
  });
});
