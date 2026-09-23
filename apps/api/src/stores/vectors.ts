export type ScoredHit = {
  memoryId: string;
  text: string;
  score: number;
};

export class StoreError extends Error {}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class InMemoryVectorStore {
  private items = new Map<string, { sessionId: string; text: string; vector: number[] }>();
  private dimension = 0;

  insert(sessionId: string, messageId: string, text: string, vector: number[]) {
    if (this.items.has(messageId)) return;
    if (this.dimension === 0) this.dimension = vector.length;
    if (vector.length !== this.dimension) {
      throw new StoreError("dimension mismatch");
    }
    this.items.set(messageId, { sessionId, text, vector });
  }

  search(sessionId: string, query: number[], topK: number): ScoredHit[] {
    if (this.dimension !== 0 && query.length !== this.dimension) {
      throw new StoreError("dimension mismatch");
    }
    const out: ScoredHit[] = [];
    for (const [memoryId, item] of this.items) {
      if (item.sessionId !== sessionId) continue;
      out.push({ memoryId, text: item.text, score: cosine(query, item.vector)});
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, topK)
  }

  deleteSession(sessionId: string) {
    for (const [id, item] of [...this.items]) {
      if (item.sessionId === sessionId) this.items.delete(id);
    }
    if (this.items.size === 0) this.dimension = 0;
  }
}


export const vectors = new InMemoryVectorStore();
