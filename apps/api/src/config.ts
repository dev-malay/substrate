export type AppConfig = {
  redisUrl: string;
  lanceDbPath: string;
  embeddingDimension: number;
  shortTermCount: number;
  tokenBudgetDefault: number;
  similarityThresholdDefault: number;
  topKDefault: number;
  retrievalContextTtlSecs: number;
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function getConfig(): AppConfig {
  return {
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    lanceDbPath: process.env.LANCE_DB_PATH || "./data/lancedb",
    embeddingDimension: intFromEnv("EMBEDDING_DIMENSION", 1536),
    shortTermCount: intFromEnv("SHORT_TERM_COUNT", 20),
    tokenBudgetDefault: intFromEnv("MAX_TOKENS_DEFAULT", 8000),
    similarityThresholdDefault: floatFromEnv("SIMILARITY_THRESHOLD", 0.7),
    topKDefault: intFromEnv("TOP_K_DEFAULT", 10),
    retrievalContextTtlSecs: intFromEnv("RETRIEVAL_CONTEXT_TTL_SECS", 300)
  };

}


export const config = getConfig();

