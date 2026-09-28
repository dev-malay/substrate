import type { Entity, Relationship } from "../raft/types.js";

export type GraphExport = {
  session_id: string;
  entities: Entity[];
  edges: Relationship[];
};

function escapeDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toDot(exported: GraphExport): string {
  const lines = ["digraph knowledge {"];
  for (const e of exported.entities) {
    lines.push(`  "${escapeDot(e.name)}" [label="${escapeDot(e.name)}\\n${escapeDot(e.entity_type)}"];`);
  }
  for (const r of exported.edges) {
    lines.push(
      `  "${escapeDot(r.from)}" -> "${escapeDot(r.to)}" [label="${escapeDot(r.relationship_type)}"];`
    );
  }
  lines.push("}");
  return lines.join("\n");
}
