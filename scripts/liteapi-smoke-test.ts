import { env } from '../src/config/environment.js';
import { getEffectiveHotelSupplierConfigs } from '../src/config/hotelSuppliers.js';
import {
  createConfiguredHotelSupplierAdapters,
  HotelSupplierOrchestrator,
} from '../src/services/hotel-engine/index.js';

const destination = process.argv[2] ?? 'Bentota, Sri Lanka';
const checkIn = process.argv[3] ?? formatDate(addDays(new Date(), 30));
const checkOut = process.argv[4] ?? formatDate(addDays(new Date(), 32));
const configs = getEffectiveHotelSupplierConfigs(env.hotelSuppliers).filter(
  (config) => config.supplier === 'liteapi'
);
const liteapi = configs[0];

if (!env.hotelSuppliers.enabled || !liteapi?.enabled) {
  throw new Error(
    'Enable HOTEL_SUPPLIER_ORCHESTRATION_ENABLED=true and LITEAPI_ENABLED=true in .env'
  );
}
if (!liteapi.apiKey) {
  throw new Error('Set LITEAPI_API_KEY in .env. Do not pass the key on the command line.');
}

const adapters = createConfiguredHotelSupplierAdapters(configs);
const orchestrator = new HotelSupplierOrchestrator(configs, adapters);
const result = await orchestrator.searchHotels({
  destination,
  checkIn,
  checkOut,
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'USD',
  correlationId: `liteapi-smoke-${Date.now()}`,
});
const outcome = result.outcomes[0];

console.log(JSON.stringify({
  destination,
  checkIn,
  checkOut,
  supplier: outcome?.supplier,
  status: outcome?.status,
  attempts: outcome?.attempts,
  durationMs: outcome?.durationMs,
  hotelCount: result.hotels.length,
  rateCount: result.rates.length,
  sampleHotels: result.hotels.slice(0, 3).map((hotel) => ({
    yanaHotelId: hotel.yanaHotelId,
    name: hotel.name,
    destination: hotel.destination,
    rooms: hotel.rooms.length,
  })),
  sampleRates: result.rates.slice(0, 3).map((rate) => ({
    yanaHotelId: rate.yanaHotelId,
    yanaRoomId: rate.yanaRoomId,
    roomName: rate.roomName,
    mealPlan: rate.mealPlan,
    refundable: rate.cancellationPolicy.refundable,
    priceBasis: rate.priceBasis,
    returnedAmount: rate.cost.supplierNet.amount,
    currency: rate.currency,
  })),
  error: outcome?.error,
}, null, 2));

if (outcome?.status !== 'success') process.exitCode = 1;

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
