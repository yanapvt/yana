import { describe, expect, it } from 'vitest';
import { SearchFlowEngine } from './SearchFlowEngine.js';

describe('SearchFlowEngine result pagination', () => {
  const engine = new SearchFlowEngine();
  const batches = engine.batchResults(Array.from({ length: 12 }, (_, index) => index + 1));

  it('returns the first, second and third batches with bounded offsets', () => {
    expect(engine.nextPage(batches, -1, 0, 9)).toEqual({ page: [1, 2, 3], nextOffset: 3 });
    expect(engine.nextPage(batches, 0, 3, 9)).toEqual({ page: [4, 5, 6], nextOffset: 6 });
    expect(engine.nextPage(batches, 1, 6, 9)).toEqual({ page: [7, 8, 9], nextOffset: 9 });
    expect(engine.nextPage(batches, 2, 9, 9)).toBeNull();
  });

  it('recovers a missing displayed index from the saved offset', () => {
    expect(engine.nextPage(batches, undefined, 3, 9)).toEqual({ page: [4, 5, 6], nextOffset: 6 });
    expect(engine.nextPage(batches, undefined, 0, 9)).toEqual({ page: [1, 2, 3], nextOffset: 3 });
  });
});
