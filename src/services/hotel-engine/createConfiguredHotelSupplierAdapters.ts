import type { HotelSupplierProviderConfig } from '../../config/hotelSuppliers.js';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import { LiteApiSupplierAdapter } from './LiteApiSupplierAdapter.js';

export function createConfiguredHotelSupplierAdapters(
  configs: HotelSupplierProviderConfig[]
): HotelSupplierAdapter[] {
  const adapters: HotelSupplierAdapter[] = [];
  for (const config of configs) {
    if (!config.enabled || !config.baseUrl || !config.apiKey) continue;
    if (config.supplier === 'liteapi') {
      adapters.push(
        new LiteApiSupplierAdapter({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          marginPercent: config.marginPercent,
          sandboxBookingEnabled: config.sandboxBookingEnabled,
        })
      );
    }
  }
  return adapters;
}
