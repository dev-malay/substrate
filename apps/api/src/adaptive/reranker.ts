export type Candidate = {
  memoryId: string;
  text: string;
  similarity: number;
};

export type Ranked = Candidate & {
  learnedScore: number;
  finalScore: number;
};

export function rerank(
  candidates: Candidate[],
  learned: (memoryId: string) => number,
  feedbackWeight: number,
): Ranked[] {
  if (candidates.length === 0) return [];
  const sims = candidates.map((c) => c.similarity);
  const lo = Math.min(...sims);
  const hi = Math.max(...sims);
  const range = hi - lo;
  const ranked = candidates.map((c) => {
    const normSim = range === 0 ? 1 : (c.similarity - lo) / range;
    const learnedScore = learned(c.memoryId);
    const normLearned = (learnedScore + 1) / 2;
    return {
      ...c,
      learnedScore,
      finalScore: normSim + feedbackWeight * normLearned,
    };
  });
  ranked.sort((a, b) => b.finalScore - a.finalScore);
  return ranked;
}
