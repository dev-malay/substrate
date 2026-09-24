import { config } from "./config.js";

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  private dim: number;

  constructor(dim?: number) {
    this.dim = dim && dim > 0 ? dim : config.embeddingDimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array(this.dim).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % this.dim] = (vec[i % this.dim] || 0) + text.charCodeAt(i);
      }
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  }
}

export class RateLimitExceeded extends Error {}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  private model = "text-embedding-3-small";
  private maxRetries = 3;

  constructor(
    private apiKey: string,
    private baseUrl = "https://api.openai.com",
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY required");
  }

  async embed(texts: string[]): Promise<number[][]> {
    let attempt = 0;
    for (;;) {
      const res = await fetch(this.baseUrl + "/v1/embeddings", {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Math.min(1000 * 2 ** attempt, 30000);
        await new Promise((r) => setTimeout(r, wait));
        attempt += 1;
        continue;
      }
      if (res.status === 429) throw new RateLimitExceeded("rate limit");
      if (!res.ok) throw new Error("embeddings failed: " + res.status);
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return json.data.map((d) => d.embedding);
    }
  }
}

export function makeEmbeddingProvider(): EmbeddingProvider {
  const kind = (process.env.EMBEDDING_PROVIDER || "mock").toLowerCase();
  if (kind === "openai") {
    return new OpenAIEmbeddingProvider(
      process.env.OPENAI_API_KEY || "",
      process.env.OPENAI_BASE_URL || "https://api.openai.com",
    );
  }
  return new MockEmbeddingProvider();
  
}
