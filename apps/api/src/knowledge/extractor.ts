import type { ExtractionResult } from "./types.js";
import type { Entity, Relationship } from "../raft/types.js";

export interface KnowledgeExtractor {
  readonly name: string;
  extract(text: string): Promise<ExtractionResult>;
}

const PATTERNS: Array<{ sep: string; rel: string; objectType: string }> = [
  { sep: " works at ", rel: "works_at", objectType: "Organization" },
  { sep: " knows ", rel: "knows", objectType: "Person" },
  { sep: " likes ", rel: "likes", objectType: "Thing" },
  { sep: " lives in ", rel: "lives_in", objectType: "Place" },
];

function pushUnique(list: Entity[], e: Entity) {
  if (!list.some((x) => x.name === e.name)) list.push(e);
}

export class MockKnowledgeExtractor implements KnowledgeExtractor {
  readonly name = "mock";

  async extract(text: string): Promise<ExtractionResult> {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      for (const p of PATTERNS) {
        const idx = sentence.indexOf(p.sep);
        if (idx < 0) continue;
        const subject = sentence.slice(0, idx).trim();
        const object = sentence.slice(idx + p.sep.length).trim();
        if (!subject || !object) continue;
        pushUnique(entities, { name: subject, entity_type: "Person", attributes: {} });
        pushUnique(entities, { name: object, entity_type: p.objectType, attributes: {} });
        relationships.push({ from: subject, to: object, relationship_type: p.rel });
      }
    }
    return { entities, relationships };
  }
}

const SYSTEM_PROMPT = [
  "Extract named entities and typed relationships as JSON only.",
  'Entity types: Person, Organization, Place, Concept, Event, Other.',
  "Use snake_case relationship types.",
  'Shape: {"entities":[{"name":"","entity_type":"","attributes":{}}],"relationships":[{"from":"","to":"","relationship_type":""}]}'
].join(" ");

export class OpenAIKnowledgeExtractor implements KnowledgeExtractor {
  readonly name = "openai";
  private maxRetries = 3;

  constructor(
    private apiKey: string,
    private baseUrl = "https://api.openai.com",
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY required");
  }

  async extract(text: string): Promise<ExtractionResult> {
    let attempt = 0;
    for (;;) {
      const res = await fetch(this.baseUrl + "/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text }
          ]
        })
      });
      if (res.status === 429 && attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)));
        attempt += 1;
        continue;
      }
      if (!res.ok) throw new Error("extraction failed: " + res.status);
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const parsed = JSON.parse(json.choices[0]?.message.content || "{}") as ExtractionResult;
      return { entities: parsed.entities || [], relationships: parsed.relationships || [] };
    }
  }
}

export function makeKnowledgeExtractor(): KnowledgeExtractor {
  const kind = (process.env.KNOWLEDGE_EXTRACTOR || "mock").toLowerCase()
  if (kind === "openai") {
    return new OpenAIKnowledgeExtractor(
      process.env.OPENAI_API_KEY || "",
      process.env.OPENAI_BASE_URL || "https://api.openai.com")
  }
  return new MockKnowledgeExtractor();
}
