export interface SearchResultBase {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  googleMapsUri?: string;
  thumbnailUrl?: string;
}

export interface RankedSearchResult<T extends SearchResultBase> {
  result: T;
  score: number;
  originalIndex: number;
}

export class SearchFlowEngine {
  constructor(
    private readonly batchSize = 3,
    private readonly maxBatches = 3
  ) {}

  limitResults<T>(results: T[]): T[] {
    return results.slice(0, this.batchSize * this.maxBatches);
  }

  batchResults<T>(results: T[]): T[][] {
    const limited = this.limitResults(results);
    const batches: T[][] = [];
    for (let index = 0; index < limited.length; index += this.batchSize) {
      batches.push(limited.slice(index, index + this.batchSize));
    }
    return batches;
  }

  latestBatchIndex(nextOffset: number, resultCount: number): number {
    if (nextOffset <= 0 || resultCount === 0) {
      return -1;
    }

    return Math.min(
      Math.ceil(resultCount / this.batchSize) - 1,
      Math.ceil(nextOffset / this.batchSize) - 1
    );
  }

  nextOffsetForBatch(batchIndex: number, resultCount: number): number {
    return Math.min((batchIndex + 1) * this.batchSize, resultCount);
  }

  tokenize(value: string): string[] {
    return Array.from(
      new Set(
        value
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .toLowerCase()
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3)
      )
    );
  }

  scoreText(searchable: string, terms: string[], weight: number): number {
    const normalized = searchable.toLowerCase();
    return terms.reduce((score, term) => score + (normalized.includes(term) ? weight : 0), 0);
  }
}

export const defaultSearchFlowEngine = new SearchFlowEngine();
