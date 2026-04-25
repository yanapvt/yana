/**
 * hotelCard.ts
 *
 * Formats and sends a hotel result as a WhatsApp message sequence.
 *
 * WhatsApp link preview behaviour:
 * ─────────────────────────────────────────────────────────────────────────────
 * When a URL is included in a WhatsApp message body, WhatsApp's crawler
 * fetches the page and reads its Open Graph meta tags (og:title, og:description,
 * og:image). The preview card (thumbnail + title + description) appears
 * automatically below the message — no extra API calls needed.
 *
 * Which URLs generate good previews:
 *   ✅ Hotel's own website (if it has og:image tags)
 *   ✅ Booking.com listing  — always has photo + price + rating in OG tags
 *   ✅ TripAdvisor listing  — always has photo + rating in OG tags
 *   ✅ Google Maps link     — shows a map thumbnail
 *   ❌ Instagram page       — blocks WhatsApp crawler (login wall)
 *   ❌ Facebook page        — blocks WhatsApp crawler for business pages
 *
 * Message sequence sent per hotel:
 *   1. Photo (if photoUrl available) — sent as media attachment
 *   2. Details text — name, price, rating, location, amenities
 *   3. Links — Booking.com / TripAdvisor / website / Google Maps
 *      Each link auto-generates a WhatsApp preview card
 *
 * Usage:
 *   await sendHotelCard(twilioClient, to, fromNumber, hotel);
 */

import twilio from 'twilio';
import type { HotelResult } from '../services/adapters/HotelSearchAdapter.js';

// ============================================================================
// Types
// ============================================================================

interface TwilioClient {
  messages: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
  };
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Sends a hotel result as a WhatsApp message sequence:
 * 1. Photo (if available)
 * 2. Details card (name, price, rating, location, amenities)
 * 3. Link message with the best available booking/info URL
 *    (WhatsApp auto-generates a thumbnail preview from the URL's OG tags)
 */
export async function sendHotelCard(
  twilioClient: TwilioClient,
  to: string,
  from: string,
  hotel: HotelResult
): Promise<void> {
  // ── 1. Photo ──────────────────────────────────────────────────────────────
  if (hotel.photoUrl) {
    await twilioClient.messages.create({
      from,
      to,
      body: `📸 *${hotel.name}*`,
      mediaUrl: [hotel.photoUrl],
    });
  }

  // ── 2. Details text ───────────────────────────────────────────────────────
  const details = buildDetailsText(hotel);
  await twilioClient.messages.create({ from, to, body: details });

  // ── 3. Link with auto-preview ─────────────────────────────────────────────
  // Send the best available URL. WhatsApp crawls it and shows a preview card
  // with the page's og:image thumbnail, og:title, and og:description.
  const linkMessage = buildLinkMessage(hotel);
  if (linkMessage) {
    await twilioClient.messages.create({ from, to, body: linkMessage });
  }
}

/**
 * Sends a compact list of hotel results (name + price + one link each).
 * Used when showing multiple results — keeps it scannable.
 */
export async function sendHotelList(
  twilioClient: TwilioClient,
  to: string,
  from: string,
  hotels: HotelResult[],
  headerText = `Found ${hotels.length} hotel${hotels.length !== 1 ? 's' : ''} 🏨`
): Promise<void> {
  // Header
  await twilioClient.messages.create({ from, to, body: `*${headerText}*\n\nReply with a number for full details.` });

  // One message per hotel — compact format
  for (let i = 0; i < hotels.length; i++) {
    const hotel = hotels[i];
    const stars = hotel.rating > 0 ? '⭐'.repeat(Math.min(Math.round(hotel.rating), 5)) : '';
    const price = hotel.price > 0 ? `${hotel.currency} ${hotel.price.toFixed(0)}/night` : '';

    const lines: string[] = [
      `*${i + 1}. ${hotel.name}*`,
      [stars, price].filter(Boolean).join('  '),
      hotel.location ? `📍 ${hotel.location}` : '',
    ].filter(Boolean);

    // Add the best link — WhatsApp will show a preview thumbnail
    const bestUrl = hotel.bookingComUrl || hotel.tripAdvisorUrl || hotel.websiteUrl || hotel.googleMapsUrl;
    if (bestUrl) {
      lines.push('');
      lines.push(bestUrl);
    }

    await twilioClient.messages.create({ from, to, body: lines.join('\n') });
  }
}

// ============================================================================
// Private helpers
// ============================================================================

function buildDetailsText(hotel: HotelResult): string {
  const lines: string[] = [];

  if (!hotel.photoUrl) {
    // Only show name as header if we didn't already send it with the photo
    lines.push(`🏨 *${hotel.name}*`);
    lines.push('');
  }

  if (hotel.price > 0) {
    lines.push(`💰 *${hotel.currency} ${hotel.price.toFixed(0)}* per night`);
  }

  if (hotel.rating > 0) {
    const stars = '⭐'.repeat(Math.min(Math.round(hotel.rating), 5));
    const reviews = hotel.reviewCount > 0 ? ` (${hotel.reviewCount.toLocaleString()} reviews)` : '';
    lines.push(`${stars} ${hotel.rating.toFixed(1)}/5${reviews}`);
  }

  if (hotel.location) {
    lines.push(`📍 ${hotel.location}`);
  }

  if (hotel.distance > 0) {
    lines.push(`📏 ${hotel.distance.toFixed(1)} km from centre`);
  }

  if (hotel.amenities && hotel.amenities.length > 0) {
    const shown = hotel.amenities.slice(0, 5).join(' · ');
    const more = hotel.amenities.length > 5 ? ` +${hotel.amenities.length - 5} more` : '';
    lines.push('');
    lines.push(`✨ ${shown}${more}`);
  }

  if (hotel.cancellationPolicy && hotel.cancellationPolicy !== 'Contact hotel for details') {
    lines.push('');
    lines.push(`📋 ${hotel.cancellationPolicy}`);
  }

  return lines.join('\n');
}

/**
 * Builds a link message. Priority order:
 *   1. Booking.com — best preview (photo + price + rating in OG tags)
 *   2. TripAdvisor — good preview (photo + rating)
 *   3. Hotel website — preview quality depends on the site
 *   4. Google Maps — shows map thumbnail
 *
 * Instagram and Facebook pages are intentionally excluded because their
 * crawlers block WhatsApp, so no preview would be generated.
 *
 * Each URL is sent on its own line so WhatsApp generates a separate
 * preview card per link.
 */
function buildLinkMessage(hotel: HotelResult): string | null {
  const links: Array<{ label: string; url: string }> = [];

  if (hotel.bookingComUrl) {
    links.push({ label: '🛏 Book on Booking.com', url: hotel.bookingComUrl });
  }
  if (hotel.tripAdvisorUrl) {
    links.push({ label: '⭐ Reviews on TripAdvisor', url: hotel.tripAdvisorUrl });
  }
  if (hotel.websiteUrl) {
    links.push({ label: '🌐 Official website', url: hotel.websiteUrl });
  }
  if (hotel.googleMapsUrl) {
    links.push({ label: '📍 View on Google Maps', url: hotel.googleMapsUrl });
  }

  if (links.length === 0) return null;

  const lines: string[] = ['*More info & booking:*', ''];
  for (const link of links) {
    lines.push(link.label);
    // URL on its own line — WhatsApp generates a preview card for each
    lines.push(link.url);
    lines.push('');
  }

  return lines.join('\n').trim();
}
