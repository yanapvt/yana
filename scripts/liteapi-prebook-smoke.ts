import { env } from '../src/config/environment.js';
import { getEffectiveHotelSupplierConfigs } from '../src/config/hotelSuppliers.js';
import { createConfiguredHotelSupplierAdapters, HotelSupplierOrchestrator } from '../src/services/hotel-engine/index.js';

const configs = getEffectiveHotelSupplierConfigs(env.hotelSuppliers).filter((config) => config.supplier === 'liteapi');
const liteapi = configs[0];
if (!env.hotelSuppliers.enabled || !liteapi?.enabled || !liteapi.apiKey) {
  throw new Error('LiteAPI sandbox search/prebook configuration is incomplete');
}

const adapters = createConfiguredHotelSupplierAdapters(configs);
const orchestrator = new HotelSupplierOrchestrator(configs, adapters);
const checkIn = dateAfter(30);
const checkOut = dateAfter(32);
const search = await orchestrator.searchHotels({
  destination: process.argv[2] ?? 'Bentota, Sri Lanka', checkIn, checkOut,
  occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'USD',
  correlationId: `liteapi-prebook-smoke-${Date.now()}`,
});
const selected = search.rates.find((rate) => rate.available && rate.bookable);
if (!selected) throw new Error('LiteAPI sandbox returned no rate eligible for prebook');
let result;
let diagnostic: string | undefined;
try {
  result = await adapters[0].recheckRate(selected, `liteapi-prebook-smoke-${Date.now()}`);
} catch (error) {
  diagnostic = error instanceof Error && /^LiteAPI (?:request failed with status \d+|prebook response did not contain)/.test(error.message)
    ? error.message
    : 'LiteAPI prebook failed unexpectedly';
}

console.log(JSON.stringify({
  event: 'liteapi_prebook_smoke', bookingAttempted: false, paymentAttempted: false,
  searchStatus: search.outcomes[0]?.status, searchRateCount: search.rates.length,
  requestedMarginPercent: liteapi.marginPercent,
  originalPriceBasis: selected.priceBasis, originalCurrency: selected.currency,
  recheckStatus: result ? 'success' : 'failed', refreshedPriceBasis: result?.rate.priceBasis,
  sameCurrency: result?.rate.currency === selected.currency,
  priceChanged: result ? result.rate.cost.supplierNet.amount !== selected.cost.supplierNet.amount : false,
  prebookTokenReturned: Boolean(result?.prebookToken), diagnostic,
}, null, 2));

if (!result) process.exitCode = 1;

function dateAfter(days: number): string {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
