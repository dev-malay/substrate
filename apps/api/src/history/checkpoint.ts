export type Checkpoint = {
  session_id: string;
  name: string;
  at_index: number;
};

const checkpoints = new Map<string, Checkpoint>();

function key(sessionId: string, name: string): string {
  return sessionId + "" + name;
}

export function createCheckpoint(sessionId: string, name: string, atIndex: number): Checkpoint {
  const k = key(sessionId, name);
  const existing = checkpoints.get(k);
  if (existing) return existing;
  const cp = { session_id: sessionId, name, at_index: atIndex };
  checkpoints.set(k, cp);
  return cp;
}

export function resolveCheckpoint(sessionId: string, name: string): Checkpoint | undefined {
  return checkpoints.get(key(sessionId, name));
}

export function listCheckpoints(sessionId: string): Checkpoint[] {
  return [...checkpoints.values()].filter((c) => c.session_id === sessionId);
}

export function deleteSessionCheckpoints(sessionId: string) {
  for (const k of [...checkpoints.keys()]) {
    if (k.startsWith(sessionId + "")) checkpoints.delete(k);
  }
}
