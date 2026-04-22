/**
 * MessageRepository - Data access layer for message entities
 * Handles messages and message_translations
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface Message {
  messageId: string;
  sessionId: string;
  userId: string;
  correlationId: string;
  fromNumber: string;
  toNumber: string;
  messageType: string;
  role: 'user' | 'assistant' | 'system';
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface MessageTranslation {
  translationId: string;
  messageId: string;
  originalText: string;
  detectedLanguage: string;
  translatedText: string;
  canonicalForm: string;
  translationConfidence?: number;
  translatorMetadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// MessageRepository Class
// ============================================================================

export class MessageRepository {
  /**
   * Create a new message
   * Idempotent: Uses correlation_id to prevent duplicate message creation
   */
  async createMessage(data: {
    sessionId: string;
    userId: string;
    correlationId: string;
    fromNumber: string;
    toNumber: string;
    messageType: string;
    role: 'user' | 'assistant' | 'system';
    content: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    // Check if message with correlation_id already exists (idempotency)
    const existing = await pool.query<Message>(
      'SELECT * FROM messages WHERE correlation_id = $1 AND session_id = $2',
      [data.correlationId, data.sessionId]
    );

    if (existing.rows.length > 0) {
      return this.mapMessage(existing.rows[0]);
    }

    const result = await pool.query<Message>(
      `INSERT INTO messages (session_id, user_id, correlation_id, from_number, to_number, message_type, role, content, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING message_id, session_id, user_id, correlation_id, from_number, to_number, message_type, role, content, metadata, created_at`,
      [
        data.sessionId,
        data.userId,
        data.correlationId,
        data.fromNumber,
        data.toNumber,
        data.messageType,
        data.role,
        JSON.stringify(data.content),
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    return this.mapMessage(result.rows[0]);
  }

  /**
   * Find message by ID
   */
  async findById(messageId: string): Promise<Message | null> {
    const result = await pool.query<Message>(
      `SELECT message_id, session_id, user_id, correlation_id, from_number, to_number, message_type, role, content, metadata, created_at
       FROM messages WHERE message_id = $1`,
      [messageId]
    );

    return result.rows.length > 0 ? this.mapMessage(result.rows[0]) : null;
  }

  /**
   * Find messages by session ID
   */
  async findBySessionId(sessionId: string, limit = 100): Promise<Message[]> {
    const result = await pool.query<Message>(
      `SELECT message_id, session_id, user_id, correlation_id, from_number, to_number, message_type, role, content, metadata, created_at
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows.map((row) => this.mapMessage(row));
  }

  /**
   * Find messages by correlation ID
   */
  async findByCorrelationId(correlationId: string): Promise<Message[]> {
    const result = await pool.query<Message>(
      `SELECT message_id, session_id, user_id, correlation_id, from_number, to_number, message_type, role, content, metadata, created_at
       FROM messages
       WHERE correlation_id = $1
       ORDER BY created_at ASC`,
      [correlationId]
    );

    return result.rows.map((row) => this.mapMessage(row));
  }

  /**
   * Create a message translation
   * Idempotent: If translation for message already exists, returns existing translation
   */
  async createTranslation(data: {
    messageId: string;
    originalText: string;
    detectedLanguage: string;
    translatedText: string;
    canonicalForm: string;
    translationConfidence?: number;
    translatorMetadata?: Record<string, unknown>;
  }): Promise<MessageTranslation> {
    // Check if translation already exists (idempotency)
    const existing = await pool.query<MessageTranslation>(
      'SELECT * FROM message_translations WHERE message_id = $1',
      [data.messageId]
    );

    if (existing.rows.length > 0) {
      return this.mapMessageTranslation(existing.rows[0]);
    }

    const result = await pool.query<MessageTranslation>(
      `INSERT INTO message_translations (message_id, original_text, detected_language, translated_text, canonical_form, translation_confidence, translator_metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING translation_id, message_id, original_text, detected_language, translated_text, canonical_form, translation_confidence, translator_metadata, created_at`,
      [
        data.messageId,
        data.originalText,
        data.detectedLanguage,
        data.translatedText,
        data.canonicalForm,
        data.translationConfidence,
        data.translatorMetadata ? JSON.stringify(data.translatorMetadata) : null,
      ]
    );

    return this.mapMessageTranslation(result.rows[0]);
  }

  /**
   * Find translation by message ID
   */
  async findTranslationByMessageId(messageId: string): Promise<MessageTranslation | null> {
    const result = await pool.query<MessageTranslation>(
      `SELECT translation_id, message_id, original_text, detected_language, translated_text, canonical_form, translation_confidence, translator_metadata, created_at
       FROM message_translations WHERE message_id = $1`,
      [messageId]
    );

    return result.rows.length > 0 ? this.mapMessageTranslation(result.rows[0]) : null;
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapMessage(row: any): Message {
    return {
      messageId: row.message_id,
      sessionId: row.session_id,
      userId: row.user_id,
      correlationId: row.correlation_id,
      fromNumber: row.from_number,
      toNumber: row.to_number,
      messageType: row.message_type,
      role: row.role,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  private mapMessageTranslation(row: any): MessageTranslation {
    return {
      translationId: row.translation_id,
      messageId: row.message_id,
      originalText: row.original_text,
      detectedLanguage: row.detected_language,
      translatedText: row.translated_text,
      canonicalForm: row.canonical_form,
      translationConfidence: row.translation_confidence,
      translatorMetadata: row.translator_metadata,
      createdAt: row.created_at,
    };
  }
}
