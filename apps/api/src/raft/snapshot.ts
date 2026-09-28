import { coreDumpAll, coreRestoreAll } from "../stores/core.js";
import { stDumpAll, stRestoreAll } from "../stores/shortTerm.js";
import { sessions } from "../store.js";
import type { Message } from "../types.js";
import { tryEnqueue } from "../worker.js";
import {
  dumpGraphs,
  restoreGraphs,
} from "../knowledge/graph.js";
import { sessionAgents, visibility } from "./stateMachine.js";
import type { Entity, Relationship, Visibility } from "./types.js";

export const SNAPSHOT_VERSION = 4;

export type SessionMessages = {
  sessionId: string;
  messages: Message[];
};

export type SessionFacts = {
  sessionId: string;
  facts: string[];
};

export type ClusterSnapshot = {
  version: number;
  shortTerm: SessionMessages[];
  coreMemory: SessionFacts[];
  knowledgeGraph: Array<{
    sessionId: string;
    entities: Entity[];
    relationships: Relationship[];
    processed: string[];
  }>;
  globalGraph: null;
  visibility: Array<[string, Visibility]>;
  sessionAgents: Array<[string, string]>;
  consolidated: Array<[string, unknown[]]>;
  memoryScores: Array<[string, Record<string, number>]>;
};

export function buildSnapshot(): ClusterSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    shortTerm: stDumpAll(),
    coreMemory: coreDumpAll(),
    knowledgeGraph: dumpGraphs(),
    globalGraph: null,
    visibility: [...visibility.entries()],
    sessionAgents: [...sessionAgents.entries()],
    consolidated: [],
    memoryScores: []
  };
}

export function restoreSnapshot(snap: Partial<ClusterSnapshot>) {
  sessions.clear();
  stRestoreAll(snap.shortTerm || []);
  coreRestoreAll(snap.coreMemory || []);
  restoreGraphs(
    (snap.knowledgeGraph || []) as Array<{
      sessionId: string;
      entities: Entity[];
      relationships: Relationship[];
      processed: string[];
    }>
  )
  
  visibility.clear();
  for (const [sessionId, value] of snap.visibility || []) {
    visibility.set(sessionId, value);
  }
  sessionAgents.clear();
  for (const [sessionId, agentId] of snap.sessionAgents || []) {
    sessionAgents.set(sessionId, agentId);
  }
  const agentSessions = new Set((snap.sessionAgents || []).map(([id]) => id));
  for (const item of snap.shortTerm || []) {
    if (!sessions.has(item.sessionId)) {
      sessions.set(item.sessionId, {
        id: item.sessionId,
        createdAt: new Date().toISOString(),
        agentId: agentSessions.has(item.sessionId)
          ? sessionAgents.get(item.sessionId)
          : undefined
      });
    }
  }
  for (const item of snap.coreMemory || []) {
    if (!sessions.has(item.sessionId)) {
      sessions.set(item.sessionId, { id: item.sessionId, createdAt: new Date().toISOString() });
    }
  }
  for (const item of snap.shortTerm || []) {
    for (const msg of item.messages) {
      msg.embeddingStatus = "pending";
      tryEnqueue({ kind: "embed", sessionId: item.sessionId, messageId: msg.id, text: msg.content })
    }
  }
}

export function encodeSnapshot(snap: ClusterSnapshot): Buffer {
  return Buffer.from(JSON.stringify(snap));
}

export function decodeSnapshot(data: Buffer): ClusterSnapshot {
  const raw = JSON.parse(data.toString()) as Partial<ClusterSnapshot>;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    shortTerm: raw.shortTerm || [],
    coreMemory: raw.coreMemory || [],
    knowledgeGraph: Array.isArray(raw.knowledgeGraph) ? raw.knowledgeGraph : [],
    globalGraph: null,
    visibility: raw.visibility || [],
    sessionAgents: raw.sessionAgents || [],
    consolidated: raw.consolidated || [],
    memoryScores: raw.memoryScores || []
  };
}
