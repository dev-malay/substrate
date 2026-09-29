import { config } from "./config.js";
import { makeEmbeddingProvider } from "./embeddings.js";
import { badRequest, noContent, noLeader, notFound, queueFull, unprocessable } from "./errors.js";
import {
  clusterWriteRedirect,
  getRaftNode,
  handleCluster,
  setClusterPeers,
  setRaftNode,
} from "./cluster.js";
import { LogStore } from "./raft/logStore.js";
import { ForwardToLeader, NoLeader, RaftNode } from "./raft/consensus.js";
import { decodeSnapshot, restoreSnapshot } from "./raft/snapshot.js";
import { recoverStateMachine } from "./raft/recovery.js";
import { serveRaftGrpc } from "./raft/grpcServer.js";
import type { MemoryCommand } from "./raft/types.js";
import {
  addFact,
  addMessage,
  deleteSession,
  sessionExists,
  sessions,
} from "./store.js";
import type { AddMessageBody, CreateSessionBody, Role } from "./types.js";
import { assembleContext } from "./assembler.js";
import { checkSession, startConsolidationWorkers } from "./consolidation/scheduler.js";
import { handleConsolidation } from "./consolidation/handler.js";
import { makeSummarizer } from "./knowledge/summarizer.js";
import { makeKnowledgeExtractor } from "./knowledge/extractor.js";
import { handleGlobal } from "./knowledge/globalHandler.js";
import { handleKnowledge } from "./knowledge/handler.js";
import { startKnowledgeWorkers, tryEnqueueKnowledge } from "./knowledge/worker.js";
import { startEmbeddingWorkers, tryEnqueue } from "./worker.js";
import { stTrim } from "./stores/shortTerm.js";
import { vectors } from "./stores/vectors.js";

const port = Number(process.env.PORT || 3000);
const embedder = makeEmbeddingProvider();
startEmbeddingWorkers(embedder, config.embeddingMaxConcurrency, config.mpscChannelSize);
startKnowledgeWorkers(
  makeKnowledgeExtractor(),
  config.knowledgeMaxWorkers,
  config.knowledgeChannelSize,
);
startConsolidationWorkers(
  makeSummarizer(),
  config.consolidationMaxWorkers, config.consolidationChannelSize
);

if (config.nodeId !== null && Number.isInteger(config.nodeId)) {
  const logStore = new LogStore(config.raftDbPath);
  const snapshotIndex = recoverStateMachine(logStore);
  const raftNode = new RaftNode(config.nodeId, logStore);
  raftNode.lastApplied = Math.min(snapshotIndex, raftNode.commitIndex);
  raftNode.onSnapshotInstall = async (meta, data) => {
    restoreSnapshot(decodeSnapshot(data));
    logStore.saveSnapshot(meta.lastLogId.index, data);
    logStore.saveCommitted(meta.lastLogId.index);
    raftNode.lastApplied = meta.lastLogId.index;
    raftNode.commitIndex = Math.max(raftNode.commitIndex, meta.lastLogId.index);
  };
  setRaftNode(raftNode);
  setClusterPeers(config.peers);
  const others = config.peers.filter((p) => p.id !== config.nodeId);
  raftNode.start(others, others.map((p) => p.id));
  console.log("raftNode started");
  if (config.raftAddr) serveRaftGrpc(raftNode, config.raftAddr);
}

function raftRedirect(path: string): Response | null {
  return clusterWriteRedirect(path);
}

async function writeCommand(path: string, cmd: MemoryCommand): Promise<Response | null> {
  const n = getRaftNode();
  if (!n) return null;
  try {
    await n.clientWrite(cmd);
    return noContent();
  } catch (e) {
    if (e instanceof ForwardToLeader) {
      const target = clusterWriteRedirect(path);
      if (target) return target;
      return noLeader();
    }
    if (e instanceof NoLeader) return noLeader();
    throw e;
  }
}

function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeFloat(value: string | null, fallback: number): number | null {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

Bun.serve({
  port,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method.toUpperCase();
    const path = url.pathname;

    if (method === "GET" && path === "/health") {
      return new Response(null, { status: 200 });
    }

    const clusterRes = await handleCluster(req, url);
    if (clusterRes) return clusterRes;

    if (method === "POST" && parts.length === 1 && parts[0] === "sessions") {
      let body: CreateSessionBody = {};
      try {
        const text = await req.text();
        if (text.trim().length > 0) body = JSON.parse(text) as CreateSessionBody;
      } catch {
        return badRequest("bad input");
      }
      const id = crypto.randomUUID();
      const agentId =
        typeof body.agent_id === "string" && body.agent_id.trim().length > 0
          ? body.agent_id.trim()
          : undefined;
      const raft = getRaftNode();
      if (raft) {
        try {
          await raft.clientWrite({ kind: "RegisterSession", session_id: id, agent_id: agentId });
          return Response.json({ session_id: id });
        } catch (e) {
          if (e instanceof ForwardToLeader) {
            const target = raftRedirect(path);
            if (target) return target;
            return noLeader();
          }
          if (e instanceof NoLeader) return noLeader();
          throw e;
        }
      }
      sessions.set(id, { id, createdAt: new Date().toISOString(), agentId });
      return Response.json({ session_id: id });
    }

    if (parts.length === 2 && parts[0] === "sessions") {
      const sessionId = parts[1] || "";

      if (method === "DELETE") {
        const viaRaft = await writeCommand(path, { kind: "DeleteSession", session_id: sessionId });
        if (viaRaft) return viaRaft;
        deleteSession(sessionId);
        vectors.deleteSession(sessionId);
        tryEnqueue({ kind: "deleteSession", sessionId });
        return noContent();
      }
    }

    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "messages") {
      const sessionId = parts[1] || "";
      if (method !== "POST") return notFound("not found");
      if (!sessionExists(sessionId) && !sessions.has(sessionId)) {
        sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
      }

      let body: AddMessageBody;
      try {
        body = (await req.json()) as AddMessageBody;
      } catch {
        return unprocessable("role and content required");
      }
      if (typeof body.role !== "string" || typeof body.content !== "string") {
        return unprocessable("role and content required");
      }
      const content = body.content.trim();
      if (!content) return unprocessable("role and content required");

      const role: Role =
        body.role === "assistant" || body.role === "system" ? body.role : "user";
      if (body.role !== "user" && body.role !== "assistant" && body.role !== "system") {
        return unprocessable("role and content required");
      }

      const msg = {
        id: typeof body.id === "string" && body.id.length > 0 ? body.id : crypto.randomUUID(),
        sessionId,
        role,
        content,
        timestamp: new Date().toISOString(),
        embeddingStatus: "pending" as const,
      };
      const viaRaft = await writeCommand(path, {
        kind: "AddMessage",
        session_id: sessionId,
        message: { id: msg.id, role: msg.role, content: msg.content, timestamp: msg.timestamp },
      });
      if (viaRaft) return viaRaft;
      addMessage(msg);
      stTrim(sessionId, config.shortTermCount);
      const queued = tryEnqueue({ kind: "embed", sessionId, messageId: msg.id, text: content });
      if (!queued) return queueFull();
      tryEnqueueKnowledge({ sessionId, messageId: msg.id, text: content });
      checkSession(sessionId);
      return noContent();
    }

    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "context") {
      const sessionId = parts[1] || "";
      if (method !== "GET") return notFound("not found");
      if (!sessionExists(sessionId)) return notFound("session not found");

      const maxTokens = parsePositiveInt(url.searchParams.get("max_tokens"), 8000);
      const threshold = parseNonNegativeFloat(url.searchParams.get("similarity_threshold"), 0.7);
      const topK = parsePositiveInt(url.searchParams.get("long_term_top_k"), 10);
      if (maxTokens === null || threshold === null || topK === null) {
        return badRequest("bad query");
      }

      const recent = await assembleContext(embedder, sessionId, {
        maxTokens,
        threshold,
        topK,
      });
      return Response.json({ context: recent.context, query_id: recent.query_id });
    }

    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "search") {
      const sessionId = parts[1] || "";
      if (method !== "POST") return notFound("not found");

      let body: { query?: string; top_k?: number };
      try {
        body = (await req.json()) as { query?: string; top_k?: number };
      } catch {
        return badRequest("bad input");
      }
      if (typeof body.query !== "string" || body.query.trim().length === 0) {
        return badRequest("query required");
      }
      if (typeof body.top_k !== "number" || !Number.isInteger(body.top_k) || body.top_k <= 0) {
        return badRequest("top_k must be above zero");
      }
      void sessionId;
      const [qvec] = await embedder.embed([body.query.trim()]);
      if (!qvec) return Response.json({ results: [] });
      const hits = vectors.search(sessionId, qvec, body.top_k);
      return Response.json({
        results: hits.map((h) => ({ memory_id: h.memoryId, text: h.text, score: h.score })),
      });
    }

    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "core-memory") {
      const sessionId = parts[1] || "";
      if (method !== "PUT") return notFound("not found");

      let body: { fact?: string };
      try {
        body = (await req.json()) as { fact?: string };
      } catch {
        return badRequest("fact required");
      }
      if (typeof body.fact !== "string" || body.fact.trim().length === 0) {
        return badRequest("fact required");
      }
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() });
      }
      const viaRaft = await writeCommand(path, { kind: "AddFact", session_id: sessionId, fact: body.fact.trim() });
      if (viaRaft) return viaRaft;
      addFact(sessionId, body.fact.trim());
      return noContent();
    }

    const knowledgeRes = await handleKnowledge(req, url);
    if (knowledgeRes) return knowledgeRes;

    const globalRes = await handleGlobal(req, url);
    if (globalRes) return globalRes;

    const consolidationRes = await handleConsolidation(req, url);
    if (consolidationRes) return consolidationRes;

    return notFound("not found");
  },
});

console.log("server running on " + port);

