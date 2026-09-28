export type AppConfig = {
  redisUrl: string;
  lanceDbPath: string;
  embeddingDimension: number;
  embeddingProvider: string;
  embeddingMaxConcurrency: number;
  mpscChannelSize: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  shortTermCount: number;
  tokenBudgetDefault: number;
  similarityThresholdDefault: number;
  topKDefault: number;
  retrievalContextTtlSecs: number;
  retrievalCandidateMultiplier: number;
  retrievalFeedbackWeight: number;
  nodeId: number | null;
  raftAddr: string | null;
  advertiseAddr: string | null;
  raftDbPath: string;
  peers: Array<{ id: number; addr: string; httpAddr: string }>;
  snapshotLogThreshold: number;
  historySnapshots: number;
  knowledgeExtractor: string;
  knowledgeMaxWorkers: number;
  knowledgeChannelSize: number;
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

function parsePeers(raw: string): Array<{ id: number; addr: string; httpAddr: string }> {
  const out: Array<{ id: number; addr: string; httpAddr: string }> = [];
  for (const part of raw.split(",")) {
    const cells = part.trim().split(":");
    if (cells.length !== 3) continue;
    const id = Number(cells[0]);
    const host = cells[1];
    const grpcPort = cells[2];
    if (!Number.isInteger(id) || !host || !grpcPort) continue;
    out.push({ id, addr: host + ":" + grpcPort, httpAddr: "http://" + host + ":3000" });
  }
  return out;
}

function parseHttpPeers(
  raw: string,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const id = Number(part.slice(0, idx).trim());
    const url = part.slice(idx + 1).trim();
    if (Number.isInteger(id) && url) out.set(id, url);
  }
  return out;
}

export function getConfig(): AppConfig {
  const peers = parsePeers(process.env.CLUSTER_PEERS || "");
  const httpPeers = parseHttpPeers(process.env.CLUSTER_HTTP_PEERS || "");
  for (const p of peers) {
    const override = httpPeers.get(p.id);
    if (override) p.httpAddr = override;
  }
  const nodeRaw = (process.env.NODE_ID || "").trim();
  return {
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    lanceDbPath: process.env.LANCE_DB_PATH || "./data/lancedb",
    embeddingDimension: intFromEnv("EMBEDDING_DIMENSION", 1536),
    embeddingProvider: process.env.EMBEDDING_PROVIDER || "mock",
    embeddingMaxConcurrency: intFromEnv("EMBEDDING_MAX_CONCURRENCY", 10),
    mpscChannelSize: intFromEnv("MPSC_CHANNEL_SIZE", 1000),
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com",
    shortTermCount: intFromEnv("SHORT_TERM_COUNT", 20),
    tokenBudgetDefault: intFromEnv("MAX_TOKENS_DEFAULT", 8000),
    similarityThresholdDefault: floatFromEnv("SIMILARITY_THRESHOLD", 0.7),
    topKDefault: intFromEnv("TOP_K_DEFAULT", 10),
    retrievalContextTtlSecs: intFromEnv("RETRIEVAL_CONTEXT_TTL_SECS", 300),
    retrievalCandidateMultiplier: intFromEnv("RETRIEVAL_CANDIDATE_MULTIPLIER", 2),
    retrievalFeedbackWeight: floatFromEnv("RETRIEVAL_FEEDBACK_WEIGHT", 1.0),
    nodeId: nodeRaw.length > 0 ? Number(nodeRaw) : null,
    raftAddr: process.env.RAFT_ADDR || null,
    advertiseAddr: process.env.RAFT_ADVERTISE_ADDR || null,
    raftDbPath: process.env.RAFT_DB_PATH || "./data/raft/substrate.redb",
    peers,
    snapshotLogThreshold: intFromEnv("SNAPSHOT_LOG_THRESHOLD", 1000),
    historySnapshots: intFromEnv("HISTORY_SNAPSHOTS", 5),
    knowledgeExtractor: process.env.KNOWLEDGE_EXTRACTOR || "mock",
    knowledgeMaxWorkers: intFromEnv("KNOWLEDGE_MAX_WORKERS", 4),
    knowledgeChannelSize: intFromEnv("KNOWLEDGE_CHANNEL_SIZE", 500)
    
  };

}


export const config = getConfig();

