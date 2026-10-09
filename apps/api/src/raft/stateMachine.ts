import { config } from "../config.js";
import { tryEnqueue } from "../worker.js";
import { coreAdd, coreDelete } from "../stores/core.js";
import { stAdd, stDelete, stTrim } from "../stores/shortTerm.js";
import { vectors } from "../stores/vectors.js";
import { sessions } from "../store.js";
import { metrics } from "../metrics.js";
import { addSummary, deleteSessionSummaries } from "../consolidation/store.js";
import { checkSession } from "../consolidation/scheduler.js";
import { createCheckpoint, deleteSessionCheckpoints } from "../history/checkpoint.js";
import { deleteSessionScores, setScore } from "../adaptive/scoring.js";
import { allEntities, allRelationships, applyExtraction, deleteSessionGraph } from "../knowledge/graph.js";
import { mergeWithAgent, pruneSession } from "../knowledge/global.js";
import { tryEnqueueKnowledge } from "../knowledge/worker.js";
import { stRemoveMessages } from "../stores/shortTerm.js";
import type { MemoryCommand, Visibility } from "./types.js";

export const visibility = new Map<string, Visibility>();
export const sessionAgents = new Map<string, string>();

export let sideEffectsSuspended = false;

export function suspendSideEffects(suspended: boolean) {
  sideEffectsSuspended = suspended;
}


export function applyCommand(cmd: MemoryCommand, index = 0) {
  switch (cmd.kind) {
    case "AddMessage": {
      stAdd({
        id: cmd.message.id,
        sessionId: cmd.session_id,
        role: cmd.message.role as "user" | "assistant" | "system",
        content: cmd.message.content,
        timestamp: cmd.message.timestamp,
        embeddingStatus: "pending"
      });

      stTrim(cmd.session_id, config.shortTermCount);
      const list = sessions.get(cmd.session_id);
      if (!list) {
        sessions.set(cmd.session_id, {
          id: cmd.session_id,
          createdAt: new Date().toISOString(),
        });
      }

      tryEnqueue({
        kind: "embed",
        sessionId: cmd.session_id,
        messageId: cmd.message.id,
        text: cmd.message.content
      });
      if (!sideEffectsSuspended) {
        tryEnqueueKnowledge({ sessionId: cmd.session_id, messageId: cmd.message.id, text: cmd.message.content });
        checkSession(cmd.session_id);
      }
      break;
    }

    case "AddFact": {
      if (!sessions.has(cmd.session_id)) {
        sessions.set(cmd.session_id, {
          id: cmd.session_id,
          createdAt: new Date().toISOString(),
        });
      }
      coreAdd(cmd.session_id, cmd.fact);
      break;
    }

    case "DeleteSession": {
      sessions.delete(cmd.session_id);
      stDelete(cmd.session_id);
      coreDelete(cmd.session_id);
      vectors.deleteSession(cmd.session_id);
      deleteSessionGraph(cmd.session_id);
      pruneSession(cmd.session_id);
      visibility.delete(cmd.session_id);
      sessionAgents.delete(cmd.session_id);
      deleteSessionSummaries(cmd.session_id);
      deleteSessionCheckpoints(cmd.session_id);
      deleteSessionScores(cmd.session_id);
      tryEnqueue({ kind: "deleteSession", sessionId: cmd.session_id });
      break;
    }

    case "RegisterSession": {
      const prev = sessions.get(cmd.session_id);
      sessions.set(cmd.session_id, {
        id: cmd.session_id,
        createdAt: prev ? prev.createdAt : new Date().toISOString(),
        agentId: cmd.agent_id
      });
      if (cmd.agent_id) sessionAgents.set(cmd.session_id, cmd.agent_id);
      break
    }

    case "SetSessionVisibility": {
      visibility.set(cmd.session_id, cmd.visibility);
      if (cmd.visibility === "Shared") {
        mergeWithAgent(
          cmd.session_id,
          sessionAgents.get(cmd.session_id),
          index,
          allEntities(cmd.session_id),
          allRelationships(cmd.session_id),
        );
      }
      break;
    }

    case "AddKnowledge": {
      applyExtraction(cmd.session_id, cmd.message_id, cmd.entities, cmd.relationships);
      if (visibility.get(cmd.session_id) === "Shared") {
        mergeWithAgent(
          cmd.session_id,
          sessionAgents.get(cmd.session_id),
          index,
          cmd.entities,
          cmd.relationships,
        );
      }
      break;
    }
    case "ApplySummary": {
      addSummary(cmd.session_id, {
        id: cmd.summary_id,
        text: cmd.summary_text,
        created_at_index: index,
        consumed_message_ids: cmd.consumed_message_ids,
        consumed_count: cmd.consumed_message_ids.length,
        model: cmd.model,
        prompt_version: cmd.prompt_version,
      });
      stRemoveMessages(cmd.session_id, cmd.consumed_message_ids);
      metrics.consolidations.inc();
      metrics.messagesConsolidated.inc({}, cmd.consumed_message_ids.length);
      break;
    }
    case "CreateCheckpoint": {
      createCheckpoint(cmd.session_id, cmd.name, cmd.at_index);
      break;
    }
    case "ApplyFeedback": {
      setScore(cmd.session_id, cmd.memory_id, cmd.new_score);
      break;
    }
    case "NoOp":
      break;
  }

}

