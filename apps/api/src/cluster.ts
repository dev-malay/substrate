import { badRequest, noContent } from "./errors.js";
import { ForwardToLeader, NoLeader, type Peer, type RaftNode } from "./raft/consensus.js";

export type ClusterConfig = {
  nodeId: number | null;
  raftAddr: string | null;
  advertiseAddr: string | null;
  peers: Peer[];
};

let node: RaftNode | null = null;
let clusterPeers: Peer[] = [];
let initialized = false;

export function setRaftNode(n: RaftNode | null) {
  node = n;
}

export function getRaftNode(): RaftNode | null {
  return node;
}

export function clusterEnabled(): boolean {
  return node !== null;
}

export function redirectTarget(path: string): string | null {
  if (!node || node.role === "leader" || node.leaderId === null) return null;
  const addr = node.httpAddrFor(node.leaderId);
  if (!addr) return null;
  return addr + path;
}

export async function raftWrite<T>(path: string, fn: (n: RaftNode) => Promise<T>): Promise<T> {
  const n = node;
  if (!n) throw new NoLeader();
  try {
    return await fn(n);
  } catch (e) {
    if (e instanceof ForwardToLeader) {
      const target = redirectTarget(path);
      if (target) {
        const err = new Error("redirect:" + target) as Error & { target: string };
        err.target = target;
        throw err;
      }
      throw new NoLeader();
    } throw e
  }
}

export function parsePeer(s: string): Peer | null {
  const parts = s.split(":");
  if (parts.length !== 3) return null;
  const id = Number(parts[0]);
  const host = parts[1];
  const grpcPort = parts[2];
  if (!Number.isInteger(id) || !host || !grpcPort) return null;
  return { id, addr: host + ":" + grpcPort, httpAddr: "http://" + host + ":3000" };
}

export async function handleCluster(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts[0] !== "cluster") return null;
  const n = node
  if (!n) {
    return Response.json({ error: "cluster mode not enabled" }, { status: 503 });
  }

  if (method === "GET" && parts.length === 1) {
    return Response.json({
      node_id: n.id,
      role: n.role,
      leader_id: n.leaderId,
      term: n.term,
      last_applied_index: n.lastApplied,
      members: [...n.peers.values()].map((p) => ({ id: p.id, addr: p.addr }))
    });
  }

  if (method === "POST" && parts.length === 2 && parts[1] === "init") {
    if (initialized) return badRequest("already initialized");
    initialized = true;
    return Response.json({ ok: true });
  }

  if (method === "POST" && parts.length === 2 && parts[1] === "add-learner") {
    let body: { node_id?: number; addr?: string };

    try {
      body = (await req.json()) as { node_id?: number; addr?: string };
    } catch {
      return badRequest("bad input");
    }
    if (typeof body.node_id !== "number" || typeof body.addr !== "string") {
      return badRequest("node_id and addr required");
    }

    const allowed = clusterPeers.some((p) => p.id === body.node_id && p.addr === body.addr);
    if (!allowed) return badRequest("peer not in cluster peers");
    n.addPeer({ id: body.node_id, addr: body.addr, httpAddr: "http://" + body.addr });
    return Response.json({ ok: true });
  }

  if (method === "POST" && parts.length === 2 && parts[1] === "change-membership") {
    let body: { members?: number[] };
    try {
      body = (await req.json()) as { members?: number[] };
    } catch {
      return badRequest("bad input");
    }
    if (!Array.isArray(body.members)) return badRequest("members required");
    const keep = new Set(body.members);
    for (const pid of [...n.peers.keys()]) {
      if (!keep.has(pid)) n.removePeer(pid);
    }
    for (const p of clusterPeers) {
      if (keep.has(p.id) && p.id !== n.id && !n.peers.has(p.id)) n.addPeer(p);
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: "not found" },{ status: 404 });
}

export function setClusterPeers(peers: Peer[]) {
  clusterPeers = peers;
}

export function redirectResponse(target: string): Response {
  return new Response(null, { status: 307, headers: { location: target } });
}

export function clusterWriteRedirect(path: string): Response | null {
  const target = redirectTarget(path);
  if (!target) return null;
  return redirectResponse(target);
}

export function voidCluster() {
  void noContent;
}
