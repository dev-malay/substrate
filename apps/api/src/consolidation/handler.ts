import { clusterWriteRedirect, getRaftNode } from "../cluster.js";
import { getSummaries } from "./store.js";
import { requestConsolidation } from "./scheduler.js";

export async function handleConsolidation(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  if (parts[0] !== "sessions") return null;
  const sessionId = parts[1] || "";

  if (parts.length === 3 && parts[2] === "summaries" && method === "GET") {
    return Response.json({ summaries: getSummaries(sessionId) });
  }

  if (parts.length === 3 && parts[2] === "consolidate" && method === "POST") {
    const node = getRaftNode()
    if (node && node.role !== "leader") {
      const target = clusterWriteRedirect(url.pathname);
      if (target) return target;
      return Response.json({ error: "no leader" }, { status: 503 });
    }
    const outcome = requestConsolidation(sessionId);
    if (outcome === "full") {
      return Response.json({ error: "queue full" }, { status: 503 });
    }
    return Response.json({ status: "consolidation enqueued" }, { status: 202 })
  }

  return null;
}
