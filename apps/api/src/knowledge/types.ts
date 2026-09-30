import type { Entity, Relationship } from "../raft/types.js";

export type ExtractionResult = {
  entities: Entity[];
  relationships: Relationship[];
};

export type KnowledgeJob = {
  sessionId: string;
  messageId: string;
  text: string;
};

export type RelatedEntity = {
  name: string;
  entity_type: string;
  relationship_type: string;
  direction: "incoming" | "outgoing";
};

export type PathEdge = {
  from: string;
  relationship_type: string;
  to: string;
};
