/**
 * Property Test 15: WhatsApp UI Limit Compliance
 * 
 * Property Statement:
 * For any outbound WhatsApp message, the WhatsApp_Renderer SHALL validate the message 
 * against WhatsApp UI limits (button counts, list item counts, text lengths) before 
 * delivery; messages that exceed limits SHALL be reformatted or fall back to plain text.
 * 
 * **Validates: Requirements 7.7, 15.1, 15.2**
 * 
 * Requirements:
 * - 7.7: THE WhatsApp_Renderer SHALL format hotel results in a WhatsApp-safe structured 
 *        format that complies with WhatsApp UI limits
 * - 15.1: THE WhatsApp_Renderer SHALL validate all outbound messages against WhatsApp UI 
 *         limits (button counts, list item counts, text lengths) before delivery
 * - 15.2: WHEN a WhatsApp UI type is unsupported for a given message, THE WhatsApp_Renderer 
 *         SHALL fall back to plain text delivery
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WhatsAppRenderer,
  WHATSAPP_LIMITS,
  type RenderableContent,
  type ButtonsRenderContent,
  type ListRenderContent,
  type TextRenderContent,
  type ButtonOption,
  type ListRow,
  type ListSection,
} from '../../services/WhatsAppRenderer.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if a rendered message complies with WhatsApp limits
 */
function checkMessageCompliance(messages: any[]): {
  compliant: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  for (const message of messages) {
    switch (message.type) {
      case 'text':
        if (message.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
          violations.push(`Text body exceeds ${WHATSAPP_LIMITS.MAX_TEXT_LENGTH} characters`);
        }
        break;

      case 'buttons':
        if (message.buttons.length > WHATSAPP_LIMITS.MAX_BUTTONS) {
          violations.push(`Button count ${message.buttons.length} exceeds ${WHATSAPP_LIMITS.MAX_BUTTONS}`);
        }
        message.buttons.forEach((btn: ButtonOption, idx: number) => {
          if (btn.title.length > WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) {
            violations.push(`Button ${idx} title exceeds ${WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH} characters`);
          }
        });
        if (message.body && message.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
          violations.push(`Buttons body exceeds ${WHATSAPP_LIMITS.MAX_TEXT_LENGTH} characters`);
        }
        break;

      case 'list':
        if (message.sections.length > WHATSAPP_LIMITS.MAX_LIST_SECTIONS) {
          violations.push(`Section count ${message.sections.length} exceeds ${WHATSAPP_LIMITS.MAX_LIST_SECTIONS}`);
        }
        
        const totalItems = message.sections.reduce(
          (sum: number, section: ListSection) => sum + section.rows.length,
          0
        );
        if (totalItems > WHATSAPP_LIMITS.MAX_LIST_ITEMS) {
          violations.push(`Total list items ${totalItems} exceeds ${WHATSAPP_LIMITS.MAX_LIST_ITEMS}`);
        }

        message.sections.forEach((section: ListSection, sIdx: number) => {
          if (section.title && section.title.length > WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH) {
            violations.push(`Section ${sIdx} title exceeds ${WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH} characters`);
          }
          section.rows.forEach((row: ListRow, rIdx: number) => {
            if (row.title.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH) {
              violations.push(`Section ${sIdx} row ${rIdx} title exceeds ${WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH} characters`);
            }
            if (row.description && row.description.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH) {
              violations.push(`Section ${sIdx} row ${rIdx} description exceeds ${WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH} characters`);
            }
          });
        });

        if (message.body.length > WHATSAPP_LIMITS.MAX_TEXT_LENGTH) {
          violations.push(`List body exceeds ${WHATSAPP_LIMITS.MAX_TEXT_LENGTH} characters`);
        }
        if (message.buttonText.length > WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) {
          violations.push(`List button text exceeds ${WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH} characters`);
        }
        break;
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generate arbitrary text within WhatsApp limits
 */
const validTextArb = fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_TEXT_LENGTH });

/**
 * Generate arbitrary text that exceeds WhatsApp limits
 */
const oversizedTextArb = fc.string({
  minLength: WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 1,
  maxLength: WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 1000,
});

/**
 * Generate arbitrary button with valid title
 */
const validButtonArb: fc.Arbitrary<ButtonOption> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH }),
});

/**
 * Generate arbitrary button with oversized title
 */
const oversizedButtonArb: fc.Arbitrary<ButtonOption> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({
    minLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 1,
    maxLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 50,
  }),
});

/**
 * Generate arbitrary list row with valid fields
 */
const validListRowArb: fc.Arbitrary<ListRow> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH }),
  description: fc.option(
    fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH }),
    { nil: undefined }
  ),
});

/**
 * Generate arbitrary list row with oversized fields
 */
const oversizedListRowArb: fc.Arbitrary<ListRow> = fc.oneof(
  // Oversized title
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    title: fc.string({
      minLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 1,
      maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 50,
    }),
    description: fc.option(
      fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH }),
      { nil: undefined }
    ),
  }),
  // Oversized description
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    title: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH }),
    description: fc.string({
      minLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH + 1,
      maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH + 100,
    }),
  })
);

/**
 * Generate valid text content
 */
const validTextContentArb: fc.Arbitrary<TextRenderContent> = fc.record({
  type: fc.constant('text' as const),
  body: validTextArb,
});

/**
 * Generate oversized text content
 */
const oversizedTextContentArb: fc.Arbitrary<TextRenderContent> = fc.record({
  type: fc.constant('text' as const),
  body: oversizedTextArb,
});

/**
 * Generate valid buttons content (≤ 3 buttons)
 */
const validButtonsContentArb: fc.Arbitrary<ButtonsRenderContent> = fc.record({
  type: fc.constant('buttons' as const),
  body: fc.option(validTextArb, { nil: undefined }),
  buttons: fc.array(validButtonArb, { minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTONS }),
});

/**
 * Generate buttons content that exceeds button count limit
 */
const tooManyButtonsContentArb: fc.Arbitrary<ButtonsRenderContent> = fc.record({
  type: fc.constant('buttons' as const),
  body: fc.option(validTextArb, { nil: undefined }),
  buttons: fc.array(validButtonArb, {
    minLength: WHATSAPP_LIMITS.MAX_BUTTONS + 1,
    maxLength: WHATSAPP_LIMITS.MAX_BUTTONS + 5,
  }),
});

/**
 * Generate buttons content with oversized button titles
 */
const oversizedButtonTitlesContentArb: fc.Arbitrary<ButtonsRenderContent> = fc.record({
  type: fc.constant('buttons' as const),
  body: fc.option(validTextArb, { nil: undefined }),
  buttons: fc.array(oversizedButtonArb, { minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTONS }),
});

/**
 * Generate valid list content (≤ 10 items total)
 */
const validListContentArb: fc.Arbitrary<ListRenderContent> = fc
  .integer({ min: 1, max: WHATSAPP_LIMITS.MAX_LIST_ITEMS })
  .chain((totalItems) => {
    return fc.record({
      type: fc.constant('list' as const),
      body: validTextArb,
      buttonText: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH }),
      sections: fc.array(
        fc.record({
          title: fc.option(
            fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH }),
            { nil: undefined }
          ),
          rows: fc.array(validListRowArb, { minLength: 1, maxLength: totalItems }),
        }),
        { minLength: 1, maxLength: Math.min(3, WHATSAPP_LIMITS.MAX_LIST_SECTIONS) }
      ),
    });
  })
  .filter((content) => {
    const totalItems = content.sections.reduce((sum, section) => sum + section.rows.length, 0);
    return totalItems <= WHATSAPP_LIMITS.MAX_LIST_ITEMS;
  });

/**
 * Generate list content that exceeds item count limit
 */
const tooManyListItemsContentArb: fc.Arbitrary<ListRenderContent> = fc.record({
  type: fc.constant('list' as const),
  body: validTextArb,
  buttonText: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH }),
  sections: fc.array(
    fc.record({
      title: fc.option(
        fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH }),
        { nil: undefined }
      ),
      rows: fc.array(validListRowArb, {
        minLength: WHATSAPP_LIMITS.MAX_LIST_ITEMS + 1,
        maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEMS + 5,
      }),
    }),
    { minLength: 1, maxLength: 1 }
  ),
});

/**
 * Generate list content with oversized row fields
 */
const oversizedListRowsContentArb: fc.Arbitrary<ListRenderContent> = fc.record({
  type: fc.constant('list' as const),
  body: validTextArb,
  buttonText: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH }),
  sections: fc.array(
    fc.record({
      title: fc.option(
        fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_SECTION_TITLE_LENGTH }),
        { nil: undefined }
      ),
      rows: fc.array(oversizedListRowArb, { minLength: 1, maxLength: 5 }),
    }),
    { minLength: 1, maxLength: 3 }
  ),
});

/**
 * Generate any valid content
 */
const validContentArb: fc.Arbitrary<RenderableContent> = fc.oneof(
  validTextContentArb,
  validButtonsContentArb,
  validListContentArb
);

/**
 * Generate any content that violates limits
 */
const violatingContentArb: fc.Arbitrary<RenderableContent> = fc.oneof(
  oversizedTextContentArb,
  tooManyButtonsContentArb,
  oversizedButtonTitlesContentArb,
  tooManyListItemsContentArb,
  oversizedListRowsContentArb
);

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 15: WhatsApp UI Limit Compliance', () => {
  let renderer: WhatsAppRenderer;

  beforeEach(() => {
    renderer = new WhatsAppRenderer();
  });

  // ==========================================================================
  // Core Property: All rendered messages MUST comply with WhatsApp limits
  // ==========================================================================

  it('should never produce messages that violate WhatsApp UI limits for valid content', async () => {
    await fc.assert(
      fc.asyncProperty(validContentArb, async (content) => {
        // Given: Valid content within WhatsApp limits
        
        // When: The renderer produces a WhatsApp message
        const result = await renderer.renderMessage(content, 'en');

        // Then: The rendered message MUST comply with all WhatsApp limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
        expect(compliance.violations).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should always validate content before rendering', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(validContentArb, violatingContentArb),
        async (content) => {
          // Given: Any content (valid or violating)
          
          // When: The renderer processes the content
          const result = await renderer.renderMessage(content, 'en');

          // Then: The result must always be present
          expect(result).toBeDefined();
          expect(result.messages).toBeDefined();
          expect(Array.isArray(result.messages)).toBe(true);
          expect(result.messages.length).toBeGreaterThan(0);
          
          // And: Metadata must indicate whether fallback was applied
          expect(result.metadata).toBeDefined();
          expect(result.metadata).toHaveProperty('fallbackApplied');
          expect(typeof result.metadata!.fallbackApplied).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Requirement 15.1: Validate against WhatsApp UI limits
  // ==========================================================================

  it('should enforce button count limit (≤ 3 buttons)', async () => {
    await fc.assert(
      fc.asyncProperty(tooManyButtonsContentArb, async (content) => {
        // Given: Content with more than 3 buttons
        expect(content.buttons.length).toBeGreaterThan(WHATSAPP_LIMITS.MAX_BUTTONS);
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: The renderer must fall back to plain text
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The rendered message must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should enforce button title length limit (≤ 20 characters)', async () => {
    await fc.assert(
      fc.asyncProperty(oversizedButtonTitlesContentArb, async (content) => {
        // Given: Content with button titles exceeding 20 characters
        const hasOversizedTitle = content.buttons.some(
          (btn) => btn.title.length > WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH
        );
        expect(hasOversizedTitle).toBe(true);
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: The renderer must fall back to plain text
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The rendered message must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should enforce list item count limit (≤ 10 items)', async () => {
    await fc.assert(
      fc.asyncProperty(tooManyListItemsContentArb, async (content) => {
        // Given: Content with more than 10 list items
        const totalItems = content.sections.reduce(
          (sum, section) => sum + section.rows.length,
          0
        );
        expect(totalItems).toBeGreaterThan(WHATSAPP_LIMITS.MAX_LIST_ITEMS);
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: The renderer must fall back to plain text
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The rendered message must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should enforce list item title length limit (≤ 24 characters)', async () => {
    await fc.assert(
      fc.asyncProperty(oversizedListRowsContentArb, async (content) => {
        // Given: Content with list item titles or descriptions exceeding limits
        const hasOversizedField = content.sections.some((section) =>
          section.rows.some(
            (row) =>
              row.title.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH ||
              (row.description && row.description.length > WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH)
          )
        );
        expect(hasOversizedField).toBe(true);
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: The renderer must fall back to plain text
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The rendered message must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should enforce text length limit (≤ 4096 characters)', async () => {
    await fc.assert(
      fc.asyncProperty(oversizedTextContentArb, async (content) => {
        // Given: Content with text exceeding 4096 characters
        expect(content.body.length).toBeGreaterThan(WHATSAPP_LIMITS.MAX_TEXT_LENGTH);
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: The renderer must fall back to plain text (truncated)
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The rendered message must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
        
        // And: Text must be truncated to fit within limits
        expect(result.messages[0].type).toBe('text');
        expect((result.messages[0] as any).body.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_TEXT_LENGTH);
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Requirement 15.2: Fall back to plain text when UI type is unsupported
  // ==========================================================================

  it('should fall back to plain text when content violates limits', async () => {
    await fc.assert(
      fc.asyncProperty(violatingContentArb, async (content) => {
        // Given: Content that violates WhatsApp limits
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: Fallback must be applied
        expect(result.metadata!.fallbackApplied).toBe(true);
        
        // And: The result must be plain text
        expect(result.messages.length).toBeGreaterThan(0);
        expect(result.messages[0].type).toBe('text');
        
        // And: The plain text must comply with limits
        const compliance = checkMessageCompliance(result.messages);
        expect(compliance.compliant).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve content information in plain text fallback', async () => {
    await fc.assert(
      fc.asyncProperty(violatingContentArb, async (content) => {
        // Given: Content that violates WhatsApp limits
        
        // When: The renderer falls back to plain text
        const result = await renderer.renderMessage(content, 'en');

        // Then: The plain text should contain relevant information
        expect(result.messages[0].type).toBe('text');
        const plainText = (result.messages[0] as any).body;
        expect(plainText).toBeDefined();
        expect(plainText.length).toBeGreaterThan(0);
        
        // And: Original type should be recorded in metadata
        expect(result.metadata!.originalType).toBe(content.type);
      }),
      { numRuns: 50 }
    );
  });

  it('should not apply fallback when content is within limits', async () => {
    await fc.assert(
      fc.asyncProperty(validContentArb, async (content) => {
        // Given: Content within WhatsApp limits
        
        // When: The renderer processes the content
        const result = await renderer.renderMessage(content, 'en');

        // Then: Fallback should NOT be applied
        expect(result.metadata!.fallbackApplied).toBe(false);
        
        // And: Original type should be preserved
        expect(result.messages[0].type).toBe(content.type);
      }),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Requirement 7.7: Format hotel results in WhatsApp-safe format
  // ==========================================================================

  it('should handle hotel result formatting within WhatsApp limits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            name: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH }).filter(s => s.trim().length > 0),
            price: fc.integer({ min: 10, max: 10000 }),
            currency: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR'),
            rating: fc.double({ min: 1, max: 5, noNaN: true }),
          }),
          { minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEMS }
        ),
        async (hotels) => {
          // Given: Hotel results within WhatsApp limits
          const hotelListContent: ListRenderContent = {
            type: 'list',
            body: 'Here are the available hotels:',
            buttonText: 'Select',
            sections: [
              {
                title: 'Hotels',
                rows: hotels.map((hotel) => ({
                  id: hotel.id.trim() || 'hotel_' + Math.random().toString(36).substring(7),
                  title: hotel.name.trim() || 'Hotel',
                  description: `${hotel.currency} ${hotel.price} • ${hotel.rating.toFixed(1)}★`,
                })),
              },
            ],
          };

          // When: The renderer formats the hotel results
          const result = await renderer.renderMessage(hotelListContent, 'en');

          // Then: The result must comply with WhatsApp limits
          const compliance = checkMessageCompliance(result.messages);
          expect(compliance.compliant).toBe(true);
          
          // And: No fallback should be needed for valid data
          expect(result.metadata!.fallbackApplied).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Determinism and Consistency
  // ==========================================================================

  it('should produce consistent results for the same input', async () => {
    await fc.assert(
      fc.asyncProperty(validContentArb, async (content) => {
        // Given: Specific content
        
        // When: The renderer processes the same content multiple times
        const result1 = await renderer.renderMessage(content, 'en');
        const result2 = await renderer.renderMessage(content, 'en');
        const result3 = await renderer.renderMessage(content, 'en');

        // Then: All results must be consistent
        expect(result1.metadata!.fallbackApplied).toBe(result2.metadata!.fallbackApplied);
        expect(result2.metadata!.fallbackApplied).toBe(result3.metadata!.fallbackApplied);
        
        expect(result1.messages.length).toBe(result2.messages.length);
        expect(result2.messages.length).toBe(result3.messages.length);
        
        expect(result1.messages[0].type).toBe(result2.messages[0].type);
        expect(result2.messages[0].type).toBe(result3.messages[0].type);
      }),
      { numRuns: 50 }
    );
  });

  it('should never throw exceptions during rendering', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.anything(),
        async (content) => {
          // Given: Any input (even invalid/malformed)
          
          // When: The renderer attempts to process it
          // Then: It should not throw exceptions (may return error or fallback)
          await expect(async () => {
            await renderer.renderMessage(content as any, 'en');
          }).rejects.toThrow(); // Invalid content should throw WhatsAppRendererError
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  it('should handle empty button arrays by falling back', async () => {
    // Given: Buttons content with empty button array
    const emptyButtonsContent: ButtonsRenderContent = {
      type: 'buttons',
      body: 'Choose an option:',
      buttons: [],
    };

    // When: The renderer processes the content
    const result = await renderer.renderMessage(emptyButtonsContent, 'en');

    // Then: Fallback must be applied
    expect(result.metadata!.fallbackApplied).toBe(true);
    expect(result.messages[0].type).toBe('text');
  });

  it('should handle empty list sections by falling back', async () => {
    // Given: List content with empty sections
    const emptyListContent: ListRenderContent = {
      type: 'list',
      body: 'Select an option:',
      buttonText: 'Select',
      sections: [],
    };

    // When: The renderer processes the content
    const result = await renderer.renderMessage(emptyListContent, 'en');

    // Then: Fallback must be applied
    expect(result.metadata!.fallbackApplied).toBe(true);
    expect(result.messages[0].type).toBe('text');
  });

  it('should handle exactly at limit values correctly', async () => {
    // Given: Content with values exactly at the limits
    const atLimitContent: ButtonsRenderContent = {
      type: 'buttons',
      body: 'A'.repeat(WHATSAPP_LIMITS.MAX_TEXT_LENGTH), // Exactly at limit
      buttons: [
        { id: 'btn1', title: 'B'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) },
        { id: 'btn2', title: 'C'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) },
        { id: 'btn3', title: 'D'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH) },
      ],
    };

    // When: The renderer processes the content
    const result = await renderer.renderMessage(atLimitContent, 'en');

    // Then: No fallback should be needed (exactly at limit is valid)
    expect(result.metadata!.fallbackApplied).toBe(false);
    
    // And: The result must comply with limits
    const compliance = checkMessageCompliance(result.messages);
    expect(compliance.compliant).toBe(true);
  });
});
