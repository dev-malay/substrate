import { sessions } from "../store.js";
import { coreDumpAll, coreRestoreAll } from "../stores/core.js";
import { stDumpAll, stRestoreAll } from "../stores/shortTerm.js";
import { dumpSummaries, restoreSummaries } from "../consolidation/store.js";
import { dumpGraphs, restoreGraphs } from "../knowledge/graph.js";
import type { LogStore } from "../raft/logStore.js";
import { applyCommand, suspendSideEffects } from "../raft/stateMachine.js";
import { decodeSnapshot } from "../raft/snapshot.js";
import type { ReconstructedState } from "./diff.js";

export class OutsideRetention extends Error {
  constructor(
    public requested: number,
    public oldest: number
  ) {
    super("outside retention window")}
}

export function historyEntries(
  store: LogStore,
  sessionId: string,
  upTo: number,
): Array<{ index: number; kind: string; session_id: string }> {
  const out: Array<{ index: number; kind: string; session_id: string }> = [];
  for (const entry of store.entriesIn(0, upTo)) {
    const cmd = entry.command;
    if (cmd.kind === "NoOp") continue;
    const sid = (cmd as { session_id?: string }).session_id;
    if (sid !== sessionId) continue
    out.push({ index: entry.logId.index, kind: cmd.kind, session_id: sessionId });
  }
  return out;
}

export function resolveTimestamp(store: LogStore, sessionId: string, at: string): number | null {
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return null;
  let best: number | null = null;
  for (const entry of store.entriesIn(0, store.lastIndex())) {
    const cmd = entry.command;
    if (cmd.kind !== "AddMessage") continue;
    if (cmd.session_id !== sessionId) continue;
    if (Date.parse(cmd.message.timestamp) <= ts) best = entry.logId.index;
  }
  return best;
  
}

export function reconstruct(
  store: LogStore,
  sessionId: string,
  atIndex: number,
): ReconstructedState {
  const oldest = store.oldestRetainedIndex();
  if (atIndex < oldest) throw new OutsideRetention(atIndex, oldest);

  const savedShort = stDumpAll();
  const savedCore = coreDumpAll();
  const savedGraphs = dumpGraphs();
  const savedSums = dumpSummaries();
  const savedSessions = new Map(sessions);

  suspendSideEffects(true);
  try {
    stRestoreAll([]);
    coreRestoreAll([]);
    restoreGraphs([]);
    restoreSummaries([]);
    sessions.clear();
    const snaps = store.listSnapshotIndexes().filter((i) => i <= atIndex);
    const base = snaps.length > 0 ? snaps[snaps.length - 1]! : 0;
    if (base > 0) {
      const latest = store.loadLatestSnapshot();
      if (latest && latest.index === base) {
        const snap = decodeSnapshot(latest.data);
        stRestoreAll(snap.shortTerm);
        coreRestoreAll(snap.coreMemory);
        restoreGraphs(snap.knowledgeGraph);
        restoreSummaries(snap.consolidated);
      } else {
        for (let i = 1; i <= base; i++) {
          const e = store.get(i);
          if (e) {
            try {
              applyCommand(e.command, i);
            } catch {}
          }
        }
      }
    }
    for (let i = base + 1; i <= atIndex; i++) {
      const e = store.get(i);
      if (!e) break;
      try {
        applyCommand(e.command, i);
      } catch { }
    }

    const messages = (stDumpAll().find((s) => s.sessionId === sessionId)?.messages || []).map(
      (m) => ({ id: m.id, role: m.role, content: m.content }),
    );
    return {
      messages,
      facts: coreDumpAll().find((s) => s.sessionId === sessionId)?.facts || [],
      entities: dumpGraphs().find((s) => s.sessionId === sessionId)?.entities || [],
      relationships: dumpGraphs().find((s) => s.sessionId === sessionId)?.relationships || [],
      summaries: dumpSummaries().find(([id]) => id === sessionId)?.[1] || [],
      at_index: atIndex

    }
  } finally {
    suspendSideEffects(false);
    stRestoreAll(savedShort);
    coreRestoreAll(savedCore);
    restoreGraphs(savedGraphs);
    restoreSummaries(savedSums);
    sessions.clear();
    for (const [id, s] of savedSessions) sessions.set(id, s)
      
  }
}
