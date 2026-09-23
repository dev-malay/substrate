import {
  coreAdd,
  coreDelete,
  coreFactsMap,
  coreList,
} from "./stores/core.js";
import {
  shortTermMessages,
  stAdd,
  stDelete,
  stRecent,
} from "./stores/shortTerm.js";
import type { Message, Session } from "./types.js";

export const sessions = new Map<string, Session>();
export const messages = shortTermMessages;
export const coreFacts = coreFactsMap;

export type StoredContext = {
  queryId: string;
  sessionId: string;
  query: string;
  memoryIds: string[];
  createdAt: number;
};

export const contexts = new Map<string, StoredContext>();

export function listMessages(sessionId: string): Message[] {
  return stRecent(sessionId, Number.MAX_SAFE_INTEGER);
}

export function addMessage(msg: Message) {
  stAdd(msg);
}

export function getFacts(sessionId: string): string[] {
  return coreList(sessionId);
}

export function addFact(sessionId: string, fact: string) {
  coreAdd(sessionId, fact);
}

export function sessionExists(sessionId: string): boolean {
  if (sessions.has(sessionId)) return true;
  if ((shortTermMessages.get(sessionId) || []).length > 0) return true;
  return (coreFactsMap.get(sessionId) || []).length > 0;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
  stDelete(sessionId);
  coreDelete(sessionId);
}
