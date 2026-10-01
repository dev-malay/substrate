const scores = new Map<string, Map<string, number>>();

export function nextScore(old: number, reward: number, alpha: number): number {
  return old + alpha * (reward - old);
}

export function setScore(sessionId: string, memoryId: string, value: number) {
  let per = scores.get(sessionId);
  if (!per) {
    per = new Map();
    scores.set(sessionId, per);
  }
  per.set(memoryId, value);
}

export function getScore(sessionId: string, memoryId: string): number {
  return scores.get(sessionId)?.get(memoryId) || 0;
}

export function scoresFor(sessionId: string): Map<string, number> {
  return scores.get(sessionId) || new Map();
}

export function deleteSessionScores(sessionId: string) {
  scores.delete(sessionId);
}

export function dumpScores(): Array<[string, Record<string, number>]> {
  return [...scores.entries()].map(([sessionId, per]) => [
    sessionId,
    Object.fromEntries(per.entries()),
  ]);
}

export function restoreScores(items: Array<[string, Record<string, number>]>) {
  scores.clear();
  for (const [sessionId, record] of items) {
    scores.set(sessionId, new Map(Object.entries(record)));
  }
}
