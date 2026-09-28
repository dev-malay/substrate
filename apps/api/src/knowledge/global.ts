import type { Entity, Relationship } from "../raft/types.js";

type GlobalNode = {
  type: string;
  index: number;
  attrs: Map<string, { value: string; index: number }>;
  provenance: Map<string, string | undefined>;
};

type GlobalEdge = {
  from: string;
  to: string;
  type: string;
  sources: Set<string>;
};

export type Conflict = {
  from: string;
  relationship_type: string;
  targets: string[];
};

const nodes = new Map<string, GlobalNode>();
const edges: GlobalEdge[] = [];

function nodeFor(name: string): GlobalNode {
  let n = nodes.get(name);
  if (!n) {
    n = { type: "Other", index: 0, attrs: new Map(), provenance: new Map() };
    nodes.set(name, n);
  }
  return n;
}

export function mergeWithAgent(
  sessionId: string,
  agentId: string | undefined,
  index: number,
  entities: Entity[],
  relationships: Relationship[]
) {
  for (const e of entities) {
    const n = nodeFor(e.name);
    if (e.entity_type !== "Other" && index >= n.index) {
      n.type = e.entity_type;
      n.index = index;
    }
    for (const [k, v] of Object.entries(e.attributes || {})) {
      const prev = n.attrs.get(k);
      if (!prev || index >= prev.index) n.attrs.set(k, { value: v, index });
    }
    n.provenance.set(sessionId, agentId);
  }
  for (const r of relationships) {
    nodeFor(r.from).provenance.set(sessionId, agentId);
    nodeFor(r.to).provenance.set(sessionId, agentId);
    const existing = edges.find(
      (x) => x.from === r.from && x.to === r.to && x.type === r.relationship_type);
    if (existing) existing.sources.add(sessionId);
    else edges.push({ from: r.from, to: r.to, type: r.relationship_type, sources: new Set([sessionId]) })
  }
}

export function globalEntities(): Entity[] {
  return [...nodes.entries()].map(([name, n]) => ({
    name,
    entity_type: n.type,
    attributes: Object.fromEntries([...n.attrs.entries()].map(([k, v]) => [k, v.value])),
  }));
}

export function globalRelationships(): Relationship[] {
  return edges.map((e) => ({ from: e.from, to: e.to, relationship_type: e.type }));
}

export function globalRelated(name: string) {
  if (!nodes.has(name)) return [];
  const out: Array<{ name: string; entity_type: string; relationship_type: string; direction: "incoming" | "outgoing" }> = [];
  for (const e of edges) {
    if (e.from === name) {
      out.push({
        name: e.to,
        entity_type: nodes.get(e.to)?.type || "Other",
        relationship_type: e.type,
        direction: "outgoing"
      });
    }
    if (e.to === name) {
      out.push({
        name: e.from,
        entity_type: nodes.get(e.from)?.type || "Other",
        relationship_type: e.type,
        direction: "incoming"
      });
    }
  }
  return out;
}

export function globalSources(name: string): string[] {
  return [...(nodes.get(name)?.provenance.keys() || [])];
}

export function globalPath(from: string, to: string) {
  if (!nodes.has(from) || !nodes.has(to)) return null;
  const prev = new Map<string, GlobalEdge>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const e of edges) {
      if (e.from === current && !seen.has(e.to)) {
        seen.add(e.to);
        prev.set(e.to, e);
        queue.push(e.to);
      }
    }
  }
  if (!seen.has(to)) return null;
  const path: Array<{ from: string; relationship_type: string; to: string }> = [];
  let node = to;
  while (node !== from) {
    const e = prev.get(node)!;
    path.unshift({ from: e.from, relationship_type: e.type, to: e.to });
    node = e.from;
  }
  return path;
}

export function globalConflicts(): Conflict[] {
  const byKey = new Map<string, Set<string>>();
  for (const e of edges) {
    const key = e.from + "" + e.type;
    let set = byKey.get(key);
    if (!set) {
      set = new Set();
      byKey.set(key, set);
    }
    set.add(e.to);
  }
  const out: Conflict[] = [];
  for (const [key, targets] of byKey) {
    if (targets.size > 1) {
      const sep = key.lastIndexOf("");
      out.push({
        from: key.slice(0, sep),
        relationship_type: key.slice(sep + 1),
        targets: [...targets]
      });
    }
  }
  return out;
}

export function pruneSession(sessionId: string) {
  for (const [name, n] of [...nodes]) {
    n.provenance.delete(sessionId);
    if (n.provenance.size === 0) nodes.delete(name);
  }
  for (let i = edges.length - 1; i >= 0; i--) {
    edges[i]!.sources.delete(sessionId);
    if (edges[i]!.sources.size === 0) edges.splice(i, 1);
  }
}

export function dumpGlobal() {
  return {
    nodes: [...nodes.entries()].map(([name, n]) => ({
      name,
      type: n.type,
      index: n.index,
      attrs: [...n.attrs.entries()].map(([k, v]) => [k, v.value, v.index] as [string, string, number]),
      provenance: [...n.provenance.entries()],
    })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, type: e.type, sources: [...e.sources] })),
  };
}

export function restoreGlobal(data: ReturnType<typeof dumpGlobal>) {
  nodes.clear();
  edges.length = 0;
  for (const n of data.nodes || []) {
    nodes.set(n.name, {
      type: n.type,
      index: n.index,
      attrs: new Map((n.attrs || []).map(([k, v, idx]) => [k, { value: v, index: idx }])),
      provenance: new Map(n.provenance || []),
    });
  }
  for (const e of data.edges || []) {
    edges.push({ from: e.from, to: e.to, type: e.type, sources: new Set(e.sources) });
  }
}
