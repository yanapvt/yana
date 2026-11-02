export interface PhoneLocale {
  countryCode: string;
  country: string;
  currency: string;
}

const PHONE_LOCALES: Array<[string, string, string]> = [
  ['+971', 'United Arab Emirates', 'AED'],
  ['+966', 'Saudi Arabia', 'SAR'],
  ['+974', 'Qatar', 'QAR'],
  ['+965', 'Kuwait', 'KWD'],
  ['+94', 'Sri Lanka', 'LKR'],
  ['+91', 'India', 'INR'],
  ['+44', 'United Kingdom', 'GBP'],
  ['+61', 'Australia', 'AUD'],
  ['+65', 'Singapore', 'SGD'],
  ['+60', 'Malaysia', 'MYR'],
  ['+49', 'Germany', 'EUR'],
  ['+33', 'France', 'EUR'],
  ['+39', 'Italy', 'EUR'],
  ['+31', 'Netherlands', 'EUR'],
  ['+1', 'United States or Canada', 'USD'],
];

export function getPhoneLocale(phoneNumber: string): PhoneLocale | null {
  const normalized = phoneNumber.startsWith('whatsapp:')
    ? phoneNumber.slice('whatsapp:'.length)
    : phoneNumber;
  const digits = normalized.replace(/[^\d+]/g, '');
  const match = PHONE_LOCALES.find(([countryCode]) => digits.startsWith(countryCode));
  return match ? { countryCode: match[0], country: match[1], currency: match[2] } : null;
}

export function normalizeWhatsAppPhone(userId: string): string {
  return userId.startsWith('whatsapp:') ? userId.slice('whatsapp:'.length) : userId;
}
