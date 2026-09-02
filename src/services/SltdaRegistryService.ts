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
      text: `SELECT id, property_name, normalized_name, address, normalized_address,
                    district, local_authority, website, normalized_domain, telephone,
                    registration_number, licence_number, licence_valid_until,
                    licence_status, star_rating
             FROM registered_accommodations
             WHERE (licence_valid_until IS NULL OR licence_valid_until >= $2::date)
               AND (licence_status IS NULL OR LOWER(licence_status) NOT IN ('expired', 'cancelled', 'suspended'))
               AND (property_name ILIKE $1 OR address ILIKE $1 OR district ILIKE $1 OR local_authority ILIKE $1)
             ORDER BY property_name
             LIMIT 500`,
      values: [term, asOf.toISOString().slice(0, 10)],
    });
    return result.rows.map(mapRow);
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

function mapRow(row: Record<string, unknown>): RegisteredAccommodation {
  return {
    id: String(row.id),
    propertyName: String(row.property_name),
    normalizedName: String(row.normalized_name),
    address: optionalString(row.address),
    normalizedAddress: optionalString(row.normalized_address),
    district: optionalString(row.district),
    localAuthority: optionalString(row.local_authority),
    website: optionalString(row.website),
    normalizedDomain: optionalString(row.normalized_domain),
    telephone: optionalString(row.telephone),
    registrationNumber: optionalString(row.registration_number),
    licenceNumber: optionalString(row.licence_number),
    licenceValidUntil: row.licence_valid_until ? new Date(String(row.licence_valid_until)).toISOString().slice(0, 10) : undefined,
    licenceStatus: optionalString(row.licence_status),
    starRating: row.star_rating === null || row.star_rating === undefined ? undefined : Number(row.star_rating),
  };
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
