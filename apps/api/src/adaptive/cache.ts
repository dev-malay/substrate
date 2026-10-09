import type { EmbeddingProvider } from "../embeddings.js";
import { metrics } from "../metrics.js";

export class EmbeddingCache {
  hits = 0;
  misses = 0;
  private cache = new Map<string, number[]>();

  constructor(private provider: EmbeddingProvider) {}

  async getOrEmbed(text: string): Promise<number[]> {
    const hit = this.cache.get(text);
    if (hit) {
      this.hits += 1;
      metrics.cacheHits.inc();
      return hit;
    }
    this.misses += 1;
    metrics.cacheMisses.inc();
    const [vec] = await this.provider.embed([text]);
    if (!vec) throw new Error("empty embedding");
    this.cache.set(text, vec);
    return vec;
  }
}
