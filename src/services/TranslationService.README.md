# TranslationService

## Overview

The `TranslationService` handles language detection, normalization to canonical form, translation, and storage of translation records. It supports the platform's multilingual capabilities by ensuring user messages are properly detected, translated, and normalized for schema processing and tool execution.

## Requirements Validated

- **10.1**: Language detection from user messages
- **10.3**: Normalization to Canonical_Form for schema processing
- **10.7**: Storage of translation records with confidence and metadata

## Core Methods

### `detectLanguage(text: string): Promise<LanguageDetectionResult>`

Detects the language of a user message.

**Parameters:**
- `text` - User message text

**Returns:**
- `language` - Detected language code (e.g., 'en', 'fr', 'es')
- `confidence` - Detection confidence score (0-1)
- `alternatives` - Alternative language detections with confidence scores

**Example:**
```typescript
const result = await translationService.detectLanguage('Bonjour');
// { language: 'fr', confidence: 0.9, alternatives: [...] }
```

### `toCanonicalForm(text: string, sourceLang: string): Promise<string>`

Normalizes text to canonical form for schema processing and tool execution.

Canonical form is a normalized representation that:
- Uses the canonical language (typically English)
- Removes ambiguity and colloquialisms
- Standardizes terminology for schema field matching
- Preserves semantic meaning

**Parameters:**
- `text` - Original text
- `sourceLang` - Source language code

**Returns:**
- Canonical form text (normalized, lowercase, no punctuation)

**Example:**
```typescript
const canonical = await translationService.toCanonicalForm('Bonjour!', 'fr');
// 'hello'
```

### `translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult>`

Translates text to target language.

**Parameters:**
- `text` - Text to translate
- `targetLang` - Target language code
- `sourceLang` - Optional source language (will detect if not provided)

**Returns:**
- `translatedText` - Translated text
- `detectedLanguage` - Detected source language
- `targetLanguage` - Target language
- `confidence` - Combined confidence score
- `canonicalForm` - Canonical form of the original text
- `metadata` - Additional metadata (detection confidence, translation confidence, provider)

**Example:**
```typescript
const result = await translationService.translate('Bonjour', 'en');
// {
//   translatedText: 'hello',
//   detectedLanguage: 'fr',
//   targetLanguage: 'en',
//   confidence: 0.855,
//   canonicalForm: 'hello',
//   metadata: { ... }
// }
```

### `storeTranslationRecord(sessionId: string, record: TranslationRecord): Promise<MessageTranslation>`

Stores translation record in database.

**Parameters:**
- `sessionId` - Session ID for context
- `record` - Translation record containing:
  - `messageId` - Message ID
  - `originalText` - Original user text
  - `detectedLanguage` - Detected language
  - `translatedText` - Translated text
  - `canonicalForm` - Canonical form
  - `translationConfidence` - Confidence score
  - `translatorMetadata` - Optional metadata

**Returns:**
- Stored translation record with ID and timestamp

**Example:**
```typescript
const stored = await translationService.storeTranslationRecord('session_123', {
  messageId: 'msg_123',
  originalText: 'Bonjour',
  detectedLanguage: 'fr',
  translatedText: 'Hello',
  canonicalForm: 'hello',
  translationConfidence: 0.95,
});
```

## Configuration

The service is configured via environment variables:

```env
TRANSLATION_PROVIDER=mock          # Translation provider (mock, google, aws, etc.)
TRANSLATION_API_KEY=your_api_key   # API key for translation provider
TRANSLATION_DEFAULT_LANGUAGE=en    # Default language
TRANSLATION_CONFIDENCE_THRESHOLD=0.7  # Minimum confidence threshold
```

## Usage Example

```typescript
import { TranslationService } from './services/TranslationService.js';
import { MessageRepository } from './db/repositories/MessageRepository.js';

// Initialize service
const messageRepo = new MessageRepository();
const translationService = new TranslationService(messageRepo);

// Complete translation workflow
async function handleUserMessage(text: string, messageId: string, sessionId: string) {
  // 1. Detect language
  const detection = await translationService.detectLanguage(text);
  console.log(`Detected language: ${detection.language}`);

  // 2. Translate to English (if needed)
  const translation = await translationService.translate(text, 'en', detection.language);
  console.log(`Translated: ${translation.translatedText}`);
  console.log(`Canonical form: ${translation.canonicalForm}`);

  // 3. Store translation record
  const record = await translationService.storeTranslationRecord(sessionId, {
    messageId,
    originalText: text,
    detectedLanguage: translation.detectedLanguage,
    translatedText: translation.translatedText,
    canonicalForm: translation.canonicalForm,
    translationConfidence: translation.confidence,
    translatorMetadata: translation.metadata,
  });

  return {
    translation,
    record,
  };
}
```

## Mock Provider

The service includes a mock provider for testing and development. The mock provider:

- Detects common patterns in French, Spanish, Sinhala, and Tamil
- Provides simple translations for common phrases
- Returns reasonable confidence scores
- Defaults to English for unrecognized text

## Error Handling

The service throws `TranslationServiceError` with:
- `message` - Human-readable error message
- `code` - Error code (e.g., 'EMPTY_TEXT', 'DETECTION_FAILED')
- `retryable` - Whether the error is retryable

**Error Codes:**
- `EMPTY_TEXT` - Empty or whitespace-only text (not retryable)
- `DETECTION_FAILED` - Language detection failed (retryable)
- `CANONICALIZATION_FAILED` - Canonical form creation failed (retryable)
- `TRANSLATION_FAILED` - Translation failed (retryable)
- `STORAGE_FAILED` - Database storage failed (retryable)
- `PROVIDER_NOT_IMPLEMENTED` - Translation provider not implemented (not retryable)

## Integration with Other Services

### Orchestrator
The Orchestrator uses TranslationService to:
- Detect user language on first message
- Normalize user input to canonical form for schema matching
- Translate responses to user's preferred language

### WhatsApp Renderer
The WhatsApp Renderer uses TranslationService to:
- Translate UI labels and prompts to user's language
- Translate confirmation messages
- Translate error messages

### Vendor CMS
The Vendor CMS uses TranslationService to:
- Translate vendor requests to vendor's preferred language
- Translate vendor responses back to canonical form

## Future Enhancements

- Integration with Google Translate API
- Integration with AWS Translate
- Integration with Azure Translator
- Caching of common translations
- Language-specific normalization rules
- Support for regional dialects
- Translation quality scoring
- Fallback translation chains
