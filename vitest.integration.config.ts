import { defineConfig } from 'vitest/config';
import 'dotenv/config';

if (!/_test$/i.test(process.env.POSTGRES_DB || '') ||
    !/^\d+$/.test(process.env.REDIS_DB || '') || Number(process.env.REDIS_DB) < 1) {
  throw new Error('Integration tests require a PostgreSQL database ending in _test and Redis database >= 1.');
}

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['src/**/*.integration.test.ts'],
  },
});
