import { getRaftNode } from "../cluster.js";
import type { KnowledgeExtractor } from "./extractor.js";
import { applyExtraction, isProcessed } from "./graph.js";
import type { KnowledgeJob } from "./types.js";

const queue: KnowledgeJob[] = [];
let maxSize = 500;
let started = false;

export function tryEnqueueKnowledge(job: KnowledgeJob): boolean {
  if (queue.length >= maxSize) return false;
  queue.push(job);
  return true;
}

async function runLoop(extractor: KnowledgeExtractor) {
  for (;;) {
    const job = queue.shift();
    if (!job) {
      await new Promise((r) => setTimeout(r, 25));
      continue;
    }
    const node = getRaftNode();
    if (node && node.role !== "leader") continue;
    if (isProcessed(job.sessionId, job.messageId)) continue;
    try {
      const result = await extractor.extract(job.text);
      if (node) {
        try {
          await node.clientWrite({
            kind: "AddKnowledge",
            session_id: job.sessionId,
            message_id: job.messageId,
            entities: result.entities,
            relationships: result.relationships,
          });
        } catch {
          //leader changed, followers converge on next write 
        }
      } else {
        const words = job.text
          .split(/[^a-zA-Z]+/)
          .map((w) => w.trim())
          .filter((w) => w.length > 3)
          .slice(0, 10);
        applyExtraction(
          job.sessionId,
          job.messageId,
          words.map((w) => ({ name: w, entity_type: "Thing", attributes: {} })),
          [],
        );
      }
    } catch {
      // extraction failure never blocks the queue
    }
  }
}

export function startKnowledgeWorkers(
  extractor: KnowledgeExtractor,
  concurrency = 4,
  channelSize = 500
) {
  maxSize = channelSize;
  if (started) return;
  started = true;
  for (let i = 0; i < Math.max(1, concurrency); i++) {
    void runLoop(extractor);
  }
}
