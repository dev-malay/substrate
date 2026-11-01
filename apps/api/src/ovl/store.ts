export type Decision = {
  id: string;
  session_id: string;
  query_id?: string;
  context: string;
  memory_ids: string[];
  choice: string;
  confidence: number;
  agent_id?: string;
  created_at: string;
  status: "open" | "acted" | "closed";
};

export type Action = {
  decision_id: string;
  kind: string;
  detail: string;
  executed_at: string;
};

export type Outcome = {
  decision_id: string;
  success: boolean;
  profit?: number;
  metrics: Record<string, number>;
  note?: string;
  recorded_at: string;
};

export type MemoryStat = {
  wins: number;
  total: number;
};

export type ChoiceStat = {
  wins: number;
  total: number;
};

const decisions = new Map<string, Decision>();
const actions = new Map<string, Action[]>();
const outcomes = new Map<string, Outcome>();
const memoryStats = new Map<string, Map<string, MemoryStat>>();
const choiceStats = new Map<string, ChoiceStat>();
const agentStats = new Map<string, { decisions: number; wins: number }>();

export function recordDecision(d: Decision): boolean {
  if (decisions.has(d.id)) return false;
  decisions.set(d.id, d);
  if (d.agent_id) {
    const row = agentStats.get(d.agent_id) || { decisions: 0, wins: 0 };
    row.decisions += 1;
    agentStats.set(d.agent_id, row);
  }
  return true;
}

export function getDecision(id: string): Decision | undefined {
  return decisions.get(id);
}

export function sessionDecisions(sessionId: string): Decision[] {
  return [...decisions.values()].filter((d) => d.session_id === sessionId);
}

export function attachAction(a: Action): boolean {
  if (!decisions.has(a.decision_id)) return false;
  const list = actions.get(a.decision_id) || [];
  list.push(a);
  actions.set(a.decision_id, list);
  const d = decisions.get(a.decision_id)!;
  if (d.status === "open") d.status = "acted";
  return true;
}

export function recordOutcome(o: Outcome): boolean {
  const d = decisions.get(o.decision_id);
  if (!d || outcomes.has(o.decision_id)) return false;
  outcomes.set(o.decision_id, o);
  d.status = "closed";
  const per = memoryStats.get(d.session_id) || new Map<string, MemoryStat>();
  for (const mid of d.memory_ids) {
    const row = per.get(mid) || { wins: 0, total: 0 };
    row.total += 1;
    if (o.success) row.wins += 1;
    per.set(mid, row);
  }
  memoryStats.set(d.session_id, per);
  const choice = choiceStats.get(d.choice) || { wins: 0, total: 0 };
  choice.total += 1;
  if (o.success) choice.wins += 1;
  choiceStats.set(d.choice, choice);
  if (d.agent_id) {
    const row = agentStats.get(d.agent_id) || { decisions: 0, wins: 0 };
    if (o.success) row.wins += 1;
    agentStats.set(d.agent_id, row);
  }
  return true;
}

export function memoryReliability(sessionId: string): Array<{
  memory_id: string;
  wins: number;
  total: number;
  rate: number;
}> {
  const per = memoryStats.get(sessionId) || new Map<string, MemoryStat>();
  return [...per.entries()].map(([memory_id, s]) => ({
    memory_id,
    wins: s.wins,
    total: s.total,
    rate: s.total > 0 ? s.wins / s.total : 0,
  }));
}

export function outcomeStats(): {
  choices: Array<{ choice: string; wins: number; total: number; rate: number }>;
  agents: Array<{ agent_id: string; decisions: number; wins: number; rate: number }>;
} {
  return {
    choices: [...choiceStats.entries()].map(([choice, s]) => ({
      choice,
      wins: s.wins,
      total: s.total,
      rate: s.total > 0 ? s.wins / s.total : 0,
    })),
    agents: [...agentStats.entries()].map(([agent_id, s]) => ({
      agent_id,
      decisions: s.decisions,
      wins: s.wins,
      rate: s.decisions > 0 ? s.wins / s.decisions : 0,
    })),
  };
}

export function dumpOvl() {
  return {
    decisions: [...decisions.values()],
    actions: [...actions.entries()],
    outcomes: [...outcomes.values()],
    memoryStats: [...memoryStats.entries()].map(
      ([sid, per]) => [sid, Object.fromEntries(per.entries())] as [string, Record<string, MemoryStat>],
    ),
    choiceStats: Object.fromEntries(choiceStats.entries()),
    agentStats: Object.fromEntries(agentStats.entries()),
  };
}

export function restoreOvl(data: ReturnType<typeof dumpOvl>) {
  decisions.clear();
  actions.clear();
  outcomes.clear();
  memoryStats.clear();
  choiceStats.clear();
  agentStats.clear();
  for (const d of data.decisions || []) decisions.set(d.id, d);
  for (const [id, list] of data.actions || []) actions.set(id, list);
  for (const o of data.outcomes || []) outcomes.set(o.decision_id, o);
  for (const [sid, record] of data.memoryStats || []) {
    memoryStats.set(sid, new Map(Object.entries(record)));
  }
  for (const [choice, s] of Object.entries(data.choiceStats || {})) choiceStats.set(choice, s);
  for (const [agent, s] of Object.entries(data.agentStats || {})) agentStats.set(agent, s);
}

export function deleteSessionOvl(sessionId: string) {
  for (const [id, d] of [...decisions]) {
    if (d.session_id === sessionId) {
      decisions.delete(id);
      actions.delete(id);
      outcomes.delete(id);
    }
  }
  memoryStats.delete(sessionId);
}
