/**
 * Unit tests for ToolRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, type ToolDefinition } from './ToolRegistry.js';
import { ToolRepository, type Tool } from '../db/repositories/ToolRepository.js';

// Mock ToolRepository
vi.mock('../db/repositories/ToolRepository.js', () => {
  return {
    ToolRepository: vi.fn().mockImplementation(() => {
      return {
        registerTool: vi.fn(),
        findByName: vi.fn(),
        findEnabled: vi.fn(),
        setEnabled: vi.fn(),
      };
    }),
  };
});

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry;
  let mockToolRepository: any;

  beforeEach(() => {
    mockToolRepository = new ToolRepository();
    toolRegistry = new ToolRegistry(mockToolRepository);
  });

  describe('registerTool', () => {
    it('should register a valid tool definition', async () => {
      const toolDefinition: ToolDefinition = {
        name: 'search_hotels',
        version: '1.0',
        description: 'Search for hotels by location and date',
        parameters: {
          required: [
            {
              name: 'location',
              type: 'string',
              description: 'Hotel location',
            },
            {
              name: 'checkin_date',
              type: 'date',
              description: 'Check-in date',
            },
          ],
          optional: [
            {
              name: 'checkout_date',
              type: 'date',
              description: 'Check-out date',
            },
          ],
        },
        providerMapping: {
          providerName: 'booking_com',
          adapterClass: 'HotelSearchAdapter',
          endpoint: '/hotels/search',
          method: 'POST',
        },
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
          timeoutMs: 30000,
        },
        schemaBindings: {
          triggerSchemas: ['search_hotels'],
        },
      };

      mockToolRepository.registerTool.mockResolvedValue({
        toolId: 'tool-123',
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
        executionPolicy: {},
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('search_hotels');
      expect(mockToolRepository.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'search_hotels',
          toolVersion: '1.0',
        })
      );
    });

    it('should reject tool definition with missing name', async () => {
      const toolDefinition: ToolDefinition = {
        name: '',
        version: '1.0',
        description: 'Test tool',
        parameters: {
          required: [],
          optional: [],
        },
        providerMapping: {
          providerName: 'test_provider',
          adapterClass: 'TestAdapter',
        },
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
        },
      };

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool name is required');
      expect(mockToolRepository.registerTool).not.toHaveBeenCalled();
    });

    it('should reject tool definition with missing version', async () => {
      const toolDefinition: ToolDefinition = {
        name: 'test_tool',
        version: '',
        description: 'Test tool',
        parameters: {
          required: [],
          optional: [],
        },
        providerMapping: {
          providerName: 'test_provider',
          adapterClass: 'TestAdapter',
        },
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
        },
      };

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Tool version is required');
    });

    it('should reject tool definition with missing provider mapping', async () => {
      const toolDefinition: ToolDefinition = {
        name: 'test_tool',
        version: '1.0',
        description: 'Test tool',
        parameters: {
          required: [],
          optional: [],
        },
        providerMapping: null as any,
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
        },
      };

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Provider mapping is required');
    });

    it('should reject tool definition with invalid execution policy', async () => {
      const toolDefinition: ToolDefinition = {
        name: 'test_tool',
        version: '1.0',
        description: 'Test tool',
        parameters: {
          required: [],
          optional: [],
        },
        providerMapping: {
          providerName: 'test_provider',
          adapterClass: 'TestAdapter',
        },
        executionPolicy: {
          retryCount: 'invalid' as any,
          retryDelayMs: 1000,
          idempotent: true,
        },
      };

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Execution policy retryCount must be a number');
    });

    it('should update existing tool when registering with same name', async () => {
      const toolDefinition: ToolDefinition = {
        name: 'existing_tool',
        version: '2.0',
        description: 'Updated tool',
        parameters: {
          required: [],
          optional: [],
        },
        providerMapping: {
          providerName: 'test_provider',
          adapterClass: 'TestAdapter',
        },
        executionPolicy: {
          retryCount: 5,
          retryDelayMs: 2000,
          idempotent: true,
        },
      };

      mockToolRepository.registerTool.mockResolvedValue({
        toolId: 'tool-123',
        toolName: 'existing_tool',
        toolVersion: '2.0',
        contract: {},
        executionPolicy: {},
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await toolRegistry.registerTool(toolDefinition);

      expect(result.success).toBe(true);
      expect(mockToolRepository.registerTool).toHaveBeenCalled();
    });
  });

  describe('getTool', () => {
    it('should retrieve a tool by name', async () => {
      const mockTool: Tool = {
        toolId: 'tool-123',
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {
          name: 'search_hotels',
          version: '1.0',
          description: 'Search for hotels',
          parameters: {
            required: [
              {
                name: 'location',
                type: 'string',
                description: 'Hotel location',
              },
            ],
            optional: [],
          },
          providerMapping: {
            providerName: 'booking_com',
            adapterClass: 'HotelSearchAdapter',
          },
        },
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
        },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockToolRepository.findByName.mockResolvedValue(mockTool);

      const result = await toolRegistry.getTool('search_hotels');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('search_hotels');
      expect(result?.version).toBe('1.0');
      expect(result?.description).toBe('Search for hotels');
      expect(mockToolRepository.findByName).toHaveBeenCalledWith('search_hotels');
    });

    it('should return null for non-existent tool', async () => {
      mockToolRepository.findByName.mockResolvedValue(null);

      const result = await toolRegistry.getTool('non_existent_tool');

      expect(result).toBeNull();
    });
  });

  describe('listTools', () => {
    it('should list all enabled tools', async () => {
      const mockTools: Tool[] = [
        {
          toolId: 'tool-1',
          toolName: 'search_hotels',
          toolVersion: '1.0',
          contract: {
            name: 'search_hotels',
            version: '1.0',
            description: 'Search for hotels',
            parameters: { required: [], optional: [] },
            providerMapping: {
              providerName: 'booking_com',
              adapterClass: 'HotelSearchAdapter',
            },
          },
          executionPolicy: {
            retryCount: 3,
            retryDelayMs: 1000,
            idempotent: true,
          },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          toolId: 'tool-2',
          toolName: 'book_hotel',
          toolVersion: '1.0',
          contract: {
            name: 'book_hotel',
            version: '1.0',
            description: 'Book a hotel',
            parameters: { required: [], optional: [] },
            providerMapping: {
              providerName: 'booking_com',
              adapterClass: 'HotelBookingAdapter',
            },
          },
          executionPolicy: {
            retryCount: 3,
            retryDelayMs: 1000,
            idempotent: true,
          },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockToolRepository.findEnabled.mockResolvedValue(mockTools);

      const result = await toolRegistry.listTools();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('search_hotels');
      expect(result[1].name).toBe('book_hotel');
    });

    it('should return empty array when no tools are registered', async () => {
      mockToolRepository.findEnabled.mockResolvedValue([]);

      const result = await toolRegistry.listTools();

      expect(result).toHaveLength(0);
    });
  });

  describe('setToolEnabled', () => {
    it('should enable a tool', async () => {
      mockToolRepository.setEnabled.mockResolvedValue(undefined);

      await toolRegistry.setToolEnabled('search_hotels', true);

      expect(mockToolRepository.setEnabled).toHaveBeenCalledWith('search_hotels', true);
    });

    it('should disable a tool', async () => {
      mockToolRepository.setEnabled.mockResolvedValue(undefined);

      await toolRegistry.setToolEnabled('search_hotels', false);

      expect(mockToolRepository.setEnabled).toHaveBeenCalledWith('search_hotels', false);
    });
  });

  describe('isToolAvailable', () => {
    it('should return true for enabled tool', async () => {
      mockToolRepository.findByName.mockResolvedValue({
        toolId: 'tool-123',
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
        executionPolicy: {},
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await toolRegistry.isToolAvailable('search_hotels');

      expect(result).toBe(true);
    });

    it('should return false for disabled tool', async () => {
      mockToolRepository.findByName.mockResolvedValue({
        toolId: 'tool-123',
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
        executionPolicy: {},
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await toolRegistry.isToolAvailable('search_hotels');

      expect(result).toBe(false);
    });

    it('should return false for non-existent tool', async () => {
      mockToolRepository.findByName.mockResolvedValue(null);

      const result = await toolRegistry.isToolAvailable('non_existent_tool');

      expect(result).toBe(false);
    });
  });

  describe('getExecutionPolicy', () => {
    it('should return execution policy for a tool', async () => {
      mockToolRepository.findByName.mockResolvedValue({
        toolId: 'tool-123',
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
        executionPolicy: {
          retryCount: 3,
          retryDelayMs: 1000,
          idempotent: true,
          timeoutMs: 30000,
        },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await toolRegistry.getExecutionPolicy('search_hotels');

      expect(result).not.toBeNull();
      expect(result?.retryCount).toBe(3);
      expect(result?.retryDelayMs).toBe(1000);
      expect(result?.idempotent).toBe(true);
      expect(result?.timeoutMs).toBe(30000);
    });

    it('should return null for non-existent tool', async () => {
      mockToolRepository.findByName.mockResolvedValue(null);

      const result = await toolRegistry.getExecutionPolicy('non_existent_tool');

      expect(result).toBeNull();
    });
  });

  describe('getToolsForSchema', () => {
    it('should return tools bound to a specific schema', async () => {
      const mockTools: Tool[] = [
        {
          toolId: 'tool-1',
          toolName: 'search_hotels',
          toolVersion: '1.0',
          contract: {
            name: 'search_hotels',
            version: '1.0',
            description: 'Search for hotels',
            parameters: { required: [], optional: [] },
            providerMapping: {
              providerName: 'booking_com',
              adapterClass: 'HotelSearchAdapter',
            },
            schemaBindings: {
              triggerSchemas: ['search_hotels', 'hotel_booking'],
            },
          },
          executionPolicy: {
            retryCount: 3,
            retryDelayMs: 1000,
            idempotent: true,
          },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          toolId: 'tool-2',
          toolName: 'search_flights',
          toolVersion: '1.0',
          contract: {
            name: 'search_flights',
            version: '1.0',
            description: 'Search for flights',
            parameters: { required: [], optional: [] },
            providerMapping: {
              providerName: 'flight_provider',
              adapterClass: 'FlightSearchAdapter',
            },
            schemaBindings: {
              triggerSchemas: ['search_flights'],
            },
          },
          executionPolicy: {
            retryCount: 3,
            retryDelayMs: 1000,
            idempotent: true,
          },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockToolRepository.findEnabled.mockResolvedValue(mockTools);

      const result = await toolRegistry.getToolsForSchema('search_hotels');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('search_hotels');
    });

    it('should return empty array when no tools match schema', async () => {
      const mockTools: Tool[] = [
        {
          toolId: 'tool-1',
          toolName: 'search_hotels',
          toolVersion: '1.0',
          contract: {
            name: 'search_hotels',
            version: '1.0',
            description: 'Search for hotels',
            parameters: { required: [], optional: [] },
            providerMapping: {
              providerName: 'booking_com',
              adapterClass: 'HotelSearchAdapter',
            },
            schemaBindings: {
              triggerSchemas: ['search_hotels'],
            },
          },
          executionPolicy: {
            retryCount: 3,
            retryDelayMs: 1000,
            idempotent: true,
          },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockToolRepository.findEnabled.mockResolvedValue(mockTools);

      const result = await toolRegistry.getToolsForSchema('non_existent_schema');

      expect(result).toHaveLength(0);
    });
  });
});
