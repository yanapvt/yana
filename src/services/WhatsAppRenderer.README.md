# WhatsAppRenderer

The `WhatsAppRenderer` service produces WhatsApp-safe message payloads with validation against WhatsApp UI limits. It handles translation, fallback to plain text, and deterministic rendering for all message types.

## Features

- **WhatsApp UI Validation**: Validates all messages against WhatsApp Business API limits
- **Automatic Fallback**: Falls back to plain text when UI limits are exceeded
- **Multilingual Support**: Translates all labels, prompts, and confirmations to user's language
- **Multiple Message Types**: Supports text, buttons, lists, confirmations, and field prompts
- **Deterministic Rendering**: Produces consistent, predictable output for transactional flows

## WhatsApp UI Limits

The renderer enforces the following WhatsApp Business API limits:

- **Buttons**: Maximum 3 buttons per message
- **List Items**: Maximum 10 items across all sections
- **List Sections**: Maximum 10 sections per list
- **Text Length**: Maximum 4096 characters
- **Button Title**: Maximum 20 characters
- **List Item Title**: Maximum 24 characters
- **List Item Description**: Maximum 72 characters
- **List Section Title**: Maximum 24 characters

## Usage

### Basic Setup

```typescript
import { WhatsAppRenderer } from './services/WhatsAppRenderer.js';
import { TranslationService } from './services/TranslationService.js';

// With translation support
const translationService = new TranslationService(messageRepo);
const renderer = new WhatsAppRenderer(translationService);

// Without translation (messages remain in original language)
const renderer = new WhatsAppRenderer();
```

### Rendering Messages

#### Text Message

```typescript
const content = {
  type: 'text',
  body: 'Hello! How can I help you today?',
};

const result = await renderer.renderMessage(content, 'en');
```

#### Buttons Message

```typescript
const content = {
  type: 'buttons',
  body: 'When are you checking in?',
  buttons: [
    { id: 'today', title: 'Today' },
    { id: 'tomorrow', title: 'Tomorrow' },
    { id: 'custom', title: 'Pick date' },
  ],
};

const result = await renderer.renderMessage(content, 'en');
```

#### List Message

```typescript
const content = {
  type: 'list',
  body: 'Available hotels in Galle:',
  buttonText: 'View Hotels',
  sections: [
    {
      title: 'Luxury Hotels',
      rows: [
        {
          id: 'hotel_1',
          title: 'Grand Galle Hotel',
          description: 'Beachfront luxury resort',
        },
      ],
    },
  ],
};

const result = await renderer.renderMessage(content, 'en');
```

#### Confirmation Message

```typescript
const content = {
  type: 'confirmation',
  summary: {
    title: 'Confirm your booking',
    details: {
      Hotel: 'Grand Galle Hotel',
      'Check-in': 'April 17, 2026',
      Price: '$150 USD',
    },
  },
  confirmButton: { id: 'confirm', title: 'Confirm' },
  cancelButton: { id: 'cancel', title: 'Cancel' },
};

const result = await renderer.renderMessage(content, 'en');
```

#### Field Prompt

```typescript
// With buttons (≤ 3 options)
const content = {
  type: 'field_prompt',
  fieldName: 'guests',
  promptText: 'How many guests?',
  options: [
    { id: '1', title: '1 guest' },
    { id: '2', title: '2 guests' },
    { id: 'more', title: 'More' },
  ],
};

// With list (> 3 options)
const content = {
  type: 'field_prompt',
  fieldName: 'city',
  promptText: 'Which city?',
  options: [
    { id: 'colombo', title: 'Colombo', description: 'Capital city' },
    { id: 'galle', title: 'Galle', description: 'Coastal city' },
    { id: 'kandy', title: 'Kandy', description: 'Cultural capital' },
    { id: 'ella', title: 'Ella', description: 'Mountain town' },
  ],
};

const result = await renderer.renderMessage(content, 'en');
```

## Validation and Fallback

The renderer automatically validates all content against WhatsApp UI limits. When validation fails, it falls back to plain text:

```typescript
// This will exceed the 3-button limit
const content = {
  type: 'buttons',
  body: 'Choose a time',
  buttons: [
    { id: '1', title: 'Morning' },
    { id: '2', title: 'Afternoon' },
    { id: '3', title: 'Evening' },
    { id: '4', title: 'Night' }, // Exceeds limit
  ],
};

const result = await renderer.renderMessage(content, 'en');

// Result will be plain text with numbered options
console.log(result.metadata?.fallbackApplied); // true
console.log(result.messages[0].type); // 'text'
```

## Translation

When a `TranslationService` is provided, all text content is automatically translated to the user's preferred language:

```typescript
const content = {
  type: 'buttons',
  body: 'hello',
  buttons: [{ id: 'yes', title: 'yes' }],
};

// Render in French
const result = await renderer.renderMessage(content, 'fr');
// Body and button titles will be translated
```

## Output Format

The renderer returns a `WhatsAppMessage` object:

```typescript
interface WhatsAppMessage {
  messages: WhatsAppMessagePart[];
  metadata?: {
    originalType: string;
    fallbackApplied: boolean;
    validationWarnings?: string[];
  };
}
```

## Integration with Orchestrator

The WhatsAppRenderer is typically used by the Orchestrator to format outbound messages:

```typescript
// In Orchestrator
const content = schemaEngine.generateFieldPrompt(missingField, userLanguage);
const whatsappMessage = await whatsappRenderer.renderMessage(content, userLanguage);

// Send via Twilio
await twilioClient.messages.create({
  from: twilioNumber,
  to: userPhoneNumber,
  body: whatsappMessage.messages[0].body,
  // ... additional WhatsApp-specific fields
});
```

## Requirements Validated

- **Requirement 15.1**: Validates all outbound messages against WhatsApp UI limits
- **Requirement 15.2**: Falls back to plain text when UI type is unsupported
- **Requirement 15.5**: Uses button and list-based interactions for critical flows
- **Requirement 15.6**: Produces short, clear, actionable messages
- **Requirement 4.6**: Supports deterministic rendering for transactional flows

## Error Handling

The renderer throws `WhatsAppRendererError` for unrecoverable errors:

```typescript
try {
  const result = await renderer.renderMessage(content, userLanguage);
} catch (error) {
  if (error instanceof WhatsAppRendererError) {
    console.error('Rendering failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Retryable:', error.retryable);
  }
}
```

## Best Practices

1. **Keep messages concise**: Avoid long text bodies, use lists for multiple items
2. **Use appropriate UI types**: Buttons for 1-3 options, lists for 4-10 options
3. **Provide clear labels**: Button and list titles should be short and descriptive
4. **Test with translation**: Ensure translated text fits within limits
5. **Handle fallback gracefully**: Design flows that work with plain text fallback

## See Also

- `TranslationService`: For multilingual support
- `SchemaEngine`: For generating field prompts
- `Orchestrator`: For coordinating message rendering
