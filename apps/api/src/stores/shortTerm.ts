import type { TokenCounter } from "../tokens.js";
import type { Message } from "../types.js";

export const shortTermMessages = new Map<string, Message[]>();


export function stAdd(msg: Message) {
  const list = shortTermMessages.get(msg.sessionId) || [];
  list.push(msg);
  shortTermMessages.set(msg.sessionId, list);
}

export function stRecent(sessionId: string, count: number): Message[] {
  const list = shortTermMessages.get(sessionId) || [];
  return list.slice(Math.max(0, list.length - count));
}

export function stTrim(sessionId: string, maxCount: number) {
  const list = shortTermMessages.get(sessionId) || [];
  if (list.length > maxCount) {
    shortTermMessages.set(sessionId, list.slice(list.length - maxCount));
  }
}

function countAll(list: Message[], counter: TokenCounter): number {
  let total = 0;
  for (const m of list) total += counter.countTokens(m.role + ": " + m.content);
  return total;
}

export function stTrimToTokenBudget(
  sessionId: string,
  maxTokens: number,
  counter: TokenCounter
) {
  let list = shortTermMessages.get(sessionId) || [];
  while (list.length > 0 && countAll(list, counter) > maxTokens) {
    let drop = 1;
    const first = list[0];
    const second = list[1];
    if (first && second && first.role === "user" && second.role === "assistant") drop = 2;
    list = list.slice(drop);
  }
  shortTermMessages.set(sessionId, list);
}

export function stRemoveMessages(sessionId: string, ids: string[]) {
  const keep = new Set(ids);
  const list = shortTermMessages.get(sessionId) || [];
  shortTermMessages.set(
    sessionId,
    list.filter((m) => !keep.has(m.id)),
  );
}

export function stDelete(sessionId: string) {
  shortTermMessages.delete(sessionId);
}

export function stDumpAll(): Array<{ sessionId: string; messages: Message[] }> {
  return [...shortTermMessages.entries()].map(([sessionId, messages]) => ({
    sessionId,messages
  }));
}

export function stRestoreAll(items: Array<{ sessionId: string; messages: Message[] }>) {
  shortTermMessages.clear();
  for (const item of items) shortTermMessages.set(item.sessionId, item.messages);
}
