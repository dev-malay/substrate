import { badRequest, notFound } from "../errors.js";
import { clusterWriteRedirect, getRaftNode } from "../cluster.js";
import { ForwardToLeader, NoLeader } from "../raft/consensus.js";
import type { MemoryCommand } from "../raft/types.js";
import { resolveContext } from "../store.js";
import { metrics } from "../metrics.js";
import { reweightFromOutcome } from "./reweight.js";
import {
  attachAction,
  memoryReliability,
  outcomeStats,
  recordDecision,
  recordOutcome,
  sessionDecisions,
} from "./store.js";

async function writeOrDirect(path: string, cmd: MemoryCommand): Promise<Response | null> {
  const node = getRaftNode();
  if (!node) return null;
  try {
    await node.clientWrite(cmd);
    return null;
  } catch (e) {
    if (e instanceof ForwardToLeader) {
      const target = clusterWriteRedirect(path);
      if (target) return target;
      return Response.json({ error: "no leader" }, { status: 503 });
    }
    if (e instanceof NoLeader) return Response.json({ error: "no leader" }, { status: 503 });
    throw e;
  }
}

export async function handleOvl(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts[0] !== "sessions" && !(parts[0] === "knowledge" && parts[1] === "outcome-stats")) {
    return null;
  }

  if (parts[0] === "knowledge" && parts[1] === "outcome-stats" && method === "GET") {
    return Response.json(outcomeStats());
  }

  if (parts[0] !== "sessions") return null;
  const sessionId = parts[1] || "";

  if (parts.length === 3 && parts[2] === "decisions" && method === "POST") {
    let body: {
      query_id?: string;
      context?: string;
      choice?: string;
      confidence?: number;
      agent_id?: string;
    };
    try {
      body = (await req.json()) as {
        query_id?: string;
        context?: string;
        choice?: string;
        confidence?: number;
        agent_id?: string;
      };
    } catch {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    if (typeof body.choice !== "string" || body.choice.trim().length === 0) {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    const ctx = body.query_id ? resolveContext(body.query_id) : undefined;
    const id = crypto.randomUUID();
    const decision = {
      id,
      session_id: sessionId,
      query_id: body.query_id,
      context: typeof body.context === "string" ? body.context : ctx?.query || "",
      memory_ids: ctx && ctx.sessionId === sessionId ? ctx.memoryIds : [],
      choice: body.choice.trim(),
      confidence:
        typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 1
          ? body.confidence
          : 0.5,
      agent_id: typeof body.agent_id === "string" ? body.agent_id : undefined,
      created_at: new Date().toISOString(),
      status: "open" as const,
    };
    const routed = await writeOrDirect(url.pathname, {
      kind: "RecordDecision",
      decision,
    });
    if (routed) return routed;
    recordDecision(decision);
    metrics.ovlDecisions.inc();
    return Response.json({ decision_id: id }, { status: 201 });
  }

  if (parts.length === 3 && parts[2] === "decisions" && method === "GET") {
    return Response.json({ decisions: sessionDecisions(sessionId) });
  }

  if (parts.length === 5 && parts[2] === "decisions" && parts[4] === "actions" && method === "POST") {
    const decisionId = parts[3] || "";
    let body: { kind?: string; detail?: string };
    try {
      body = (await req.json()) as { kind?: string; detail?: string };
    } catch {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    if (typeof body.kind !== "string" || body.kind.trim().length === 0) {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    const action = {
      decision_id: decisionId,
      kind: body.kind.trim(),
      detail: typeof body.detail === "string" ? body.detail : "",
      executed_at: new Date().toISOString(),
    };
    const routed = await writeOrDirect(url.pathname, { kind: "AttachAction", action });
    if (routed) return routed;
    if (!attachAction(action)) return notFound("decision not found");
    return Response.json({ ok: true });
  }

  if (parts.length === 5 && parts[2] === "decisions" && parts[4] === "outcome" && method === "POST") {
    const decisionId = parts[3] || "";
    let body: { success?: boolean; profit?: number; metrics?: Record<string, number>; note?: string };
    try {
      body = (await req.json()) as {
        success?: boolean;
        profit?: number;
        metrics?: Record<string, number>;
        note?: string;
      };
    } catch {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    if (typeof body.success !== "boolean") {
      return Response.json({ error: "unprocessable" }, { status: 422 });
    }
    const outcome = {
      decision_id: decisionId,
      success: body.success,
      profit: typeof body.profit === "number" ? body.profit : undefined,
      metrics: body.metrics && typeof body.metrics === "object" ? body.metrics : {},
      note: typeof body.note === "string" ? body.note : undefined,
      recorded_at: new Date().toISOString(),
    };
    const routed = await writeOrDirect(url.pathname, { kind: "RecordOutcome", outcome });
    if (routed) return routed;
    if (!recordOutcome(outcome)) {
      const existing = sessionDecisions(sessionId).find((d) => d.id === decisionId);
      if (!existing) return notFound("decision not found");
      return badRequest("outcome already recorded");
    }
    const reweighted = reweightFromOutcome(decisionId, outcome.success);
    metrics.ovlOutcomes.inc({ success: String(outcome.success) });
    metrics.ovlReweights.inc({}, reweighted);
    return Response.json({ ok: true, reweighted });
  }

  if (parts.length === 3 && parts[2] === "reliability" && method === "GET") {
    return Response.json({ reliability: memoryReliability(sessionId) });
  }

  return null;
}
