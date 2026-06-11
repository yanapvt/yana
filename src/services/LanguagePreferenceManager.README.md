# LanguagePreferenceManager

The `LanguagePreferenceManager` service manages user language preference detection, persistence, and application across the YANA/OGO platform.

## Purpose

This service implements Requirements 10.2 and 10.4:
- **Requirement 10.2**: Store user's preferred language in user profile and apply it to all subsequent interactions
- **Requirement 10.4**: Translate all WhatsApp UI labels, messages, and confirmations into user's preferred language before delivery

## Key Features

1. **First-Time Language Detection**: Automatically detects language from the user's first meaningful message
2. **Preference Persistence**: Stores detected language in the user profile for all future interactions
3. **Preference Retrieval**: Provides the user's preferred language for rendering WhatsApp messages
4. **Manual Override**: Supports explicit language preference updates

## Usage

### Basic Usage

```typescript
import { LanguagePreferenceManager } from './services/LanguagePreferenceManager.js';
import { TranslationService } from './services/TranslationService.js';
import { SessionManager } from './services/SessionManager.js';

// Initialize dependencies
const translationService = new TranslationService(messageRepository);
const sessionManager = new SessionManager(
  userRepository,
  sessionRepository,
  messageRepository,
  stateStore
);

// Create manager
const languageManager = new LanguagePreferenceManager(
  translationService,
  sessionManager
);

// Detect and persist language on first message
const result = await languageManager.detectAndPersistLanguagePreference(
  userId,
  'Bonjour, je cherche un hôtel'
);

console.log(result);
// {
//   userId: 'user_123',
//   detectedLanguage: 'fr',
//   confidence: 0.95,
//   isFirstDetection: true,
//   preferredLanguage: 'fr'
// }

// Get preferred language for rendering
const language = await languageManager.getPreferredLanguageForRendering(userId);
// Returns: 'fr'
```

### Integration with Message Processing

```typescript
// In your message processing flow
async function processInboundMessage(userId: string, messageText: string) {
  // Detect and persist language preference on first message
  const languagePreference = await languageManager.detectAndPersistLanguagePreference(
    userId,
    messageText
  );

  if (languagePreference.isFirstDetection) {
    console.log(`New user language detected: ${languagePreference.detectedLanguage}`);
  }

  // Use the preferred language for all subsequent rendering
  const preferredLanguage = languagePreference.preferredLanguage;

  // Render WhatsApp response in user's preferred language
  const response = await whatsappRenderer.renderMessage(
    responseContent,
    preferredLanguage
  );

  return response;
}
```

### Integration with WhatsApp Renderer

```typescript
// In your WhatsApp renderer
async function renderMessage(userId: string, content: any) {
  // Get user's preferred language
  const language = await languageManager.getPreferredLanguageForRendering(userId);

  // Translate all UI labels and messages
  const translatedContent = await translateContent(content, language);

  // Format and send WhatsApp message
  return formatWhatsAppMessage(translatedContent);
}
```

### Manual Language Preference Update

```typescript
// Allow users to change their language preference
async function updateUserLanguage(userId: string, newLanguage: string) {
  await languageManager.updatePreferredLanguage(userId, newLanguage);
  console.log(`User language updated to: ${newLanguage}`);
}
```

## API Reference

### `detectAndPersistLanguagePreference(userId, messageText)`

Detects and persists user's language preference on first meaningful message.

**Parameters:**
- `userId` (string): User ID
- `messageText` (string): User's message text for language detection

**Returns:** `Promise<LanguagePreferenceResult>`
- `userId`: User ID
- `detectedLanguage`: Detected language code
- `confidence`: Detection confidence (0-1)
- `isFirstDetection`: Whether this is the first detection
- `preferredLanguage`: The language to use for rendering

**Behavior:**
- If user already has a stored preference (not default 'en'), returns it without detection
- If user has default 'en' or no preference, detects language and stores it
- Throws `LanguagePreferenceError` if detection or persistence fails

### `getPreferredLanguageForRendering(userId, fallbackMessageText?)`

Gets user's preferred language for rendering WhatsApp messages.

**Parameters:**
- `userId` (string): User ID
- `fallbackMessageText` (string, optional): Message text for detection if no preference exists

**Returns:** `Promise<string>` - Language code

**Behavior:**
- Returns stored preference if available
- If no preference and message provided, detects and persists
- Defaults to 'en' if no preference and no message
- Falls back to 'en' on error (ensures messages can still be rendered)

### `updatePreferredLanguage(userId, language)`

Updates user's preferred language manually.

**Parameters:**
- `userId` (string): User ID
- `language` (string): Language code to set

**Returns:** `Promise<void>`

**Throws:** `LanguagePreferenceError` if update fails

## Supported Languages

The service supports all languages that the underlying `TranslationService` can detect, including:
- English (en)
- French (fr)
- Spanish (es)
- Sinhala (si)
- Tamil (ta)
- And more...

## Error Handling

The service throws `LanguagePreferenceError` with the following properties:
- `message`: Error description
- `code`: Error code (e.g., 'DETECTION_PERSISTENCE_FAILED', 'UPDATE_FAILED')
- `retryable`: Whether the operation can be retried

All errors are marked as retryable by default.

## Design Decisions

### Why detect on default 'en'?

When a user is created, they're assigned a default language of 'en'. This doesn't represent an actual detection, so we treat it as "no preference" and detect language on the first meaningful message.

### Why fall back to 'en' on error?

To ensure the platform remains functional even when language detection fails, we fall back to English. This prevents blocking critical flows like booking or payment.

### Why store in user profile?

Language preference is part of the user's static profile (Requirement 16.4) and should persist across all sessions. Storing it in the user profile ensures it's available for all future interactions.

## Testing

Comprehensive unit tests are available in `LanguagePreferenceManager.test.ts`, covering:
- First-time language detection and persistence
- Returning users with stored preferences
- Default 'en' handling
- Multiple language support (French, Spanish, Sinhala, Tamil)
- Error handling and fallback behavior
- Integration scenarios

Run tests:
```bash
npm test -- src/services/LanguagePreferenceManager.test.ts
```

## Related Services

- **TranslationService**: Provides language detection and translation capabilities
- **SessionManager**: Manages user sessions and profile updates
- **UserRepository**: Persists user profile data including language preference
- **WhatsAppRenderer**: Uses language preference to render messages (to be implemented)

## Future Enhancements

1. Support for language preference confidence thresholds
2. Language preference history tracking
3. Multi-language support for bilingual users
4. Language preference analytics and reporting
