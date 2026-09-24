import type { EmbeddingProvider } from "./embeddings.js";
import { shortTermMessages } from "./stores/shortTerm.js";
import { vectors } from "./stores/vectors.js";

export type EmbeddingJob =
  | { kind: "embed"; sessionId: string; messageId: string; text: string }
  | { kind: "deleteSession"; sessionId: string };

const queue: EmbeddingJob[] = [];
let maxSize = 1000;
let started = false;

export function queueSize(): number {
  return queue.length;
}

export function tryEnqueue(job: EmbeddingJob): boolean {
  if (queue.length >= maxSize) return false;
  queue.push(job);
  return true;
}

function setStatus(
  sessionId: string,
  messageId: string,
  status: "processing" | "completed" | "failed",
) {
  const list = shortTermMessages.get(sessionId) || [];
  const msg = list.find((m) => m.id === messageId);
  if (msg) msg.embeddingStatus = status;
}

async function runLoop(provider: EmbeddingProvider) {
  for (;;){
      const job = queue.shift();
      if (!job) {
        await new Promise((r) => setTimeout(r, 25));
        continue
    }
    if (job.kind === "deleteSession") {
      vectors.deleteSession(job.sessionId);
      continue;
    }
    const current = (shortTermMessages.get(job.sessionId) || []).find(
      (m) => m.id === job.messageId
    );
    if (!current) continue;
    if (current.embeddingStatus === "completed" || current.embeddingStatus === "processing") {
      continue;
    }
    setStatus(job.sessionId, job.messageId, "processing");
    try {
      const out = await provider.embed([job.text]);
      const vec = out[0];
      if (!vec) throw new Error("empty embedding");
      vectors.insert(job.sessionId, job.messageId, job.text, vec);
      setStatus(job.sessionId, job.messageId, "completed");
    } catch {
      setStatus(job.sessionId, job.messageId, "failed");
    }
  }
}

export function startEmbeddingWorkers(
  provider: EmbeddingProvider,
  concurrency = 10,
  channelSize = 1000,
) {
  maxSize = channelSize;
  if (started) return;
  started = true;
  for (let i = 0; i < Math.max(1, concurrency); i++) {
    void runLoop(provider);
  }
}
