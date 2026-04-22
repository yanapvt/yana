/**
 * HumanHandoffRepository Tests
 * 
 * Tests for human handoff data access layer
 * 
 * Validates: Requirements 13.1, 13.5, 16.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HumanHandoffRepository } from './HumanHandoffRepository.js';
import { pool } from '../connection.js';

// Mock the database connection
vi.mock('../connection.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe('HumanHandoffRepository', () => {
  let repository: HumanHandoffRepository;

  beforeEach(() => {
    repository = new HumanHandoffRepository();
    vi.clearAllMocks();
  });

  describe('createHandoff', () => {
    it('should create a new human handoff record', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-123',
        session_id: 'session-123',
        user_id: 'user-123',
        correlation_id: 'corr-123',
        triggering_condition: 'low_confidence_translation',
        operator_id: null,
        session_summary: { reason: 'Low confidence' },
        status: 'pending',
        created_at: new Date(),
        assigned_at: null,
        resolved_at: null,
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.createHandoff({
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: { reason: 'Low confidence' },
      });

      expect(result).toEqual({
        handoffId: 'handoff-123',
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        operatorId: undefined,
        sessionSummary: { reason: 'Low confidence' },
        status: 'pending',
        createdAt: mockHandoff.created_at,
        assignedAt: undefined,
        resolvedAt: undefined,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO human_handoffs'),
        expect.arrayContaining([
          'session-123',
          'user-123',
          'corr-123',
          'low_confidence_translation',
          JSON.stringify({ reason: 'Low confidence' }),
          'pending',
        ])
      );
    });

    it('should create handoff with custom status', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-456',
        session_id: 'session-456',
        user_id: 'user-456',
        correlation_id: 'corr-456',
        triggering_condition: 'provider_failure',
        operator_id: null,
        session_summary: {},
        status: 'assigned',
        created_at: new Date(),
        assigned_at: null,
        resolved_at: null,
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.createHandoff({
        sessionId: 'session-456',
        userId: 'user-456',
        correlationId: 'corr-456',
        triggeringCondition: 'provider_failure',
        sessionSummary: {},
        status: 'assigned',
      });

      expect(result.status).toBe('assigned');
    });
  });

  describe('findById', () => {
    it('should find handoff by ID', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-123',
        session_id: 'session-123',
        user_id: 'user-123',
        correlation_id: 'corr-123',
        triggering_condition: 'low_confidence_translation',
        operator_id: 'operator-123',
        session_summary: { reason: 'Low confidence' },
        status: 'assigned',
        created_at: new Date(),
        assigned_at: new Date(),
        resolved_at: null,
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.findById('handoff-123');

      expect(result).toEqual({
        handoffId: 'handoff-123',
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        operatorId: 'operator-123',
        sessionSummary: { reason: 'Low confidence' },
        status: 'assigned',
        createdAt: mockHandoff.created_at,
        assignedAt: mockHandoff.assigned_at,
        resolvedAt: undefined,
      });
    });

    it('should return null if handoff not found', async () => {
      vi.mocked(pool.query).mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findBySessionId', () => {
    it('should find all handoffs for a session', async () => {
      const mockHandoffs = [
        {
          handoff_id: 'handoff-1',
          session_id: 'session-123',
          user_id: 'user-123',
          correlation_id: 'corr-1',
          triggering_condition: 'low_confidence_translation',
          operator_id: null,
          session_summary: {},
          status: 'pending',
          created_at: new Date(),
          assigned_at: null,
          resolved_at: null,
        },
        {
          handoff_id: 'handoff-2',
          session_id: 'session-123',
          user_id: 'user-123',
          correlation_id: 'corr-2',
          triggering_condition: 'provider_failure',
          operator_id: 'operator-123',
          session_summary: {},
          status: 'resolved',
          created_at: new Date(),
          assigned_at: new Date(),
          resolved_at: new Date(),
        },
      ];

      vi.mocked(pool.query).mockResolvedValue({
        rows: mockHandoffs,
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const result = await repository.findBySessionId('session-123');

      expect(result).toHaveLength(2);
      expect(result[0].handoffId).toBe('handoff-1');
      expect(result[1].handoffId).toBe('handoff-2');
    });
  });

  describe('findPending', () => {
    it('should find pending handoffs', async () => {
      const mockHandoffs = [
        {
          handoff_id: 'handoff-1',
          session_id: 'session-1',
          user_id: 'user-1',
          correlation_id: 'corr-1',
          triggering_condition: 'low_confidence_translation',
          operator_id: null,
          session_summary: {},
          status: 'pending',
          created_at: new Date(),
          assigned_at: null,
          resolved_at: null,
        },
      ];

      vi.mocked(pool.query).mockResolvedValue({
        rows: mockHandoffs,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.findPending();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });

    it('should respect limit parameter', async () => {
      vi.mocked(pool.query).mockResolvedValue({
        rows: [],
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      await repository.findPending(10);

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [10]
      );
    });
  });

  describe('assignToOperator', () => {
    it('should assign handoff to operator', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-123',
        session_id: 'session-123',
        user_id: 'user-123',
        correlation_id: 'corr-123',
        triggering_condition: 'low_confidence_translation',
        operator_id: 'operator-456',
        session_summary: {},
        status: 'assigned',
        created_at: new Date(),
        assigned_at: new Date(),
        resolved_at: null,
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.assignToOperator('handoff-123', 'operator-456');

      expect(result.operatorId).toBe('operator-456');
      expect(result.status).toBe('assigned');
      expect(result.assignedAt).toBeDefined();
    });

    it('should throw error if handoff not found', async () => {
      vi.mocked(pool.query).mockResolvedValue({
        rows: [],
        command: 'UPDATE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      await expect(
        repository.assignToOperator('nonexistent', 'operator-456')
      ).rejects.toThrow('Handoff nonexistent not found');
    });
  });

  describe('resolveHandoff', () => {
    it('should resolve handoff', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-123',
        session_id: 'session-123',
        user_id: 'user-123',
        correlation_id: 'corr-123',
        triggering_condition: 'low_confidence_translation',
        operator_id: 'operator-456',
        session_summary: {},
        status: 'resolved',
        created_at: new Date(),
        assigned_at: new Date(),
        resolved_at: new Date(),
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.resolveHandoff('handoff-123');

      expect(result.status).toBe('resolved');
      expect(result.resolvedAt).toBeDefined();
    });

    it('should throw error if handoff not found', async () => {
      vi.mocked(pool.query).mockResolvedValue({
        rows: [],
        command: 'UPDATE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      await expect(
        repository.resolveHandoff('nonexistent')
      ).rejects.toThrow('Handoff nonexistent not found');
    });
  });

  describe('cancelHandoff', () => {
    it('should cancel handoff', async () => {
      const mockHandoff = {
        handoff_id: 'handoff-123',
        session_id: 'session-123',
        user_id: 'user-123',
        correlation_id: 'corr-123',
        triggering_condition: 'low_confidence_translation',
        operator_id: null,
        session_summary: {},
        status: 'cancelled',
        created_at: new Date(),
        assigned_at: null,
        resolved_at: null,
      };

      vi.mocked(pool.query).mockResolvedValue({
        rows: [mockHandoff],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const result = await repository.cancelHandoff('handoff-123');

      expect(result.status).toBe('cancelled');
    });

    it('should throw error if handoff not found', async () => {
      vi.mocked(pool.query).mockResolvedValue({
        rows: [],
        command: 'UPDATE',
        rowCount: 0,
        oid: 0,
        fields: [],
      });

      await expect(
        repository.cancelHandoff('nonexistent')
      ).rejects.toThrow('Handoff nonexistent not found');
    });
  });
});
