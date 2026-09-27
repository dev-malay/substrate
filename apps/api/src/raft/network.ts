import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LogEntry, LogId, SnapshotMeta } from "./types.js";

export type RaftClient = {
  vote(term: number, candidateId: number, lastLogId: LogId): Promise<{
    term: number;
    granted: boolean;
  }>;
  appendEntries(
    term: number,
    leaderId: number,
    prevLogId: LogId,
    entries: LogEntry[],
    leaderCommit: number,
  ): Promise<{ term: number; success: boolean; conflictIndex: number }>;
  installSnapshot(
    term: number,
    nodeId: number,
    meta: SnapshotMeta,
    data: Buffer,
  ): Promise<{ term: number }>;
  close(): void;
};


const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(here, "..", "..", "proto", "raft.proto");

const pkg = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true
});

const svc = (grpc.loadPackageDefinition(pkg) as any).raft.RaftService;

function toLogId(id: LogId) {
  return { term: id.term, index: id.index };
}

export function makeRaftClient(addr: string): RaftClient {
  const client = new svc(addr, grpc.credentials.createInsecure());
  const call = <T>(method: string, req: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      client[method](req, (err: Error | null, res: T) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  return {
    async vote(term, candidateId, lastLogId) {
      const res = await call<{ term: number; vote_granted: boolean }>("Vote", {
        term,
        candidate_id: candidateId,
        last_log_id: toLogId(lastLogId)
      });
      return { term: res.term, granted: res.vote_granted };
    },
    async appendEntries(term, leaderId, prevLogId, entries, leaderCommit) {
      const res = await call<{
        term: number;
        success: boolean;
        conflict_index: number;
      }>("AppendEntries", {
        term,
        leader_id: leaderId,
        prev_log_id: toLogId(prevLogId),
        entries: entries.map((e) => ({
          log_id: toLogId(e.logId),
          payload: Buffer.from(JSON.stringify(e.command)),
        })),
        leader_commit: leaderCommit
      });
      return { term: res.term, success: res.success, conflictIndex: res.conflict_index };
    },
    async installSnapshot(term, nodeId, meta, data) {
      const res = await call<{ term: number }>("InstallSnapshot", {
        vote: { term, node_id: nodeId, committed: false },
        meta: {
          last_log_id: toLogId(meta.lastLogId),
          snapshot_id: meta.snapshotId,
        },
        data,
        done: true
      });
      return { term: res.term };
    },
    close() {
      client.close();
    }
  };

}
