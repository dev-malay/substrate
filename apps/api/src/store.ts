import type { Message, Session } from "./types.js";

export const sessions = new Map<string, Session>();
export const messages = new Map<string, Message[]>();
export const coreFacts = new Map<string, string[]>();

export type StoredContext = {
  queryId: string;
  sessionId: string;
  query: string;
  memoryIds: string[];
  createdAt: number;
}

export const contexts = new Map<string, StoredContext>();

export function listMessages(sessionId: string): Message[] {
  return messages.get(sessionId) || [];
}

export function addMessage(msg: Message) {
  const list = messages.get(msg.sessionId) || [];
  list.push(msg);
  messages.set(msg.sessionId, list);
}

export function getFacts(sessionId: string): string[] {
  return coreFacts.get(sessionId) || [];
}

export function addFact(sessionId: string, fact: string) {
  const list = coreFacts.get(sessionId) || [];
  list.push(fact);
  coreFacts.set(sessionId, list);
}

export function sessionExists(sessionId: string): boolean {
  if (sessions.has(sessionId)) return true;
  if ((messages.get(sessionId) || []).length > 0) return true;
  return (coreFacts.get(sessionId) || []).length > 0;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
  messages.delete(sessionId);
  coreFacts.delete(sessionId);
}
