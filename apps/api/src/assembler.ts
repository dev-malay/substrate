import { config } from "./config.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { contexts, getFacts } from "./store.js";
import { stRecent,stTrimToTokenBudget } from "./stores/shortTerm.js";
import { vectors } from "./stores/vectors.js";
import { tokenCounter } from "./tokens.js";
import type { Message } from "./types.js";
import { EmbeddingCache } from "./adaptive/cache.js";
import { rerank } from "./adaptive/reranker.js";
import { getScore } from "./adaptive/scoring.js";
import { metrics } from "./metrics.js";

const caches = new WeakMap<EmbeddingProvider, EmbeddingCache>();

function cacheFor(provider: EmbeddingProvider): EmbeddingCache {
  let cache = caches.get(provider);
  if (!cache) {
    cache = new EmbeddingCache(provider);
    caches.set(provider, cache);
  }
  return cache;
}

export type AssembleOptions = {
  maxTokens: number;
  threshold: number;
  topK: number;
};

function textTokens(text: string): number {
  return tokenCounter.countTokens(text);
}

function lineTokens(line: string): number {
  return textTokens(line);
}

export async function assembleContext(
  embedder: EmbeddingProvider, sessionId: string, opts: AssembleOptions
): Promise<{ context: string; query_id: string }> {
  const facts = getFacts(sessionId);
  const head = facts.map((f) => `Fact: ${f}`);
  const headTokens = head.reduce((s, l) => s + lineTokens(l), 0);
  const remaining = opts.maxTokens - headTokens;
  if (remaining <= 0) {
    const queryId = crypto.randomUUID();
    contexts.set(queryId, {
      queryId,
      sessionId,
      query: "",
      memoryIds: [],
      ranks: [],
      retrievalScores: [],
      createdAt: Date.now()
    });
    return { context: head.join("\n"), query_id: queryId };
  }

  stTrimToTokenBudget(sessionId, remaining, tokenCounter);
  const recent: Message[] = stRecent(sessionId, Number.MAX_SAFE_INTEGER);
  const shortLines = recent.map((m) => `${m.role}: ${m.content}`);

  let query = "";
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m && m.role === "user") {
      query = m.content;
      break
    }
  }
  if (!query && recent.length > 0) query = recent[recent.length - 1]!.content;

  let memLines: string[] = [];
  let memoryIds: string[] = [];
  let scores: number[] = [];
  if (query) {
    const qvec = await cacheFor(embedder).getOrEmbed(query);
    const widened = Math.max(1, opts.topK * config.retrievalCandidateMultiplier);
    const candidates = vectors.search(sessionId, qvec, widened).map((h) => ({
      memoryId: h.memoryId,
      text: h.text,
      similarity: h.score,
    }));
    const t0 = Date.now();
    const ranked = rerank(
      candidates,
      (id) => getScore(sessionId, id),
      config.retrievalFeedbackWeight,
    )
      .filter((h) => h.similarity >= opts.threshold)
      .slice(0, opts.topK);
    metrics.reranks.inc();
    metrics.rerankDuration.observe({}, (Date.now() - t0) / 1000);
    const used =
      headTokens + shortLines.reduce((s, l) => s + lineTokens(l), 0);
    let budgetLeft = opts.maxTokens - used;
    for (const h of ranked) {
      const line = `Memory: ${h.text}`;
      const cost = lineTokens(line);
      if (cost > budgetLeft) continue;
      budgetLeft -= cost;
      memLines.push(line);
      memoryIds.push(h.memoryId);
      scores.push(h.finalScore);
    }
  }

  const queryId = crypto.randomUUID();
  contexts.set(queryId, {
    queryId,
    sessionId,
    query,
    memoryIds,
    ranks: memoryIds.map((_, i) => i + 1),
    retrievalScores: scores,
    createdAt: Date.now()
  });
  return { context: [...head, ...memLines, ...shortLines].join("\n"), query_id: queryId };
}


