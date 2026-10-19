import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Twilio WhatsApp transport boundary', () => {
  it('contains transport concerns but no vertical-specific routing imports', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./twilioWhatsAppWebhook.ts', import.meta.url)),
      'utf8'
    );

    expect(source).toContain('normalizeInboundMessage');
    expect(source).toContain('deduplicateWebhook');
    expect(source).toContain('processNormalizedInboundMessage');
    expect(source).not.toMatch(/HotelSearch|RestaurantSearch|ExcursionSearch|LogisticsSearch|ItineraryPlanner/);
    expect(source).not.toMatch(/isHotel|isRestaurant|isExcursion|isLogistics|isItinerary/);
  });
});
