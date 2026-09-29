export type Summary = {
  id: string;
  text: string;
  created_at_index: number;
  consumed_message_ids: string[];
  consumed_count: number;
  model: string;
  prompt_version: string;
};

const summaries = new Map<string, Summary[]>();

export function addSummary(sessionId: string, summary: Summary): boolean {
  const list = summaries.get(sessionId) || [];
  if (list.some((s) => s.id === summary.id)) return false;
  list.push(summary);
  list.sort((a, b) => a.created_at_index - b.created_at_index);
  summaries.set(sessionId, list);
  return true;
}

export function getSummaries(sessionId: string): Summary[] {
  return [...(summaries.get(sessionId) || [])];
}

export function deleteSessionSummaries(sessionId: string) {
  summaries.delete(sessionId);
}

export function dumpSummaries(): Array<[string, Summary[]]> {
  return [...summaries.entries()];
}

export function restoreSummaries(items: Array<[string, Summary[]]>) {
  summaries.clear();
  for (const [sessionId, list] of items) summaries.set(sessionId, list);
}
