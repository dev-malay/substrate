import { badRequest, notFound } from "../errors.js";
import { getRaftNode } from "../cluster.js";
import { ForwardToLeader, NoLeader } from "../raft/consensus.js";
import { clusterWriteRedirect } from "../cluster.js";
import { config } from "../config.js";
import { LogStore } from "../raft/logStore.js";
import {
  createCheckpoint,
  listCheckpoints,
  resolveCheckpoint,
} from "./checkpoint.js";
import { diffStates } from "./diff.js"
import {
  historyEntries,
  OutsideRetention,
  reconstruct,resolveTimestamp
} from "./reconstruct.js";

function logStore(): LogStore {
  return new LogStore(config.raftDbPath);
}

function clusterOnly(): Response | null {
  if (!getRaftNode()) {
    return Response.json({ error: "not implemented" }, { status: 501 });
  }
  return null;
}

export async function handleHistory(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts[0] !== "sessions") return null;
  const sessionId = parts[1] || "";
  const tail = parts.slice(2);

  if (tail.length === 1 && tail[0] === "at" && method === "GET") {
    const gate = clusterOnly();
    if (gate) return gate;
    const store = logStore();
    const hasIndex = url.searchParams.has("index");
    const hasCheckpoint = url.searchParams.has("checkpoint");
    const hasAt = url.searchParams.has("at");
    const count = [hasIndex, hasCheckpoint, hasAt].filter(Boolean).length;
    if (count !== 1) return badRequest("one selector required");
    try {
      if (hasIndex) {
        const n = Number(url.searchParams.get("index"));
        if (!Number.isInteger(n) || n < 0) return badRequest("bad index");
        return Response.json(stateToJson(reconstruct(store, sessionId, n)));
      }
      if (hasCheckpoint) {
        const cp = resolveCheckpoint(sessionId, url.searchParams.get("checkpoint") || "");
        if (!cp) return notFound("checkpoint not found");
        return Response.json(stateToJson(reconstruct(store, sessionId, cp.at_index)));
      }

      const at = url.searchParams.get("at") || "";
      const idx = resolveTimestamp(store, sessionId, at);
      if (idx === null) return notFound("no message at time");
      return Response.json(stateToJson(reconstruct(store, sessionId, idx)));
    } catch (e) {
      if (e instanceof OutsideRetention) {
        return Response.json({ error: "outside retention window" }, { status: 410 });
      }
      throw e;
    }
  }

  if (tail.length === 1 && tail[0] === "history" && method === "GET") {
    const gate = clusterOnly();
    if (gate) return gate;
    const store = logStore();
    return Response.json({
      history: historyEntries(store, sessionId, store.lastIndex())
    });
  }

  if (tail.length === 1 && tail[0] === "diff" && method === "GET") {
    const gate = clusterOnly();
    if (gate) return gate;
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    if (!Number.isInteger(from) || !Number.isInteger(to)) return badRequest("from and to required");
    if (from > to) return badRequest("from must not exceed to");
    const store = logStore();
    try {
      const a = reconstruct(store, sessionId, from);
      const b = reconstruct(store, sessionId, to);
      return Response.json(diffStates(a, b));
    } catch (e) {
      if (e instanceof OutsideRetention) {
        return Response.json({ error: "outside retention window" }, { status: 410 });
      }
      throw e;
    }
  }

  if (tail.length === 1 && tail[0] === "checkpoints") {
    if (method === "GET") {
      return Response.json({ checkpoints: listCheckpoints(sessionId) });
    }
    if (method === "POST") {
      const node = getRaftNode();
      if (!node) {
        return Response.json({ error: "not implemented" }, { status: 501 });
      }
      let body: { name?: string; at_index?: number };
      try {
        body = (await req.json()) as { name?: string; at_index?: number };
      } catch {
        return badRequest("name required");
      }
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return badRequest("name required");
      }
      const atIndex =
        typeof body.at_index === "number" && Number.isInteger(body.at_index) && body.at_index >= 0
          ? body.at_index
          : node.commitIndex;
      try {
        await node.clientWrite({
          kind: "CreateCheckpoint",
          session_id: sessionId,
          name: body.name.trim(),
          at_index: atIndex
        });
      } catch (e) {
        if (e instanceof ForwardToLeader) {
          const target = clusterWriteRedirect(url.pathname);
          if (target) return target;
          return Response.json({ error: "no leader" }, { status: 503 });
        }
        if (e instanceof NoLeader) return Response.json({ error: "no leader" }, { status: 503 });
        throw e;
      }
      const stored = resolveCheckpoint(sessionId, body.name.trim());
      return Response.json(
        { session_id: sessionId, name: body.name.trim(), at_index: stored ? stored.at_index : atIndex },
        { status: 201 },
      );
    }
  }

  return null;
}

function stateToJson(s: ReturnType<typeof reconstruct>) {
  return {
    at_index: s.at_index,
    messages: s.messages,
    facts: s.facts,
    entities: s.entities,
    relationships: s.relationships,
    summaries: s.summaries
  };
}
