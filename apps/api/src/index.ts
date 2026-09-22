import { addMessage, listMessages, sessions } from "./store.js";
import type { Role } from "./types.js";

const port = Number(process.env.PORT || 3000);

Bun.serve({
  port,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method.toUpperCase();

    if (method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (method === "POST" && parts.length === 1 && parts[0] === "sessions") {
      const id = crypto.randomUUID();
      sessions.set(id, { id, createdAt: new Date().toISOString() });
      return Response.json({ id });
    }

    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "messages") {
      const sessionId = parts[1] || "";
      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json({ error: "session not found" }, { status: 404 });
      }

      if (method === "GET") {
        return Response.json({ messages: listMessages(sessionId) });
      }

      if (method === "POST") {
        let body: { role?: string; content?: string };
        try {
          body = (await req.json()) as { role?: string; content?: string };
        } catch {
          return Response.json({ error: "bad input" }, { status: 400 });
        }

        const content = (body.content || "").trim();
        if (!content) {
          return Response.json({ error: "content required" }, { status: 400 });
        }

        const role: Role =
          body.role === "assistant" || body.role === "system" ? body.role : "user";

        const msg = {
          id: crypto.randomUUID(),
          sessionId,
          role,
          content,
          createdAt: new Date().toISOString(),
        };
        addMessage(msg);
        return Response.json({ message_id: msg.id });
      }
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log("server running on " + port);
