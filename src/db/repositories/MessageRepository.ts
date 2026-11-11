/**
 * MessageRepository - Data access layer for message entities
 * Handles messages and message_translations
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import crypto from 'node:crypto';
import { sanitizeConversationText } from '../../utils/contextPrivacy.js';

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
  async findRecentByTraveller(traveller: string, limit = 12): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const result = await pool.query(
      `SELECT m.role, m.content, m.metadata FROM messages m JOIN users u ON u.user_id=m.user_id
       WHERE u.phone_number=$1 AND m.role IN ('user','assistant')
       ORDER BY m.created_at DESC, m.message_id DESC LIMIT $2`,
      [traveller.replace(/^whatsapp:/, ''), Math.min(12, Math.max(1, limit))]
    );
    return result.rows.reverse().map((row) => ({ role: row.role,
      content: sanitizeConversationText(`${row.role === 'assistant' && row.metadata?.delivery !== 'submitted' ? '[Generated reply; delivery not verified] ' : ''}${String(row.content?.text ?? '')}`) }));
  }

  /** Role-aware idempotency under the traveller row lock; generated replies are not delivery receipts. */
  async appendConversationTurn(input: {
    traveller: string; peer: string; requestId: string; role: 'user' | 'assistant'; text: string;
  }): Promise<'durable' | 'absent'> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const phone = input.traveller.replace(/^whatsapp:/, '');
      const users = await client.query('SELECT user_id FROM users WHERE phone_number=$1 FOR UPDATE', [phone]);
      const userId = users.rows[0]?.user_id;
      if (!userId) { await client.query('COMMIT'); return 'absent'; }
      const hash = crypto.createHash('sha256').update(input.requestId).digest('hex').slice(0, 32);
      const correlation = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
      const existing = await client.query('SELECT message_id FROM messages WHERE user_id=$1 AND correlation_id=$2 AND role=$3', [userId, correlation, input.role]);
      if (!existing.rows.length) {
        const sessions = await client.query('SELECT session_id FROM sessions WHERE user_id=$1 ORDER BY last_activity_at DESC LIMIT 1', [userId]);
        const sessionId = sessions.rows[0]?.session_id ?? (await client.query(
          'INSERT INTO sessions(user_id,phone_number) VALUES($1,$2) RETURNING session_id', [userId, phone]
        )).rows[0].session_id;
        await client.query(
          `INSERT INTO messages(session_id,user_id,correlation_id,from_number,to_number,message_type,role,content,metadata)
           VALUES($1,$2,$3,$4,$5,'text',$6,$7,$8)`,
          [sessionId, userId, correlation, phone, input.peer.replace(/^whatsapp:/, '').slice(0, 20), input.role,
            JSON.stringify({ text: sanitizeConversationText(input.text, 2000) }), JSON.stringify({ delivery: input.role === 'assistant' ? 'generated' : 'received' })]
        );
        await client.query('UPDATE sessions SET last_activity_at=NOW() WHERE session_id=$1', [sessionId]);
      }
      await client.query('COMMIT');
      return 'durable';
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Conversation persistence unavailable');
    } finally { client.release(); }
  }
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
      'SELECT * FROM messages WHERE correlation_id = $1 AND session_id = $2 AND role = $3',
      [data.correlationId, data.sessionId, data.role]
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
