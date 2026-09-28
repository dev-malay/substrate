import type { Entity, Relationship } from "../raft/types.js";
import type { PathEdge, RelatedEntity } from "./types.js";

type SessionGraph = {
  entities: Map<string, Entity>;
  outEdges: Relationship[];
  processed: Set<string>;
};

const sessions = new Map<string, SessionGraph>();

function graphFor(sessionId: string): SessionGraph {
  let g = sessions.get(sessionId);
  if (!g) {
    g = {entities: new Map(), outEdges: [], processed: new Set()};
    sessions.set(sessionId, g)
  }
  return g;
}

  
export function applyExtraction(
  sessionId: string,
  messageId: string,
  entities: Entity[],
  relationships: Relationship[]
): boolean {
  const g = graphFor(sessionId);
  const key = messageId;
  if (g.processed.has(key)) return false;
  g.processed.add(key);
  for (const e of entities) {
    if (!g.entities.has(e.name)) g.entities.set(e.name, e);
  }
  for (const r of relationships) {
    if (!g.entities.has(r.from)) g.entities.set(r.from, { name: r.from, entity_type: "Other", attributes: {} });
    if (!g.entities.has(r.to)) g.entities.set(r.to, { name: r.to, entity_type: "Other", attributes: {} });
    if (!g.outEdges.some((x) => x.from === r.from && x.to === r.to && x.relationship_type === r.relationship_type)) {
      g.outEdges.push(r);
    }
  }
  return true;
}

export function isProcessed(sessionId: string, messageId: string): boolean {
  return sessions.get(sessionId)?.processed.has(messageId) || false;
}

export function allEntities(sessionId: string): Entity[] {
  return [...(sessions.get(sessionId)?.entities.values() || [])];
}

export function allRelationships(sessionId: string): Relationship[] {
  return [...(sessions.get(sessionId)?.outEdges || [])];
}

export function getRelated(sessionId: string, name: string): RelatedEntity[] | null {
  const g = sessions.get(sessionId);
  if (!g || !g.entities.has(name)) return null;
  const out: RelatedEntity[] = [];
  for (const e of g.outEdges) {
    if (e.from === name) {
      const target = g.entities.get(e.to);
      out.push({
        name: e.to,
        entity_type: target ? target.entity_type : "Other",
        relationship_type: e.relationship_type,
        direction: "outgoing",
      });
    }
    if (e.to === name) {
      const source = g.entities.get(e.from);
      out.push({
        name: e.from,
        entity_type: source ? source.entity_type : "Other",
        relationship_type: e.relationship_type,
        direction: "incoming",
      });
    }
  }
  return out;
}

export function findPath(sessionId: string, from: string, to: string): PathEdge[] | null {
  const g = sessions.get(sessionId);
  if (!g || !g.entities.has(from) || !g.entities.has(to)) return null;
  const prev = new Map<string, Relationship>();
  const seen = new Set<string>([from]);
  const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) break;
      for (const e of g.outEdges) {
        if (e.from === current && !seen.has(e.to)) {
          seen.add(e.to);
          prev.set(e.to, e);
          queue.push(e.to);
        }
      }
    }
  if (!seen.has(to)) return null;
  const path: PathEdge[] = [];
  let node = to;
  while (node !== from) {
    const edge = prev.get(node)!;
    path.unshift({ from: edge.from, relationship_type: edge.relationship_type, to: edge.to });
    node = edge.from;
  }
  return path;
}

export function deleteSessionGraph(sessionId: string) {
  sessions.delete(sessionId);
}

export function dumpGraphs(): Array<{
  sessionId: string;
  entities: Entity[];
  relationships: Relationship[];
  processed: string[];
}> {
  return [...sessions.entries()].map(([sessionId, g]) => ({
    sessionId,
    entities: [...g.entities.values()],
    relationships: g.outEdges,
    processed: [...g.processed]
  }));
}

export function restoreGraphs(
  items: Array<{
    sessionId: string;
    entities: Entity[];
    relationships: Relationship[];
    processed: string[];
  }>
) {
  sessions.clear();
  for (const item of items) {
    sessions.set(item.sessionId, {
      entities: new Map(item.entities.map((e) => [e.name, e])),
      outEdges: item.relationships,
      processed: new Set(item.processed)
    });
  }
}
