import { notFound } from "../errors.js";
import { toDot } from "./export.js";
import { allEntities, allRelationships, findPath, getRelated } from "./graph.js";

export async function handleKnowledge(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts[0] !== "sessions" || parts[2] !== "knowledge") return null;
  const sessionId = parts[1] || "";

  if (method === "GET" && parts.length === 3) {
    return Response.json({
      session_id: sessionId,
      entities: allEntities(sessionId),
      edges: allRelationships(sessionId)
    });
  }

  if (method === "GET" && parts.length === 5 && parts[3] === "entities") {
    const name = decodeURIComponent(parts[4] || "");
    const related = getRelated(sessionId, name);
    if (!related) return notFound("entity not found");
    return Response.json({ entity_name: name, related });
  }

  if (method === "GET" && parts.length === 4 && parts[3] === "path") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    return Response.json({ from, to, path: findPath(sessionId, from, to) });
  }

  if (method === "GET" && parts.length === 4 && parts[3] === "export") {
    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const exported = {
      session_id: sessionId,
      entities: allEntities(sessionId),
      edges: allRelationships(sessionId)
    };
    if (format === "dot") {
      return new Response(toDot(exported), {
        headers: { "content-type": "text/vnd.graphviz" }
      });
    }
    return Response.json(exported);
  }

  return null;
}
