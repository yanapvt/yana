import { env } from '../../config/environment.js';
import { getEffectiveHotelSupplierConfigs } from '../../config/hotelSuppliers.js';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import { createConfiguredHotelSupplierAdapters } from './createConfiguredHotelSupplierAdapters.js';
import {
  HotelSupplierOrchestrator,
  type HotelSupplierOrchestratorLogger,
} from './HotelSupplierOrchestrator.js';

export function createConfiguredHotelSupplierOrchestrator(
  adapters?: HotelSupplierAdapter[],
  logger?: HotelSupplierOrchestratorLogger
): HotelSupplierOrchestrator {
  const configs = getEffectiveHotelSupplierConfigs(env.hotelSuppliers);
  return new HotelSupplierOrchestrator(
    configs,
    adapters ?? createConfiguredHotelSupplierAdapters(configs),
    logger,
    undefined,
    env.hotelSuppliers.attributionLoggingEnabled
  );
}
