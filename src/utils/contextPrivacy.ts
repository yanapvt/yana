/** Conversation continuity does not need credentials, contact details or bearer links. */
export function sanitizeConversationText(text: string, maxLength = 1000): string {
  return text
    .replace(/https?:\/\/\S*\/(?:forms\/[^/\s]+|itinerary)\/[A-Za-z0-9_-]+/gi, '[secure link omitted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[credential omitted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, '[credential omitted]')
    .replace(/\b(?:api[_ -]?key|booking[_ -]?token|rate[_ -]?token)\s*[:=]\s*\S+/gi, '[token omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, (match) => /\d{4}-\d{2}-\d{2}/.test(match) ? match : '[contact number omitted]')
    .slice(0, maxLength);
}
