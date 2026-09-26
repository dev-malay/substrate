import { config } from "../config.js";
import { tryEnqueue } from "../worker.js";
import { coreAdd, coreDelete } from "../stores/core.js";
import { stAdd, stDelete, stTrim } from "../stores/shortTerm.js";
import { vectors } from "../stores/vectors.js";
import { sessions } from "../store.js";
import type { MemoryCommand, Visibility } from "./types.js";

export const visibility = new Map<string, Visibility>();
export const sessionAgents = new Map<string, string>();


export function applyCommand(cmd: MemoryCommand) {
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
      break;
    }

    case "AddKnowledge":
    case "ApplyFeedback":
    case "ApplySummary":
    case "CreateCheckpoint":
    case "NoOp":
      break;
  }

}

