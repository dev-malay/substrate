import { config } from "../config.js";
import { getRaftNode } from "../cluster.js";
import { SUMMARIZE_PROMPT_VERSION, type Summarizer } from "../knowledge/summarizer.js";
import { listMessages } from "../store.js";
import { addSummary } from "./store.js";
import { stRemoveMessages } from "../stores/shortTerm.js";

export type ConsolidationJob = {
  sessionId: string;
};

const queue: ConsolidationJob[] = [];
const inFlight = new Set<string>();
let maxSize = 100;
let started = false;

export function tryEnqueueConsolidation(job: ConsolidationJob): boolean {
  if (queue.length >= maxSize) return false;
  queue.push(job);
  return true;
}

export function requestConsolidation(sessionId: string): "enqueued" | "full" | "busy" {
  if (inFlight.has(sessionId)) return "busy";
  inFlight.add(sessionId);
  if (!tryEnqueueConsolidation({ sessionId })) {
    inFlight.delete(sessionId);
    return "full";
  }
  return "enqueued";
}

function shouldConsolidate(count: number): boolean {
  return count > config.consolidationThreshold;
}

export function checkSession(sessionId: string) {
  if (inFlight.has(sessionId)) return;
  if (!shouldConsolidate(listMessages(sessionId).length)) return;
  requestConsolidation(sessionId);
}

async function runLoop(summarizer: Summarizer) {
  for (;;) {
    const job = queue.shift();
    if (!job) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    const release = () => inFlight.delete(job.sessionId);
    try {
      const node = getRaftNode();
      if (node && node.role !== "leader") {
        release();
        continue;
      }
      const all = listMessages(job.sessionId);
      if (!shouldConsolidate(all.length)) {
        release();
        continue;
      }
      const cut = all.length - config.consolidationTargetWindow;
      const consumed = all.slice(0, cut);
      const text = await summarizer.summarize(consumed);
      const summaryId = crypto.randomUUID();
      if (node) {
        try {
          await node.clientWrite({
            kind: "ApplySummary",
            session_id: job.sessionId,
            summary_id: summaryId,
            summary_text: text,
            consumed_message_ids: consumed.map((m) => m.id),
            model: summarizer.model,
            prompt_version: SUMMARIZE_PROMPT_VERSION,
          });
        } catch {
          // leader changed, next cycle retries 
        }
      } else {
        addSummary(job.sessionId, {
          id: summaryId,
          text,
          created_at_index: 0,
          consumed_message_ids: consumed.map((m) => m.id),
          consumed_count: consumed.length,
          model: summarizer.model,
          prompt_version: SUMMARIZE_PROMPT_VERSION,
        });
        stRemoveMessages(
          job.sessionId,
          consumed.map((m) => m.id),
        );
      }
    } catch {
      // summarizer failure never blocks the queue 
    }
    release();
  }
}

export function startConsolidationWorkers(
  summarizer: Summarizer,
  concurrency = 2,
  channelSize = 100,
) {
  maxSize = channelSize;
  if (started) return;
  started = true;
  for (let i = 0; i < Math.max(1, concurrency); i++) {
    void runLoop(summarizer);
  }
}
