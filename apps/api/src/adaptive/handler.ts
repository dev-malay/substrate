import { badRequest } from "../errors.js";
import { getRaftNode } from "../cluster.js";
import { ForwardToLeader, NoLeader } from "../raft/consensus.js";
import { clusterWriteRedirect } from "../cluster.js";
import { config } from "../config.js";
import { resolveContext } from "../store.js";
import { getScore, nextScore, setScore } from "./scoring.js";


type MemoryFeedback = {
  memory_id: string;
  signal: string;
};

export async function handleFeedback(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts.length !== 3 || parts[0] !== "sessions" || parts[2] !== "feedback" || method !== "POST") {
    return null;
  }
  const sessionId = parts[1] || "";
  let body: { query_id?: string; outcome?: string; memory_feedback?: MemoryFeedback[] };
  try {
    body = (await req.json()) as {
      query_id?: string;
      outcome?: string;
      memory_feedback?: MemoryFeedback[];
    };
  } catch {
    return Response.json({ error: "unprocessable" }, { status: 422 });
  }
  if (typeof body.query_id !== "string" || typeof body.outcome !== "string") {
    return Response.json({ error: "unprocessable" }, { status: 422 });
  }
  const ctx = resolveContext(body.query_id);
  if (!ctx || ctx.sessionId !== sessionId) {
    return Response.json({ applied: 0, status: "query_id not found" });
  }

  const alpha = config.retrievalLearningRate;
  const updates: Array<{ memoryId: string; newScore: number }> = [];
  if (Array.isArray(body.memory_feedback) && body.memory_feedback.length > 0) {
    for (const fb of body.memory_feedback) {
      if (typeof fb.memory_id !== "string") continue;
      const reward = fb.signal === "positive" ? 1 : -1;
      updates.push({
        memoryId: fb.memory_id,
        newScore: nextScore(getScore(sessionId, fb.memory_id), reward, alpha),
      });
    }
  } else {
    const reward =
      (body.outcome === "positive" ? 1 : -1) * config.retrievalSetCreditFactor;
    for (const memoryId of ctx.memoryIds) {
      updates.push({
        memoryId,
        newScore: nextScore(getScore(sessionId, memoryId), reward, alpha)
      });
    }
  }

  const node = getRaftNode();
  let applied = 0;
  if (updates.length === 0) return badRequest("nothing to apply");
  for (const u of updates) {
    if (node) {
      try {
        await node.clientWrite({
          kind: "ApplyFeedback",
          session_id: sessionId,
          memory_id: u.memoryId,
          new_score: u.newScore
        })
        applied += 1;
      } catch (e) {
        if (e instanceof ForwardToLeader) {
          const target = clusterWriteRedirect(url.pathname);
          if (target) return target;
          return Response.json({ error: "no leader" }, { status: 503 });
        }
        if (e instanceof NoLeader) return Response.json({ error: "no leader" },{ status: 503 });
        throw e;
      }
    } else {
      setScore(sessionId, u.memoryId, u.newScore);
      applied += 1;
    }
  }


  if (updates.length === 0) return badRequest("nothing to apply");
  return Response.json({ applied });
}