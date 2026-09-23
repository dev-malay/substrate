export const coreFactsMap = new Map<string, string[]>();

export function coreAdd(sessionId: string, fact: string) {
  const list = coreFactsMap.get(sessionId) || [];
  list.push(fact);
  coreFactsMap.set(sessionId, list);
}

export function coreList(sessionId: string): string[] {
  return coreFactsMap.get(sessionId) || [];
}

export function coreDelete(sessionId: string) {
  coreFactsMap.delete(sessionId);
}

export function coreDumpAll(): Array<{ sessionId: string; facts: string[] }> {
  return [...coreFactsMap.entries()].map(([sessionId, facts]) => ({ sessionId, facts }));
}

export function coreRestoreAll(items: Array<{ sessionId: string; facts: string[] }>) {
  coreFactsMap.clear();
  for (const item of items) coreFactsMap.set(item.sessionId, item.facts);
}


