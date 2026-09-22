import type { Message, Session } from "./types.js";

export const sessions = new Map<string, Session>();
export const messages = new Map<string, Message[]>();

export function listMessages(sessionId: string): Message[] {
  return messages.get(sessionId) || [];
}

export function addMessage(msg: Message) {
  const list = messages.get(msg.sessionId) || [];
  list.push(msg);
  messages.set(msg.sessionId, list);
}
