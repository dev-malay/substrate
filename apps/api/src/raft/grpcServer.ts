import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RaftNode } from "./consensus.js";
import type { LogEntry, MemoryCommand } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(here, "..", "..", "proto", "raft.proto");

const pkg = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true
});


const proto = (grpc.loadPackageDefinition(pkg) as any).raft;
type AnyCb = grpc.sendUnaryData<any>;


export function serveRaftGrpc(node: RaftNode, bindAddr: string): grpc.Server {
  const server = new grpc.Server();

  const vote: grpc.handleUnaryCall<unknown, unknown> = (call, callback) => {
    const request = call.request as {
      candidate_id: number;
      term: number;
      last_log_id: { term: number; index: number };
    };
    const last = request.last_log_id || { term: 0, index: 0 };
    const res = node.handleVote(Number(request.candidate_id), Number(request.term), {
      term: Number(last.term),
      index: Number(last.index),
    });
    (callback as AnyCb)(null, { term: res.term, vote_granted: res.granted });
  };

  const appendEntries: grpc.handleUnaryCall<unknown, unknown> = (call, callback) => {
    const request = call.request as {
      term: number;
      leader_id: number;
      prev_log_id: { term: number; index: number };
      entries: Array<any>;
      leader_commit: number;
    };
    const prev = request.prev_log_id || { term: 0, index: 0 };
    const entries: LogEntry[] = (request.entries || []).map((e: any) => ({
      logId: { term: Number(e.log_id.term), index: Number(e.log_id.index) },
      command: JSON.parse(Buffer.from(e.payload).toString()) as MemoryCommand,
    }));
    const res = node.handleAppend(
      Number(request.term),
      Number(request.leader_id),
      { term: Number(prev.term), index: Number(prev.index) },
      entries,
      Number(request.leader_commit),
    );
    (callback as AnyCb)(null, {
      term: res.term,
      success: res.success,
      conflict_index: res.conflictIndex
    });
  };

  const installSnapshot: grpc.handleUnaryCall<unknown, unknown> = (call, callback) => {
    void (async () => {
      try {
        const request = call.request as {
          meta: { last_log_id: { term: number; index: number }; snapshot_id: string };
          data: Uint8Array;
        };
        if (!node.onSnapshotInstall) {
          (callback as AnyCb)(null, { term: node.term });
          return;
        }
        const meta = request.meta || {};
        const last = meta.last_log_id || { term: 0, index: 0 };
        await node.onSnapshotInstall(
          {
            lastLogId: { term: Number(last.term), index: Number(last.index) },
            snapshotId: String(meta.snapshot_id || ""),
          },
          Buffer.from(request.data || []),
        );
        (callback as AnyCb)(null, { term: node.term });
      } catch (err){
         (callback as AnyCb)(err as Error);
       }
    })();
  };

  server.addService(proto.RaftService.service, {
    Vote: vote,
    AppendEntries: appendEntries,
    InstallSnapshot: installSnapshot,
  });

  server.bindAsync(bindAddr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.log("raft grpc bind failed: " + err.message);
      return;
    }
    console.log("raft grpc on " + bindAddr);
  });

  return server;
}
