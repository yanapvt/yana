import { pool } from '../db/connection.js';
import type { HotelBrowseResult } from './GooglePlacesHotelBrowsingService.js';
import type { YanaHotel } from './hotel-engine/types.js';

export interface RegisteredAccommodation {
  id: string;
  propertyName: string;
  normalizedName: string;
  address?: string;
  normalizedAddress?: string;
  district?: string;
  localAuthority?: string;
  website?: string;
  normalizedDomain?: string;
  telephone?: string;
  registrationNumber?: string;
  licenceNumber?: string;
  licenceValidUntil?: string;
  licenceStatus?: string;
  starRating?: number;
}

export interface SltdaRegistryRepository {
  findEligibleByLocation(location: string, asOf: Date): Promise<RegisteredAccommodation[]>;
}

export class PostgresSltdaRegistryRepository implements SltdaRegistryRepository {
  async findEligibleByLocation(location: string, asOf: Date): Promise<RegisteredAccommodation[]> {
    const term = `%${location.trim()}%`;
    const result = await pool.query({
      text: `SELECT record_key, source_key, name, category, stars, rooms, address,
                    local_authority, website, registration_no, licence_no,
                    licence_validity, telephone, latitude, longitude, source_page_url
             FROM srilanka_accommodations
             WHERE (name ILIKE $1 OR address ILIKE $1 OR local_authority ILIKE $1)
             ORDER BY name
             LIMIT 500`,
      values: [term],
    });
    return result.rows.map(mapSriLankaAccommodationRow).filter((record) => isLicenceEligible(record, asOf));
  }
}

export interface VerifiedHotelMatch {
  hotel: YanaHotel;
  registry: RegisteredAccommodation;
  google?: HotelBrowseResult;
  confidence: number;
}

export class SltdaRegistryService {
  constructor(
    private readonly repository: SltdaRegistryRepository = new PostgresSltdaRegistryRepository(),
    private readonly minimumConfidence = 0.8,
    private readonly logger: Pick<Console, 'info' | 'warn'> = console
  ) {}

  async findEligible(location: string, correlationId: string): Promise<RegisteredAccommodation[]> {
    const records = await this.repository.findEligibleByLocation(location, new Date());
    this.logger.info('[SLTDARegistry] registry_lookup_completed', {
      correlationId,
      location,
      eligibleRecords: records.length,
    });
    return records;
  }

  matchHotels(
    hotels: YanaHotel[],
    records: RegisteredAccommodation[],
    googleResults: HotelBrowseResult[],
    correlationId: string
  ): VerifiedHotelMatch[] {
    const matches: VerifiedHotelMatch[] = [];
    for (const hotel of hotels) {
      const candidates = records
        .map((registry) => ({ registry, confidence: matchConfidence(hotel, registry) }))
        .sort((left, right) => right.confidence - left.confidence);
      const best = candidates[0];
      if (!best || best.confidence < this.minimumConfidence) continue;
      const google = googleResults
        .map((entry) => ({ entry, confidence: googleConfidence(hotel, entry) }))
        .sort((left, right) => right.confidence - left.confidence)[0];
      matches.push({
        hotel,
        registry: best.registry,
        google: google && google.confidence >= 0.7 ? google.entry : undefined,
        confidence: best.confidence,
      });
      this.logger.info('[SLTDARegistry] hotel_match_verified', {
        correlationId,
        yanaHotelId: hotel.yanaHotelId,
        registryRecordId: best.registry.id,
        registrationNumber: best.registry.registrationNumber,
        licenceValidUntil: best.registry.licenceValidUntil,
        matchConfidence: best.confidence,
        googleMatched: Boolean(google && google.confidence >= 0.7),
      });
    }
    return matches;
  }
}

export function mapSriLankaAccommodationRow(row: Record<string, unknown>): RegisteredAccommodation {
  const propertyName = optionalString(row.name) ?? '';
  return {
    id: optionalString(row.record_key) ?? optionalString(row.source_key) ?? propertyName,
    propertyName,
    normalizedName: normalize(propertyName),
    address: optionalString(row.address),
    normalizedAddress: row.address ? normalize(String(row.address)) : undefined,
    localAuthority: optionalString(row.local_authority),
    website: optionalString(row.website),
    normalizedDomain: normalizeDomain(optionalString(row.website)),
    telephone: optionalString(row.telephone),
    registrationNumber: optionalString(row.registration_no),
    licenceNumber: optionalString(row.licence_no),
    licenceValidUntil: parseLicenceDate(optionalString(row.licence_validity)),
    starRating: parseStarRating(row.stars),
  };
}

export function isLicenceEligible(record: RegisteredAccommodation, asOf: Date): boolean {
  if (!record.registrationNumber && !record.licenceNumber) return false;
  if (!record.licenceValidUntil) return true;
  return record.licenceValidUntil >= asOf.toISOString().slice(0, 10);
}

function parseLicenceDate(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dayFirst = trimmed.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
  if (dayFirst) return formatDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const namedMonth = trimmed.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
  );
  if (namedMonth) {
    const month = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ].indexOf(namedMonth[2].toLowerCase()) + 1;
    return formatDate(Number(namedMonth[3]), month, Number(namedMonth[1]));
  }
  return undefined;
}

function formatDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function parseStarRating(value: unknown): number | undefined {
  const match = optionalString(value)?.match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const rating = Number(match[0]);
  return rating >= 0 && rating <= 5 ? rating : undefined;
}

function normalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const markdownTarget = value.match(/\]\((https?:\/\/[^)]+)\)/)?.[1];
    const url = markdownTarget ?? value;
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function matchConfidence(hotel: YanaHotel, registry: RegisteredAccommodation): number {
  const hotelName = normalize(hotel.name);
  const registryName = normalize(registry.normalizedName || registry.propertyName);
  let score = hotelName === registryName ? 0.7 : tokenSimilarity(hotelName, registryName) * 0.55;
  const hotelAddress = normalize(`${hotel.address ?? ''} ${hotel.destination}`);
  const registryAddress = normalize(`${registry.normalizedAddress ?? registry.address ?? ''} ${registry.district ?? ''} ${registry.localAuthority ?? ''}`);
  score += tokenSimilarity(hotelAddress, registryAddress) * 0.3;
  return Math.min(1, Number(score.toFixed(3)));
}

function googleConfidence(hotel: YanaHotel, google: HotelBrowseResult): number {
  const name = tokenSimilarity(normalize(hotel.name), normalize(google.name));
  const address = tokenSimilarity(normalize(hotel.address ?? hotel.destination), normalize(google.address ?? ''));
  return name * 0.75 + address * 0.25;
}

function tokenSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const a = new Set(left.split(' ').filter(Boolean));
  const b = new Set(right.split(' ').filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}
