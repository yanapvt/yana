/**
 * WhatsAppRenderer
 * 
 * Produces WhatsApp-safe message payloads with validation against WhatsApp UI limits.
 * Handles translation, fallback to plain text, and deterministic rendering.
 * 
 * Validates: Requirements 15.1, 15.2, 15.5, 15.6, 4.6, 7.5, 7.6, 7.7, 7.8
 */

import { TranslationService } from './TranslationService.js';
import type { HotelResult } from './adapters/HotelSearchAdapter.js';

// ============================================================================
// WhatsApp UI Limits (as per WhatsApp Business API specifications)
// ============================================================================

export const WHATSAPP_LIMITS = {
  MAX_BUTTONS: 3,
  MAX_LIST_ITEMS: 10,
  MAX_LIST_SECTIONS: 10,
  MAX_TEXT_LENGTH: 4096,
  MAX_BUTTON_TITLE_LENGTH: 20,
  MAX_LIST_ITEM_TITLE_LENGTH: 24,
  MAX_LIST_ITEM_DESCRIPTION_LENGTH: 72,
  MAX_LIST_SECTION_TITLE_LENGTH: 24,
} as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Content to be rendered as WhatsApp message
 */
export type RenderableContent =
  | TextRenderContent
  | ButtonsRenderContent
  | ListRenderContent
  | ConfirmationRenderContent
  | FieldPromptRenderContent
  | HotelResultsRenderContent;

/**
 * Plain text content
 */
export interface TextRenderContent {
  type: 'text';
  body: string;
}

/**
 * Buttons content (max 3 buttons)
 */
export interface ButtonsRenderContent {
  type: 'buttons';
  body?: string;
  buttons: ButtonOption[];
}

export interface ButtonOption {
  id: string;
  title: string;
}

/**
 * List content (max 10 items)
 */
export interface ListRenderContent {
  type: 'list';
  body: string;
  buttonText: string;
  sections: ListSection[];
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/**
 * Confirmation content (for booking/payment actions)
 */
export interface ConfirmationRenderContent {
  type: 'confirmation';
  summary: ConfirmationSummary;
  confirmButton: ButtonOption;
  cancelButton: ButtonOption;
}

export interface ConfirmationSummary {
  title: string;
  details: Record<string, string>;
}

/**
 * Field prompt content (for schema field collection)
 */
export interface FieldPromptRenderContent {
  type: 'field_prompt';
  fieldName: string;
  promptText: string;
  options?: ButtonOption[] | ListRow[];
}

/**
 * Hotel results content (for hotel search results)
 */
export interface HotelResultsRenderContent {
  type: 'hotel_results';
  results: HotelResult[];
  headerText?: string;
}

/**
 * Rendered WhatsApp message payload
 */
export interface WhatsAppMessage {
  messages: WhatsAppMessagePart[];
  metadata?: {
    originalType: string;
    fallbackApplied: boolean;
    validationWarnings?: string[];
  };
}

/**
 * Individual WhatsApp message part
 */
export type WhatsAppMessagePart =
  | WhatsAppTextMessage
  | WhatsAppButtonsMessage
  | WhatsAppListMessage;

export interface WhatsAppTextMessage {
  type: 'text';
  body: string;
}

export interface WhatsAppButtonsMessage {
  type: 'buttons';
  body?: string;
  buttons: ButtonOption[];
}

export interface WhatsAppListMessage {
  type: 'list';
  body: string;
  buttonText: string;
  sections: ListSection[];
}

/**
 * Validation result for WhatsApp content
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  limit?: number;
  actual?: number;
}

export interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Error thrown when rendering fails
 */
export class WhatsAppRendererError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'WhatsAppRendererError';
  }
}

// ============================================================================
// WhatsAppRenderer Class
// ============================================================================

export class WhatsAppRenderer {
  constructor(private translationService?: TranslationService) {}

  /**
   * Render content as WhatsApp-safe message payload
   * 
   * Validates against WhatsApp UI limits, translates labels to user's language,
   * and falls back to plain text when UI type is unsupported.
   * 
   * Validates: Requirements 15.1, 15.2, 15.5, 15.6, 4.6
   * 
   * @param content - Content to render
   * @param userLanguage - User's preferred language
   * @returns WhatsApp message payload
   * @throws WhatsAppRendererError if rendering fails
   */
  async renderMessage(
    content: RenderableContent,
    userLanguage: string = 'en'
  ): Promise<WhatsAppMessage> {
    try {
      // Validate content before rendering
      const validation = this.validateContent(content);

      // If validation fails, fall back to plain text
      if (!validation.valid) {
        console.log('[WhatsAppRenderer] Validation failed, falling back to plain text:', {
          type: content.type,
          errors: validation.errors,
        });

        return this.fallbackToPlainText(content, userLanguage, validation);
      }

      // Render based on content type
      switch (content.type) {
        case 'text':
          return this.renderText(content, userLanguage);

        case 'buttons':
          return this.renderButtons(content, userLanguage);

        case 'list':
          return this.renderList(content, userLanguage);

        case 'confirmation':
          return this.renderConfirmation(content, userLanguage);

        case 'field_prompt':
          return this.renderFieldPrompt(content, userLanguage);

        case 'hotel_results':
          return this.renderHotelResults(content, userLanguage);

        default:
          throw new WhatsAppRendererError(
            `Unsupported content type: ${(content as any).type}`,
            'UNSUPPORTED_TYPE',
            false
          );
      }
    } catch (error) {
      if (error instanceof WhatsAppRendererError) {
        throw error;
      }

      throw new WhatsAppRendererError(
        `Failed to render message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RENDER_FAILED',
        true // Retryable
      );
    }
  }

  // ==========================================================================
  // Validation Methods
  // ==========================================================================

  /**
   * Validate content against WhatsApp UI limits
   * 
   * Validates: Requirement 15.1
   */
  private validateContent(content: RenderableContent): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    switch (content.type) {
      case 'text':
        this.validateText(content, errors, warnings);
        break;

      case 'buttons':
        this.validateButtons(content, errors, warnings);
        break;

      case 'list':
        this.validateList(content, errors, warnings);
        break;

      case 'confirmation':
        this.validateConfirmation(content, errors, warnings);
        break;

      case 'field_prompt':
        this.validateFieldPrompt(content, errors, warnings);
        break;

      case 'hotel_results':
        this.validateHotelResults(content, errors, warnings);
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateText(
    content: TextRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    if (content.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
      errors.push({
        field: 'body',
        message: 'Text body exceeds maximum length',
        limit: WHATSAPP_LIMITS.MAX_TEXT_LENGTH,
        actual: content.body.length,
      });
    }

    if (content.body.length > 1000) {
      _warnings.push({
        field: 'body',
        message: 'Text body is long, consider breaking into multiple messages',
      });
    }
  }

  private validateButtons(
    content: ButtonsRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    // Validate button count
    if (content.buttons.length > WHATSAPP_LIMITS.MAX_BUTTONS) {
      errors.push({
        field: 'buttons',
        message: 'Too many buttons',
        limit: WHATSAPP_LIMITS.MAX_BUTTONS,
        actual: content.buttons.length,
      });
    }

    if (content.buttons.length === 0) {
      errors.push({
        field: 'buttons',
        message: 'At least one button is required',
      });
    }

    // Validate button titles
    content.buttons.forEach((button, index) => {
      if (button.title.length > WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) {
        errors.push({
          field: `buttons[${index}].title`,
          message: 'Button title exceeds maximum length',
          limit: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH,
          actual: button.title.length,
        });
      }

      if (!button.id || button.id.trim().length === 0) {
        errors.push({
          field: `buttons[${index}].id`,
          message: 'Button ID is required',
        });
      }
    });

    // Validate body if present
    if (content.body && content.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
      errors.push({
        field: 'body',
        message: 'Text body exceeds maximum length',
        limit: WHATSAPP_LIMITS.MAX_TEXT_LENGTH,
        actual: content.body.length,
      });
    }
  }

  private validateList(
    content: ListRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    // Validate section count
    if (content.sections.length > WHATSAPP_LIMITS.MAX_LIST_SECTIONS) {
      errors.push({
        field: 'sections',
        message: 'Too many list sections',
        limit: WHATSAPP_LIMITS.MAX_LIST_SECTIONS,
        actual: content.sections.length,
      });
    }

    if (content.sections.length === 0) {
      errors.push({
        field: 'sections',
        message: 'At least one section is required',
      });
    }

    // Count total items across all sections
    const totalItems = content.sections.reduce(
      (sum, section) => sum + section.rows.length,
      0
    );

    if (totalItems > WHATSAPP_LIMITS.MAX_LIST_ITEMS) {
      errors.push({
        field: 'sections',
        message: 'Too many list items across all sections',
        limit: WHATSAPP_LIMITS.MAX_LIST_ITEMS,
        actual: totalItems,
      });
    }

    // Validate each section
    content.sections.forEach((section, sectionIndex) => {
      if (section.title && section.title.length > WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH) {
        errors.push({
          field: `sections[${sectionIndex}].title`,
          message: 'Section title exceeds maximum length',
          limit: WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH,
          actual: section.title.length,
        });
      }

      if (section.rows.length === 0) {
        errors.push({
          field: `sections[${sectionIndex}].rows`,
          message: 'Section must have at least one row',
        });
      }

      // Validate each row
      section.rows.forEach((row, rowIndex) => {
        if (row.title.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH) {
          errors.push({
            field: `sections[${sectionIndex}].rows[${rowIndex}].title`,
            message: 'List item title exceeds maximum length',
            limit: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH,
            actual: row.title.length,
          });
        }

        if (row.description && row.description.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH) {
          errors.push({
            field: `sections[${sectionIndex}].rows[${rowIndex}].description`,
            message: 'List item description exceeds maximum length',
            limit: WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH,
            actual: row.description.length,
          });
        }

        if (!row.id || row.id.trim().length === 0) {
          errors.push({
            field: `sections[${sectionIndex}].rows[${rowIndex}].id`,
            message: 'List item ID is required',
          });
        }
      });
    });

    // Validate body and button text
    if (content.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
      errors.push({
        field: 'body',
        message: 'Text body exceeds maximum length',
        limit: WHATSAPP_LIMITS.MAX_TEXT_LENGTH,
        actual: content.body.length,
      });
    }

    if (content.buttonText.length > WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) {
      errors.push({
        field: 'buttonText',
        message: 'Button text exceeds maximum length',
        limit: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH,
        actual: content.buttonText.length,
      });
    }
  }

  private validateConfirmation(
    content: ConfirmationRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    // Confirmation is rendered as buttons, so validate as buttons
    const buttonsContent: ButtonsRenderContent = {
      type: 'buttons',
      body: this.formatConfirmationSummary(content.summary),
      buttons: [content.confirmButton, content.cancelButton],
    };

    this.validateButtons(buttonsContent, errors, _warnings);
  }

  private validateFieldPrompt(
    content: FieldPromptRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    if (!content.options || content.options.length === 0) {
      // Text-only prompt
      this.validateText({ type: 'text', body: content.promptText }, errors, _warnings);
    } else if (content.options.length <= WHATSAPP_LIMITS.MAX_BUTTONS) {
      // Render as buttons
      const buttonsContent: ButtonsRenderContent = {
        type: 'buttons',
        body: content.promptText,
        buttons: content.options as ButtonOption[],
      };
      this.validateButtons(buttonsContent, errors, _warnings);
    } else {
      // Render as list
      const listContent: ListRenderContent = {
        type: 'list',
        body: content.promptText,
        buttonText: 'Select',
        sections: [{ rows: content.options as ListRow[] }],
      };
      this.validateList(listContent, errors, _warnings);
    }
  }

  private validateHotelResults(
    content: HotelResultsRenderContent,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    // Validate that we have results
    if (!content.results || content.results.length === 0) {
      // No results case - will render as text
      return;
    }

    // Validate result count against WhatsApp limits
    if (content.results.length > WHATSAPP_LIMITS.MAX_LIST_ITEMS) {
      errors.push({
        field: 'results',
        message: 'Too many hotel results',
        limit: WHATSAPP_LIMITS.MAX_LIST_ITEMS,
        actual: content.results.length,
      });
    }

    // Validate each hotel result
    content.results.forEach((hotel, index) => {
      // Validate hotel name length for list item title
      if (hotel.name.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH) {
        errors.push({
          field: `results[${index}].name`,
          message: 'Hotel name exceeds maximum length for list item',
          limit: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH,
          actual: hotel.name.length,
        });
      }
    });

    // Validate header text if present
    if (content.headerText && content.headerText.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
      errors.push({
        field: 'headerText',
        message: 'Header text exceeds maximum length',
        limit: WHATSAPP_LIMITS.MAX_TEXT_LENGTH,
        actual: content.headerText.length,
      });
    }
  }

  // ==========================================================================
  // Rendering Methods
  // ==========================================================================

  private async renderText(
    content: TextRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    // Translate body if translation service is available
    const body = await this.translateText(content.body, userLanguage);

    return {
      messages: [
        {
          type: 'text',
          body,
        },
      ],
      metadata: {
        originalType: 'text',
        fallbackApplied: false,
      },
    };
  }

  private async renderButtons(
    content: ButtonsRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    // Translate body and button titles
    const body = content.body ? await this.translateText(content.body, userLanguage) : undefined;
    const buttons = await Promise.all(
      content.buttons.map(async (button) => ({
        id: button.id,
        title: await this.translateText(button.title, userLanguage),
      }))
    );

    return {
      messages: [
        {
          type: 'buttons',
          body,
          buttons,
        },
      ],
      metadata: {
        originalType: 'buttons',
        fallbackApplied: false,
      },
    };
  }

  private async renderList(
    content: ListRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    // Translate body, button text, and list items
    const body = await this.translateText(content.body, userLanguage);
    const buttonText = await this.translateText(content.buttonText, userLanguage);

    const sections = await Promise.all(
      content.sections.map(async (section) => ({
        title: section.title ? await this.translateText(section.title, userLanguage) : undefined,
        rows: await Promise.all(
          section.rows.map(async (row) => ({
            id: row.id,
            title: await this.translateText(row.title, userLanguage),
            description: row.description
              ? await this.translateText(row.description, userLanguage)
              : undefined,
          }))
        ),
      }))
    );

    return {
      messages: [
        {
          type: 'list',
          body,
          buttonText,
          sections,
        },
      ],
      metadata: {
        originalType: 'list',
        fallbackApplied: false,
      },
    };
  }

  private async renderConfirmation(
    content: ConfirmationRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    // Format confirmation summary
    const summaryText = this.formatConfirmationSummary(content.summary);
    const body = await this.translateText(summaryText, userLanguage);

    // Translate button titles
    const confirmButton = {
      id: content.confirmButton.id,
      title: await this.translateText(content.confirmButton.title, userLanguage),
    };

    const cancelButton = {
      id: content.cancelButton.id,
      title: await this.translateText(content.cancelButton.title, userLanguage),
    };

    return {
      messages: [
        {
          type: 'buttons',
          body,
          buttons: [confirmButton, cancelButton],
        },
      ],
      metadata: {
        originalType: 'confirmation',
        fallbackApplied: false,
      },
    };
  }

  private async renderFieldPrompt(
    content: FieldPromptRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    const promptText = await this.translateText(content.promptText, userLanguage);

    // If no options, render as plain text
    if (!content.options || content.options.length === 0) {
      return {
        messages: [
          {
            type: 'text',
            body: promptText,
          },
        ],
        metadata: {
          originalType: 'field_prompt',
          fallbackApplied: false,
        },
      };
    }

    // If options fit in buttons (≤ 3), render as buttons
    if (content.options.length <= WHATSAPP_LIMITS.MAX_BUTTONS) {
      const buttons = await Promise.all(
        (content.options as ButtonOption[]).map(async (option) => ({
          id: option.id,
          title: await this.translateText(option.title, userLanguage),
        }))
      );

      return {
        messages: [
          {
            type: 'buttons',
            body: promptText,
            buttons,
          },
        ],
        metadata: {
          originalType: 'field_prompt',
          fallbackApplied: false,
        },
      };
    }

    // Otherwise, render as list
    const rows = await Promise.all(
      (content.options as ListRow[]).map(async (option) => ({
        id: option.id,
        title: await this.translateText(option.title, userLanguage),
        description: option.description
          ? await this.translateText(option.description, userLanguage)
          : undefined,
      }))
    );

    return {
      messages: [
        {
          type: 'list',
          body: promptText,
          buttonText: await this.translateText('Select', userLanguage),
          sections: [{ rows }],
        },
      ],
      metadata: {
        originalType: 'field_prompt',
        fallbackApplied: false,
      },
    };
  }

  private async renderHotelResults(
    content: HotelResultsRenderContent,
    userLanguage: string
  ): Promise<WhatsAppMessage> {
    // Handle no results case
    if (!content.results || content.results.length === 0) {
      return this.renderNoHotelResults(userLanguage);
    }

    // Limit results to WhatsApp max list items
    const limitedResults = content.results.slice(0, WHATSAPP_LIMITS.MAX_LIST_ITEMS);

    // Build header text
    const headerText = content.headerText 
      ? await this.translateText(content.headerText, userLanguage)
      : await this.translateText(
          `Found ${content.results.length} hotel${content.results.length !== 1 ? 's' : ''}`,
          userLanguage
        );

    // Build list rows for each hotel
    const rows = await Promise.all(
      limitedResults.map(async (hotel) => {
        const title = this.truncateToLimit(hotel.name, WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH);
        const description = await this.formatHotelDescription(hotel, userLanguage);
        
        return {
          id: `hotel_${hotel.bookingToken}`,
          title,
          description: this.truncateToLimit(description, WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH),
        };
      })
    );

    return {
      messages: [
        {
          type: 'list',
          body: headerText,
          buttonText: await this.translateText('View Hotels', userLanguage),
          sections: [{ rows }],
        },
      ],
      metadata: {
        originalType: 'hotel_results',
        fallbackApplied: false,
      },
    };
  }

  /**
   * Render no results message with alternative search options
   * 
   * Validates: Requirement 7.8
   */
  private async renderNoHotelResults(userLanguage: string): Promise<WhatsAppMessage> {
    const body = await this.translateText(
      'No hotels found for your search. Try adjusting your criteria.',
      userLanguage
    );

    const buttons = [
      {
        id: 'search_again',
        title: await this.translateText('Search Again', userLanguage),
      },
      {
        id: 'change_location',
        title: await this.translateText('Change Location', userLanguage),
      },
      {
        id: 'change_dates',
        title: await this.translateText('Change Dates', userLanguage),
      },
    ];

    return {
      messages: [
        {
          type: 'buttons',
          body,
          buttons,
        },
      ],
      metadata: {
        originalType: 'hotel_results',
        fallbackApplied: false,
      },
    };
  }

  /**
   * Format hotel description for list item
   * 
   * Includes: price, currency, rating, review count, location, distance
   * 
   * Validates: Requirements 7.5, 7.6
   */
  private async formatHotelDescription(hotel: HotelResult, userLanguage: string): Promise<string> {
    const parts: string[] = [];

    // Price and currency
    parts.push(`${hotel.currency} ${hotel.price.toFixed(2)}`);

    // Rating and reviews
    if (hotel.rating > 0) {
      const stars = '⭐'.repeat(Math.round(hotel.rating));
      parts.push(`${stars} (${hotel.reviewCount})`);
    }

    // Location and distance
    if (hotel.distance > 0) {
      parts.push(`${hotel.distance.toFixed(1)}km`);
    }

    return parts.join(' • ');
  }

  /**
   * Render detailed hotel card with all information and action buttons
   * 
   * Includes: name, price, currency, rating, review count, location, distance,
   * amenities, cancellation policy, and Book Now / More Info buttons
   * 
   * Validates: Requirements 7.5, 7.6, 7.7
   */
  async renderHotelCard(
    hotel: HotelResult,
    userLanguage: string = 'en'
  ): Promise<WhatsAppMessage> {
    // Build detailed hotel information
    const details: string[] = [];

    // Hotel name (as header)
    details.push(`*${hotel.name}*`);
    details.push('');

    // Price
    details.push(
      await this.translateText(
        `💰 Price: ${hotel.currency} ${hotel.price.toFixed(2)} per night`,
        userLanguage
      )
    );

    // Rating and reviews
    if (hotel.rating > 0) {
      const stars = '⭐'.repeat(Math.round(hotel.rating));
      details.push(
        await this.translateText(
          `${stars} ${hotel.rating.toFixed(1)}/5 (${hotel.reviewCount} reviews)`,
          userLanguage
        )
      );
    }

    // Location
    if (hotel.location) {
      details.push(
        await this.translateText(`📍 Location: ${hotel.location}`, userLanguage)
      );
    }

    // Distance
    if (hotel.distance > 0) {
      details.push(
        await this.translateText(
          `📏 Distance: ${hotel.distance.toFixed(1)} km from center`,
          userLanguage
        )
      );
    }

    // Amenities (limit to first 5)
    if (hotel.amenities && hotel.amenities.length > 0) {
      const amenitiesList = hotel.amenities.slice(0, 5).join(', ');
      details.push('');
      details.push(await this.translateText(`✨ Amenities: ${amenitiesList}`, userLanguage));
      if (hotel.amenities.length > 5) {
        details.push(
          await this.translateText(`   ...and ${hotel.amenities.length - 5} more`, userLanguage)
        );
      }
    }

    // Cancellation policy
    if (hotel.cancellationPolicy) {
      details.push('');
      details.push(
        await this.translateText(`📋 Cancellation: ${hotel.cancellationPolicy}`, userLanguage)
      );
    }

    const body = details.join('\n');

    // Action buttons (Book Now and More Info)
    const buttons = [
      {
        id: `book_${hotel.bookingToken}`,
        title: await this.translateText('Book Now', userLanguage),
      },
      {
        id: `info_${hotel.bookingToken}`,
        title: await this.translateText('More Info', userLanguage),
      },
    ];

    return {
      messages: [
        {
          type: 'buttons',
          body,
          buttons,
        },
      ],
      metadata: {
        originalType: 'hotel_card',
        fallbackApplied: false,
      },
    };
  }

  // ==========================================================================
  // Fallback Methods
  // ==========================================================================

  /**
   * Fall back to plain text when UI type is unsupported or validation fails
   * 
   * Validates: Requirement 15.2
   */
  private async fallbackToPlainText(
    content: RenderableContent,
    userLanguage: string,
    validation: ValidationResult
  ): Promise<WhatsAppMessage> {
    let plainText = '';

    switch (content.type) {
      case 'text':
        plainText = content.body;
        break;

      case 'buttons':
        plainText = content.body || '';
        if (content.buttons.length > 0) {
          plainText += '\n\nOptions:\n';
          content.buttons.forEach((button, index) => {
            plainText += `${index + 1}. ${button.title}\n`;
          });
        }
        break;

      case 'list':
        plainText = content.body;
        content.sections.forEach((section) => {
          if (section.title) {
            plainText += `\n\n${section.title}:`;
          }
          section.rows.forEach((row, index) => {
            plainText += `\n${index + 1}. ${row.title}`;
            if (row.description) {
              plainText += ` - ${row.description}`;
            }
          });
        });
        break;

      case 'confirmation':
        plainText = this.formatConfirmationSummary(content.summary);
        plainText += `\n\nReply "${content.confirmButton.title}" to confirm or "${content.cancelButton.title}" to cancel.`;
        break;

      case 'field_prompt':
        plainText = content.promptText;
        if (content.options && content.options.length > 0) {
          plainText += '\n\nOptions:\n';
          content.options.forEach((option, index) => {
            const title = 'title' in option ? option.title : '';
            const description = 'description' in option ? option.description : undefined;
            plainText += `${index + 1}. ${title}`;
            if (description) {
              plainText += ` - ${description}`;
            }
            plainText += '\n';
          });
        }
        break;

      case 'hotel_results':
        if (!content.results || content.results.length === 0) {
          plainText = 'No hotels found for your search. Try adjusting your criteria.';
        } else {
          plainText = content.headerText || `Found ${content.results.length} hotels:\n\n`;
          content.results.forEach((hotel, index) => {
            plainText += `${index + 1}. ${hotel.name}\n`;
            plainText += `   ${hotel.currency} ${hotel.price.toFixed(2)} per night\n`;
            if (hotel.rating > 0) {
              plainText += `   Rating: ${hotel.rating.toFixed(1)}/5 (${hotel.reviewCount} reviews)\n`;
            }
            if (hotel.location) {
              plainText += `   Location: ${hotel.location}\n`;
            }
            if (hotel.distance > 0) {
              plainText += `   Distance: ${hotel.distance.toFixed(1)} km\n`;
            }
            plainText += '\n';
          });
        }
        break;
    }

    // Translate the plain text
    const translatedText = await this.translateText(plainText, userLanguage);

    // Truncate if exceeds max length
    const finalText =
      translatedText.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        ? translatedText.substring(0, WHATSAPP_LIMITS.MAX_TEXT_LENGTH - 3) + '...'
        : translatedText;

    return {
      messages: [
        {
          type: 'text',
          body: finalText,
        },
      ],
      metadata: {
        originalType: content.type,
        fallbackApplied: true,
        validationWarnings: validation.errors.map((e) => e.message),
      },
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Format confirmation summary as text
   */
  private formatConfirmationSummary(summary: ConfirmationSummary): string {
    let text = summary.title;

    if (Object.keys(summary.details).length > 0) {
      text += '\n\n';
      Object.entries(summary.details).forEach(([key, value]) => {
        text += `${key}: ${value}\n`;
      });
    }

    return text.trim();
  }

  /**
   * Truncate text to specified limit, adding ellipsis if truncated
   */
  private truncateToLimit(text: string, limit: number): string {
    if (text.length <= limit) {
      return text;
    }
    return text.substring(0, limit - 3) + '...';
  }

  /**
   * Translate text to user's language
   * 
   * If translation service is not available, returns original text.
   */
  private async translateText(text: string, targetLanguage: string): Promise<string> {
    if (!this.translationService) {
      return text;
    }

    try {
      const result = await this.translationService.translate(text, targetLanguage);
      return result.translatedText;
    } catch (error) {
      console.warn('[WhatsAppRenderer] Translation failed, using original text:', error);
      return text;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let whatsAppRendererInstance: WhatsAppRenderer | null = null;

/**
 * Gets the singleton WhatsAppRenderer instance
 */
export function getWhatsAppRenderer(
  translationService?: TranslationService
): WhatsAppRenderer {
  if (!whatsAppRendererInstance) {
    whatsAppRendererInstance = new WhatsAppRenderer(translationService);
  }
  return whatsAppRendererInstance;
}

/**
 * Initializes the WhatsAppRenderer
 */
export function initWhatsAppRenderer(
  translationService?: TranslationService
): WhatsAppRenderer {
  whatsAppRendererInstance = new WhatsAppRenderer(translationService);
  return whatsAppRendererInstance;
}
