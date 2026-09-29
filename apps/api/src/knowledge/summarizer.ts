import type { Message } from "../types.js";

export interface Summarizer {
  readonly name: string;
  readonly model: string;
  summarize(messages: Message[]): Promise<string>;
}

export const SUMMARIZE_PROMPT_VERSION = "summarize_v1";

export class MockSummarizer implements Summarizer {
  readonly name = "mock";
  readonly model = "mock";

  async summarize(messages: Message[]): Promise<string> {
    const head = messages
      .slice(0, 5)
      .map((m) => `${m.role}: ${m.content.slice(0, 80)}`)
      .join("; ");
    return `Summary of ${messages.length} messages: ${head}`;
  }
}

const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize the conversation in third person, faithfully and compactly. No new facts";

export class OpenAISummarizer implements Summarizer {
  readonly name = "openai";
  readonly model = "gpt-4o-mini";
  private maxRetries = 3;

  constructor(
    private apiKey: string,
    private baseUrl = "https://api.openai.com",
  ) {if (!apiKey) throw new Error("OPENAI_API_KEY required")}

  async summarize(messages: Message[]): Promise<string> {
    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    let attempt = 0;
    for (;;) {
      const res = await fetch(this.baseUrl + "/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [

            { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
            { role: "user", content: transcript }

          ]
        })
      });
      if (res.status === 429 && attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)));
        attempt += 1;
        continue;
      }
      if (!res.ok) throw new Error("summarize failed: " + res.status);
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return json.choices[0]?.message.content || "";
    }
  }
}

export function makeSummarizer(): Summarizer {
  const kind = (process.env.SUMMARIZER || "mock").toLowerCase();
  if (kind === "openai") {
    return new OpenAISummarizer(
      process.env.OPENAI_API_KEY || "",
      process.env.OPENAI_BASE_URL || "https://api.openai.com",
    );
  }
  return new MockSummarizer()

}
