type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

class CounterVec {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    public name: string,
    public help: string,
    public labelNames: string[]
  ) {}
  inc(labels: Labels = {}, n = 1) {
    const key = labelKey(labels);
    const row = this.values.get(key) || { labels, value: 0 };
    row.value += n;
    this.values.set(key, row);
  }
  render(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`;
    for (const row of this.values.values()) {
      out += `${this.name}{${labelKey(row.labels)}} ${row.value}\n`;
    }
    return out;
  }
}

class Gauge {
  private value = 0;
  constructor(
    public name: string,
    public help: string,
    private read?: () => number
  ) {}
  set(v: number) {
    this.value = v;
  }
  render(): string {
    const v = this.read ? this.read() : this.value;
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${this.name} ${v}\n`;
  }
}

class HistogramVec {
  private counts = new Map<string, { labels: Labels; buckets: number[]; sum: number; n: number }>();
  constructor(
    public name: string,
    public help: string,
    public labelNames: string[],
    public buckets: number[]
  ) {}
  observe(labels: Labels, value: number) {
    const key = labelKey(labels);
    let row = this.counts.get(key);
    if (!row) {
      row = { labels, buckets: this.buckets.map(() => 0), sum: 0, n: 0 };
      this.counts.set(key, row)
    }
    row.sum += value;
    row.n += 1;
    this.buckets.forEach((b, i) => {
      if (value <= b) row!.buckets[i]! += 1;
    });
  }
  render(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} histogram\n`;
    for (const row of this.counts.values()) {
      const base = labelKey(row.labels);
      this.buckets.forEach((b, i) => {
        out += `${this.name}_bucket{${base ? base + "," : ""}le="${b}"} ${row!.buckets[i]}\n`;
      });
      out += `${this.name}_bucket{${base ? base + "," : ""}le="+Inf"} ${row.n}\n`;
      out += `${this.name}_sum{${base}} ${row.sum}\n`;
      out += `${this.name}_count{${base}} ${row.n}\n`;
    }
    return out;
  }
}

const DUR = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const metrics = {
  messagesAdded: new CounterVec(
    "substrate_memory_messages_added_total",
    "messages added by role",
    ["role"]
  ),
  contextRequests: new CounterVec(
    "substrate_memory_context_requests_total",
    "context assemblies served",
    []
  ),
  embeddingDuration: new HistogramVec(
    "substrate_memory_embedding_duration_seconds",
    "embedding call duration",
    ["model"],
    DUR
  ),
  vectorSearchDuration: new HistogramVec(
    "substrate_memory_vector_search_duration_seconds",
    "vector search duration",
    ["store"],
    DUR
  ),
  storeErrors: new CounterVec(
    "substrate_memory_short_term_store_errors_total",
    "store errors by operation",
    ["operation"]
  ),
  embeddingQueueSize: new Gauge(
    "substrate_memory_embedding_queue_size",
    "pending embed jobs"
  ),
  raftTerm: new Gauge("substrate_raft_term", "current term"),
  raftCommitIndex: new Gauge("substrate_raft_commit_index", "last commit index"),
  raftIsLeader: new Gauge("substrate_raft_is_leader", "1 when leader"),
  raftLeaderChanges: new CounterVec(
    "substrate_raft_leader_changes_total",
    "leader changes seen",
    []
  ),
  knowledgeDuration: new HistogramVec(
    "substrate_knowledge_extraction_duration_seconds",
    "extraction duration",
    ["model"],
    DUR
  ),
  knowledgeEntities: new CounterVec(
    "substrate_knowledge_entities_extracted_total",
    "entities extracted",
    []
  ),
  knowledgeRelationships: new CounterVec(
    "substrate_knowledge_relationships_extracted_total",
    "relationships extracted",
    []
  ),
  knowledgeQueueSize: new Gauge("substrate_knowledge_queue_size", "pending knowledge jobs"),
  snapshotBuilds: new CounterVec("substrate_snapshot_build_total", "snapshots built", []),
  snapshotInstalls: new CounterVec(
    "substrate_snapshot_install_total",
    "snapshots installed",
    []
  ),

  snapshotLastIndex: new Gauge("substrate_snapshot_last_index", "latest snapshot index"),
  globalEntities: new Gauge("substrate_global_entities", "global entity count"),
  globalRelationships: new Gauge("substrate_global_relationships", "global edge count"),
  globalConflicts: new Gauge("substrate_global_conflicts", "global conflict count"),
  consolidations: new CounterVec("substrate_consolidations_total", "consolidations done", []),
  messagesConsolidated: new CounterVec(
    "substrate_messages_consolidated_total",
    "messages trimmed by consolidation",
    [],
  ),

  summaries: new Gauge("substrate_summaries", "stored summaries"),
  consolidationQueueSize: new Gauge(
    "substrate_consolidation_queue_size",
    "pending consolidation jobs",
  ),

  summarizationDuration: new HistogramVec(
    "substrate_summarization_duration_seconds",
    "summarizer duration",
    ["model"],
    DUR,
  ),

  historySnapshots: new Gauge("substrate_history_snapshots", "retained snapshots"),
  checkpoints: new Gauge("substrate_checkpoints", "named checkpoints"),
  reconstructions: new CounterVec(
    "substrate_reconstructions_total",
    "reconstructions run",
    []
  ),

  reconstructionDuration: new HistogramVec(
    "substrate_reconstruction_duration_seconds",
    "reconstruction duration",
    [],
    DUR
  ),

  feedback: new CounterVec(
    "substrate_feedback_total",
    "feedback received",
    ["signal", "mode"]
  ),

  applyFeedback: new CounterVec(
    "substrate_apply_feedback_total",
    "feedback scores applied",
    []
  ),

  reranks: new CounterVec("substrate_retrieval_reranks_total", "reranks run", []),
  rerankDuration: new HistogramVec(
    "substrate_rerank_duration_seconds",
    "rerank duration",
    [],
    DUR
  ),
  cacheHits: new CounterVec("substrate_embedding_cache_hits_total", "cache hits", []),
  cacheMisses: new CounterVec("substrate_embedding_cache_misses_total", "cache misses", [])
};


export function renderMetrics(): string {
  return Object.values(metrics)
    .map((m) => m.render())
    .join("")
}
