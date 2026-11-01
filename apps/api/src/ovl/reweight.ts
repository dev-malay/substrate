import { config } from "../config.js";
import { getScore, nextScore, setScore } from "../adaptive/scoring.js";
import { getDecision } from "./store.js";

export function reweightFromOutcome(decisionId: string, success: boolean): number {
  const d = getDecision(decisionId);
  if (!d) return 0;
  const reward = success ? 1 : -1;
  const alpha = config.retrievalLearningRate;
  let updated = 0;
  for (const mid of d.memory_ids) {
    setScore(d.session_id, mid, nextScore(getScore(d.session_id, mid), reward, alpha));
    updated += 1;
  }
  return updated;
}
