import { describe, expect, it } from 'vitest';
import {
  getEffectiveHotelSupplierConfigs,
  loadHotelSupplierEnvironment,
} from './hotelSuppliers.js';

describe('hotel supplier environment', () => {
  it('keeps orchestration and every supplier disabled by default', () => {
    const configuration = loadHotelSupplierEnvironment({});
    expect(configuration.enabled).toBe(false);
    expect(configuration.attributionLoggingEnabled).toBe(false);
    expect(configuration.providers.every((provider) => !provider.enabled)).toBe(true);
    expect(configuration.providers.find((provider) => provider.supplier === 'liteapi')).toMatchObject({
      priority: 1,
      timeoutMs: 15_000,
      maxRetries: 2,
    });
  });

  it('enables internal supplier attribution logging independently', () => {
    const configuration = loadHotelSupplierEnvironment({
      HOTEL_SUPPLIER_ATTRIBUTION_LOG_ENABLED: 'true',
    });

    expect(configuration.attributionLoggingEnabled).toBe(true);
  });

  it('loads global policies and supplier overrides without exposing key values', () => {
    const configuration = loadHotelSupplierEnvironment({
      HOTEL_SUPPLIER_ORCHESTRATION_ENABLED: 'true',
      HOTEL_SUPPLIER_TIMEOUT_MS: '12000',
      HOTEL_SUPPLIER_MAX_RETRIES: '3',
      LITEAPI_ENABLED: 'true',
      LITEAPI_API_KEY: 'test-secret',
      LITEAPI_TIMEOUT_MS: '8000',
    });
    const liteapi = configuration.providers.find((provider) => provider.supplier === 'liteapi');

    expect(configuration.enabled).toBe(true);
    expect(liteapi).toMatchObject({ enabled: true, timeoutMs: 8000, maxRetries: 3 });
  });

  it('rejects an enabled supplier without required credentials', () => {
    expect(() =>
      loadHotelSupplierEnvironment({
        HOTEL_SUPPLIER_ORCHESTRATION_ENABLED: 'true',
        LITEAPI_ENABLED: 'true',
      })
    ).toThrow('liteapi requires an API key when enabled');
  });

  it('globally disables configured providers when orchestration is off', () => {
    const configuration = loadHotelSupplierEnvironment({
      LITEAPI_ENABLED: 'true',
      LITEAPI_API_KEY: 'test-secret',
    });
    expect(getEffectiveHotelSupplierConfigs(configuration)[0].enabled).toBe(false);
  });
});
