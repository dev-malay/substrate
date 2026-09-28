import { badRequest, noContent, notFound } from "../errors.js";
import { clusterWriteRedirect, getRaftNode } from "../cluster.js";
import { ForwardToLeader, NoLeader } from "../raft/consensus.js";
import { sessionAgents, visibility } from "../raft/stateMachine.js";
import { toDot } from "./export.js";
import {
  globalConflicts,
  globalEntities,
  globalPath,
  globalRelated,
  globalRelationships,
  globalSources,
  mergeWithAgent,
} from "./global.js";
import { allEntities, allRelationships } from "./graph.js";

export async function handleGlobal(req: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method.toUpperCase();

  if (parts[0] === "sessions" && parts[2] === "visibility" && parts.length === 3) {
    if (method !== "PUT") return null;
    let body: { visibility?: string };
    try {
      body = (await req.json()) as { visibility?: string };
    } catch {
      return badRequest("visibility required");
    }
    if (body.visibility !== "Shared" && body.visibility !== "Private") {
      return badRequest("visibility required");
    }
    const sessionId = parts[1] || "";
    const node = getRaftNode();
    if (node) {
      try {
        await node.clientWrite({
          kind: "SetSessionVisibility",
          session_id: sessionId,
          visibility: body.visibility,
        });
        return noContent();
      } catch (e) {
        if (e instanceof ForwardToLeader) {
          const target = clusterWriteRedirect(url.pathname);
          if (target) return target;
          return Response.json({ error: "no leader" }, { status: 503 });
        }
        if (e instanceof NoLeader) {
          return Response.json({ error: "no leader" }, { status: 503 });
        }
        throw e;
      }
    }
    visibility.set(sessionId, body.visibility);
    if (body.visibility === "Shared") {
      mergeWithAgent(
        sessionId,
        sessionAgents.get(sessionId),
        0,
        allEntities(sessionId),
        allRelationships(sessionId),
      );
    }
    return noContent();
  }

  if (parts[0] !== "knowledge" || parts[1] !== "global") return null;
  if (method !== "GET") return notFound("not found");

  if (parts.length === 2) {
    return Response.json({ entities: globalEntities(), edges: globalRelationships() });
  }

  if (parts.length === 4 && parts[2] === "entities") {
    const name = decodeURIComponent(parts[3] || "");
    return Response.json({ entity_name: name, related: globalRelated(name) });
  }

  if (parts.length === 5 && parts[2] === "entities" && parts[4] === "sources") {
    const name = decodeURIComponent(parts[3] || "");
    return Response.json({ entity_name: name, sources: globalSources(name) });
  }

  if (parts.length === 3 && parts[2] === "path") {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    return Response.json({ from, to, path: globalPath(from, to) });
  }

  if (parts.length === 3 && parts[2] === "export") {
    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const exported = {
      session_id: "global",
      entities: globalEntities(),
      edges: globalRelationships(),
    };
    if (format === "dot") {
      return new Response(toDot(exported), {
        headers: { "content-type": "text/vnd.graphviz" },
      });
    }
    return Response.json(exported);
  }

  if (parts.length === 3 && parts[2] === "conflicts") {
    return Response.json({ conflicts: globalConflicts() });
  }

  return null;
}
