import { env } from '../src/config/environment.js';
import { getEffectiveHotelSupplierConfigs } from '../src/config/hotelSuppliers.js';
import { createConfiguredHotelSupplierAdapters, HotelSupplierOrchestrator } from '../src/services/hotel-engine/index.js';

if (process.env.LITEAPI_SANDBOX_BOOKING_CONFIRM !== 'CONFIRM_ONE_SANDBOX_BOOKING') {
  throw new Error('Explicit one-run sandbox booking confirmation is required');
}
const configs = getEffectiveHotelSupplierConfigs(env.hotelSuppliers).filter((config) => config.supplier === 'liteapi');
const liteapi = configs[0];
if (!env.hotelSuppliers.enabled || !liteapi?.enabled || !liteapi.apiKey || !liteapi.sandboxBookingEnabled) {
  throw new Error('LiteAPI sandbox booking configuration is incomplete');
}
const adapters = createConfiguredHotelSupplierAdapters(configs);
const adapter = adapters[0];
const orchestrator = new HotelSupplierOrchestrator(configs, adapters);
const checkIn = dateAfter(30); const checkOut = dateAfter(32);
const correlationId = `liteapi-sandbox-booking-${Date.now()}`;
const search = await orchestrator.searchHotels({
  destination: process.argv[2] ?? 'Bentota, Sri Lanka', checkIn, checkOut,
  occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'USD', correlationId,
});
const selected = search.rates.find((rate) => rate.available && rate.bookable);
if (!selected) throw new Error('No sandbox rate was eligible for booking confirmation');
const prebook = await adapter.recheckRate(selected, correlationId);
if (!prebook.available || !prebook.prebookToken) throw new Error('Sandbox prebook did not produce a usable token');
const booking = await adapter.book({
  supplierRateId: selected.supplierRateId,
  prebookToken: prebook.prebookToken,
  customerReference: `yana-sandbox-${Date.now()}`,
  guestDetails: [{ firstName: 'Test', lastName: 'Traveler', email: 'traveler@example.test' }],
}, correlationId);
const checked = await adapter.getBooking(booking.supplierBookingId, correlationId);

console.log(JSON.stringify({
  event: 'liteapi_sandbox_booking_smoke', sandbox: true, realChargeAttempted: false,
  searchSucceeded: search.outcomes[0]?.status === 'success', prebookSucceeded: true,
  bookingStatus: booking.status, lookupStatus: checked.status,
  bookingIdReturned: Boolean(booking.supplierBookingId), confirmationCodeReturned: Boolean(booking.confirmationCode),
}, null, 2));

if (booking.status !== 'CONFIRMED' || checked.status !== 'CONFIRMED') process.exitCode = 1;

function dateAfter(days: number): string {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
