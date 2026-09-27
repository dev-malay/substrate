import type { LogEntry, LogId, MemoryCommand, NodeId, SnapshotMeta } from "./types.js";
import { LogStore } from "./logStore.js";
import { applyCommand } from "./stateMachine.js";
import { makeRaftClient, type RaftClient } from "./network.js";

export class ForwardToLeader extends Error {
  constructor(public leaderId: NodeId) {
    super("forward to leader");
  }
}

export class NoLeader extends Error {}

export type Peer = {
  id: NodeId;
  addr: string;
  httpAddr: string;
};

type Role = "follower" | "candidate" | "leader";

const HEARTBEAT_MS = 250;

function electionTimeout(): number {
  return 300 + Math.floor(Math.random() * 250);
}

export class RaftNode {
  role: Role = "follower";
  term = 0;
  votedFor: NodeId | null = null;
  leaderId: NodeId | null = null;
  commitIndex = 0;
  lastApplied = 0;
  peers = new Map<NodeId, Peer>();
  voters = new Set<NodeId>();
  onSnapshotInstall: ((meta: SnapshotMeta, data: Buffer) => Promise<void>) | null = null;

  private clients = new Map<NodeId, RaftClient>();
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private nextIndex = new Map<NodeId, number>();
  private matchIndex = new Map<NodeId, number>();
  private pendingWrites: Array<{
    index: number;
    resolve: () => void;
    reject: (e: Error) => void;
  }> =[];

  constructor(
    public id: NodeId,
    public store: LogStore,
  ) {
    const vote = store.loadVote();
    this.term = vote.term;
    this.votedFor = vote.votedFor;
    this.commitIndex = store.loadCommitted();
    this.lastApplied = this.commitIndex;
  }

  get lastLogId(): LogId {
    return { term: this.store.lastTerm(), index: this.store.lastIndex() };
  }

  start(initialPeers: Peer[], initialVoters: NodeId[]) {
    for (const p of initialPeers) this.addPeer(p);
    for (const v of initialVoters) this.voters.add(v);
    this.voters.add(this.id);
    this.resetElectionTimer();
    void this.applyLoop();
  }

  stop() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const c of this.clients.values()) c.close();
  }

  addPeer(p: Peer) {
    this.peers.set(p.id, p);
    if (!this.clients.has(p.id)) {
      this.clients.set(p.id, makeRaftClient(p.addr));
    }
  }

  removePeer(id: NodeId) {
    this.peers.delete(id);
    this.clients.get(id)?.close();
    this.clients.delete(id);
    this.voters.delete(id);
    this.nextIndex.delete(id);
    this.matchIndex.delete(id);
  }

  httpAddrFor(id: NodeId): string | undefined {
    return this.peers.get(id)?.httpAddr;
  }

  private resetElectionTimer() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    this.electionTimer = setTimeout(() => void this.startElection(), electionTimeout());
  }

  private async startElection() {
    if (this.role === "leader") return;
    this.term += 1;
    this.role = "candidate";
    this.votedFor = this.id;
    this.leaderId = null;
    this.store.saveVote(this.term, this.id);
    this.resetElectionTimer();

    const voters = [...this.voters].filter((v) => v !== this.id);
    let granted = 1;
    const needed = Math.floor(this.voters.size / 2) + 1;
    const last = this.lastLogId;
    await Promise.all(
      voters.map(async (vid) => {
        const client = this.clients.get(vid);
        if (!client) return
        try {
          const res = await client.vote(this.term, this.id, last);
          if (res.term > this.term) {
            this.term = res.term;
            this.role = "follower";
            this.votedFor = null;
            this.store.saveVote(this.term, null);
            this.resetElectionTimer();
            return;
          }
          if (res.granted && this.role === "candidate") granted += 1
        } catch {
        }
      })
    );
    if (this.role === "candidate" && granted >= needed) {
      await this.becomeLeader();
    }
  }

  private async becomeLeader() {
    this.role = "leader";
    this.leaderId = this.id;
    if (this.electionTimer) clearTimeout(this.electionTimer);
    const last = this.store.lastIndex();
    for (const pid of this.peers.keys()) {
      this.nextIndex.set(pid, last + 1);
      this.matchIndex.set(pid, 0);
    }
    this.store.append(this.term, { kind: "NoOp" });
    await this.replicateAll();
    this.heartbeatTimer = setInterval(() => void this.replicateAll(), HEARTBEAT_MS);
  }

  private async replicateTo(pid: NodeId) {
    const client = this.clients.get(pid);
    if (!client || this.role !== "leader") return;
    const next = this.nextIndex.get(pid) ?? 1;
    const prev = next > 1 ? this.store.get(next - 1) : undefined;
    const prevLogId: LogId = prev ? prev.logId : { term: 0, index: 0 };
    const entries = this.store.entriesIn(next - 1, next + 99);
    try {
      const res = await client.appendEntries(
        this.term,
        this.id,
        prevLogId,
        entries,
        this.commitIndex
      );
      if (res.term > this.term) {
        this.term = res.term;
        this.role = "follower";
        this.votedFor = null;
        this.leaderId = null;
        this.store.saveVote(this.term, null);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.resetElectionTimer();
        return;
      }
      if (res.success) {
        const lastSent = entries.length > 0 ? entries[entries.length - 1]!.logId.index : next - 1;
        this.nextIndex.set(pid, lastSent + 1);
        this.matchIndex.set(pid, lastSent);
        this.advanceCommit();
      } else {
        this.nextIndex.set(pid, Math.max(1, res.conflictIndex || next - 1));
        await this.replicateTo(pid);
      }
    } catch {
    }
  }

  private async replicateAll() {
    if (this.role !== "leader") return;
    await Promise.all([...this.peers.keys()].map((pid) => this.replicateTo(pid)));
    this.advanceCommit();
  }

  private advanceCommit() {
    if (this.role !== "leader") return;
    const match = [...this.voters]
      .map((v) => (v === this.id ? this.store.lastIndex() : (this.matchIndex.get(v) ?? 0)))
      .sort((a, b) => b - a);
    const majority = match[Math.floor(this.voters.size / 2)] ?? 0;
    if (majority > this.commitIndex) {
      const entry = this.store.get(majority);
      if (entry && entry.logId.term === this.term) {
        this.commitIndex = majority;
        this.store.saveCommitted(this.commitIndex);
      }
    }
    for (const w of [...this.pendingWrites]) {
      if (w.index <= this.commitIndex) {
        this.pendingWrites.splice(this.pendingWrites.indexOf(w), 1);
        w.resolve();
      }
    }
  }

  async clientWrite(cmd: MemoryCommand): Promise<number> {
    if (this.role !== "leader") {
      if (this.leaderId !== null) throw new ForwardToLeader(this.leaderId);
      throw new NoLeader();
    }
    const index = this.store.append(this.term, cmd);
    await this.replicateAll();
    if (this.commitIndex < index) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = this.pendingWrites.findIndex((w) => w.index === index);
          if (i >= 0) this.pendingWrites.splice(i, 1);
          reject(new NoLeader());
        }, 5000);
        this.pendingWrites.push({
          index,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        void this.replicateAll();
      });
    }
    return index;
  }

  private async applyLoop() {
    for (;;) {
      while (this.lastApplied < this.commitIndex) {
        const next = this.lastApplied + 1;
        const entry = this.store.get(next);
        if (!entry) break;
        try {
          applyCommand(entry.command);
        } catch {
        }
        this.lastApplied = next;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  handleVote(candidateId: NodeId, term: number, lastLogId: LogId): { term: number; granted: boolean } {
    if (term < this.term) return { term: this.term, granted: false };
    if (term > this.term) {
      this.term = term;
      this.role = "follower";
      this.votedFor = null;
      this.leaderId = null;
      this.store.saveVote(this.term, null);
    }
    const mine = this.lastLogId;
    const upToDate =
      lastLogId.term > mine.term ||
      (lastLogId.term === mine.term && lastLogId.index >= mine.index);
    if ((this.votedFor === null || this.votedFor === candidateId) && upToDate) {
      this.votedFor = candidateId;
      this.store.saveVote(this.term, candidateId);
      this.resetElectionTimer();
      return { term: this.term, granted: true };
    }
    return { term: this.term, granted: false };
  }

  handleAppend(
    term: number,
    leaderId: NodeId,
    prevLogId: LogId,
    entries: LogEntry[],
    leaderCommit: number,
  ): { term: number; success: boolean; conflictIndex: number } {
    if (term < this.term) return { term: this.term, success: false, conflictIndex: 0 };
    this.term = term;
    this.role = "follower";
    this.leaderId = leaderId;
    this.resetElectionTimer();
    if (prevLogId.index > 0) {
      const prev = this.store.get(prevLogId.index);
      if (!prev || prev.logId.term !== prevLogId.term) {
        return { term: this.term, success: false, conflictIndex: this.store.lastIndex() };
      }
    }

    for (const e of entries) {
      const existing = this.store.get(e.logId.index);
      if (existing && existing.logId.term !== e.logId.term) {
        this.store.purge(this.store.lastIndex(), e.logId.index);
      }
      if (!this.store.get(e.logId.index)) {
        this.store.append(e.logId.term, e.command);
      }
    }
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.store.lastIndex());
      this.store.saveCommitted(this.commitIndex);
    }
    return { term: this.term, success: true, conflictIndex: 0 };
  }
  
}


