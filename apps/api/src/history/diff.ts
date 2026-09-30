import type { Entity, Relationship } from "../raft/types.js";
import type { Summary } from "../consolidation/store.js";

export type ReconstructedState = {
  messages: Array<{ id: string; role: string; content: string }>;
  facts: string[];
  entities: Entity[];
  relationships: Relationship[];
  summaries: Summary[];
  at_index: number;
};

export type StateDiff = {
  entities_added: Entity[];
  entities_removed: Entity[];
  relationships_added: Relationship[];
  relationships_removed: Relationship[];
  facts_added: string[];
  facts_removed: string[];
  summaries_added: Summary[];
  summaries_removed: Summary[];
  message_count_delta: number;
};

function entityKey(e: Entity): string {
  return e.name + "" + e.entity_type;
}

function relKey(r: Relationship): string {
  return r.from + "" + r.to + "" + r.relationship_type;
}

export function diffStates(a: ReconstructedState, b: ReconstructedState): StateDiff {
  const aEntities = new Map(a.entities.map((e) => [entityKey(e), e]));
  const bEntities = new Map(b.entities.map((e) => [entityKey(e), e]));
  const aRels = new Map(a.relationships.map((r) => [relKey(r), r]));
  const bRels = new Map(b.relationships.map((r) => [relKey(r), r]));
  const aFacts = new Set(a.facts);
  const bFacts = new Set(b.facts);
  const aSums = new Map(a.summaries.map((s) => [s.id, s]));
  const bSums = new Map(b.summaries.map((s) => [s.id, s]));
  return {
    entities_added: [...bEntities.entries()].filter(([k]) => !aEntities.has(k)).map(([, v]) => v),
    entities_removed: [...aEntities.entries()].filter(([k]) => !bEntities.has(k)).map(([, v]) => v),
    relationships_added: [...bRels.entries()].filter(([k]) => !aRels.has(k)).map(([, v]) => v),
    relationships_removed: [...aRels.entries()].filter(([k]) => !bRels.has(k)).map(([, v]) => v),
    facts_added: [...bFacts].filter((f) => !aFacts.has(f)),
    facts_removed: [...aFacts].filter((f) => !bFacts.has(f)),
    summaries_added: [...bSums.entries()].filter(([k]) => !aSums.has(k)).map(([, v]) => v),
    summaries_removed: [...aSums.entries()].filter(([k]) => !bSums.has(k)).map(([, v]) => v),
    message_count_delta: b.messages.length - a.messages.length,  }
}
