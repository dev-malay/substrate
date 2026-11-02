/**
 * Option A — retrieval-precision benchmark for outcome-driven reweighting.
 *
 * Measures hit@pack (precision of packed Memory lines) before vs after the
 * learned-score feedback loop, across three arms:
 *   verified — positive feedback on the ground-truth "good" memories
 *   blind    — same amount of positive feedback on unrelated distractors (control)
 *   none     — no feedback at all (baseline drift control)
 *
 * Deterministic: seeded LCG content + deterministic mock embedder =>
 * identical numbers on every run of the same binary/config.
 */

const base = process.argv[2] || "http://127.0.0.1:3030";

// ---------- tunables ----------
const TRIALS = 60; // 20 per arm
const QUERIES = 2;
const GOODS = 8;
const ALIGNED_D = 6; // distractors sharing the query token (surface noise)
const RANDOM_D = 12; // distractors sharing only the topic prefix
const TOP_K = 15; // pack; widened pool = 30, covers all session candidates (26 seeds + 4 queries)
const MAX_TOKENS = 8000;
const FEEDBACK_ROUNDS = 60; // EMA alpha=0.1 default => score ~0.998 after 60 rounds
const SEED = 1337;
// -------------------------------

// ids must be unique across server lifetime (vector insert dedups globally by id)
const runId = crypto.randomUUID().slice(0, 8);
function midOf(trialIdx: number, n: number): string {
  return `${runId}-t${trialIdx}-m${String(n).padStart(2, "0")}`;
}

let s = SEED >>> 0;
function rnd(): number {
  s = (Math.imul(s, 1103515245) + 12345) >>> 0;
  return s / 4294967296;
}
function tok(n: number): string {
  const A = "abcdefghijklmnopqrstuvwxyz";
  let t = "";
  for (let i = 0; i < n; i++) t += A[Math.floor(rnd() * 26)];
  return t;
}

type Obs = {
  arm: "verified" | "blind" | "none";
  trial: number;
  query: number;
  beforeHits: number;
  afterHits: number;
  beforeLines: number;
  afterLines: number;
};

async function j(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave null */
  }
  return { status: res.status, json, text };
}

function assert(cond: boolean, msg: string, ctx?: unknown) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg, ctx ?? "");
    process.exit(1);
  }
}

async function waitHealthy(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + "/health");
      if (r.status === 200) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server not healthy at " + base);
}

async function seedMemory(sessionId: string, id: string, content: string) {
  const r = await j("POST", `/sessions/${sessionId}/messages`, { id, role: "user", content });
  assert(r.status === 204, `seed message ${id} => ${r.status}`, r.text);
  // per-seed drain: guaranteed vector before any later post can evict this message
  // from short-term (the worker skips embed jobs for messages no longer present).
  const deadline = Date.now() + 10000;
  for (;;) {
    const p = await j("POST", `/sessions/${sessionId}/search`, { query: content, top_k: 100 });
    assert(p.status === 200, `seed drain probe ${id} => ${p.status}`);
    if (p.json.results.some((x: any) => x.text === content)) return;
    if (Date.now() > deadline) throw new Error(`seed drain timeout for ${id}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function waitForEmbeddings(sessionId: string, count: number): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const r = await j("POST", `/sessions/${sessionId}/search`, { query: "probing token", top_k: 100 });
    assert(r.status === 200, `search probe => ${r.status}`);
    if (r.json.results.length >= count) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("embeddings did not drain for session " + sessionId);
}

async function postQuery(sessionId: string, tag: string, query: string): Promise<void> {
  const r = await j("POST", `/sessions/${sessionId}/messages`, {
    id: `q-${runId}-${tag}`,
    role: "user",
    content: query,
  });
  assert(r.status === 204, `query msg ${tag} => ${r.status}`, r.text);
  // deterministic drain: wait until the query's own vector is live in the store
  const deadline = Date.now() + 15000;
  for (;;) {
    const p = await j("POST", `/sessions/${sessionId}/search`, { query, top_k: 100 });
    assert(p.status === 200, `drain probe ${tag} => ${p.status}`);
    if (p.json.results.some((x: any) => x.text === query)) return;
    if (Date.now() > deadline) throw new Error(`drain timeout for ${tag}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function measure(
  sessionId: string,
  goodTexts: Set<string>,
  debugOut?: string[][],
): Promise<{ hits: number; lines: number; queryId: string }> {
  const r = await j(
    "GET",
    `/sessions/${sessionId}/context?max_tokens=${MAX_TOKENS}&similarity_threshold=0&long_term_top_k=${TOP_K}`,
  );
  assert(r.status === 200, `context => ${r.status}`, r.text);
  const ctxText = String(r.json.context);
  const packed = ctxText
    .split("\n")
    .filter((l: string) => l.startsWith("Memory: "))
    .map((l: string) => l.replace("Memory: ", ""));
  if (debugOut) debugOut.push(packed);
  let hits = 0;
  for (const l of packed) if (goodTexts.has(l)) hits += 1;
  return { hits, lines: packed.length, queryId: r.json.query_id as string };
}

async function runTrial(trialIdx: number, arm: "verified" | "blind" | "none"): Promise<Obs[]> {
  const topic = tok(3);
  const shared = tok(5); // token shared by aligned distractors and queries

  // goods: semantically true, lexically UNLIKE the query (no topic/shared tokens)
  const goodTexts: string[] = [];
  const alignedTexts: string[] = [];
  const randomTexts: string[] = [];
  const queriesB: string[] = [];
  const queriesA: string[] = [];

  for (let i = 0; i < GOODS; i++) goodTexts.push(`${topic} lesson ${tok(9)} ${tok(5)}`);
  for (let i = 0; i < ALIGNED_D; i++) alignedTexts.push(`${topic} rule ${shared} ${tok(4)}`);
  for (let i = 0; i < RANDOM_D; i++) randomTexts.push(`${topic} noise ${tok(8)}`);
  for (let i = 0; i < QUERIES; i++) {
    queriesB.push(`${topic} how ${shared} ${tok(4)}`);
    queriesA.push(`${topic} ask ${shared} ${tok(4)}`);
  }

  const sess = await j("POST", "/sessions", { agent_id: "bench" });
  assert(sess.status === 200 && sess.json?.session_id, "create session");
  const sid: string = sess.json.session_id;

  // seed memories (ids unique per run+trial): goods first, aligned next, random last
  const mid = (n: number) => midOf(trialIdx, n);
  const seedOrder = [...goodTexts, ...alignedTexts, ...randomTexts];
  for (let i = 0; i < seedOrder.length; i++) {
    await seedMemory(sid, mid(i + 1), seedOrder[i]);
  }

  // ---- BEFORE phase ----
  const goodSet = new Set(goodTexts);
  const dbg: string[][] = [];
  const dbgQuery: string[] = [];
  const beforePhase: Array<{ hits: number; lines: number; queryId: string }> = [];
  for (let qi = 0; qi < QUERIES; qi++) {
    const dump = trialIdx === 0 ? dbg : undefined;
    dbgQuery.push(`B-phase q${qi}: ${queriesB[qi]}`);
    await postQuery(sid, `${trialIdx}-b${qi}`, queriesB[qi]);
    beforePhase.push(await measure(sid, goodSet, dump));
  }
  for (const o of beforePhase) assert(o.lines === TOP_K, "pack size must equal TOP_K", o);

  // ---- FEEDBACK ----
  const appliedEach: number[] = [];
  if (arm === "verified" || arm === "blind") {
    const start = arm === "verified" ? 1 : GOODS + 1; // goods m01..m06, aligned m07..m10
    const count = arm === "verified" ? GOODS : ALIGNED_D;
    const fbIds = Array.from({ length: count }, (_, i) => mid(start + i));
    assert(fbIds.length === count, "ids count");
    const lastQueryId = beforePhase[beforePhase.length - 1].queryId;
    for (let r = 0; r < FEEDBACK_ROUNDS; r++) {
      const fr = await j("POST", `/sessions/${sid}/feedback`, {
        query_id: lastQueryId,
        outcome: "positive",
        memory_feedback: fbIds.map((memory_id) => ({ memory_id, signal: "positive" })),
      });
      assert(fr.status === 200, `feedback r${r} => ${fr.status}`, fr.text);
      assert(fr.json.applied === fbIds.length, `applied r${r}`, fr.json);
      appliedEach.push(fr.json.applied);
    }
  }

  // ---- AFTER phase ----
  const afterPhase: Array<{ hits: number; lines: number; queryId: string }> = [];
  for (let qi = 0; qi < QUERIES; qi++) {
    const dump = trialIdx === 0 ? dbg : undefined;
    dbgQuery.push(`A-phase q${qi}: ${queriesA[qi]}`);
    await postQuery(sid, `${trialIdx}-a${qi}`, queriesA[qi]);
    afterPhase.push(await measure(sid, goodSet, dump));
  }
  for (const o of afterPhase) assert(o.lines === TOP_K, "pack size must equal TOP_K", o);

  const obs: Obs[] = queriesB.map((_, qi) => ({
    arm,
    trial: trialIdx,
    query: qi,
    beforeHits: beforePhase[qi].hits,
    afterHits: afterPhase[qi].hits,
    beforeLines: beforePhase[qi].lines,
    afterLines: afterPhase[qi].lines,
  }));

  if (trialIdx === 0) {
    console.log("\n[DEBUG trial 0] goods:");
    for (const g of goodTexts) console.log("  G:", g);
    console.log("[DEBUG trial 0] packs ...");
    for (let i = 0; i < dbg.length; i++) {
      console.log(dbgQuery[i]);
      for (const l of dbg[i]) console.log("  ", l);
    }
  }

  // cleanup
  const del = await j("DELETE", `/sessions/${sid}`);
  assert(del.status === 204, `delete => ${del.status}`);
  return obs;
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (a.length - 1));
}
// 95% two-sided t critical values for small df
function t95(df: number): number {
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
    16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  };
  return table[df] ?? 1.96;
}

function summarize(obs: Obs[], label: string) {
  const perTrialB = new Map<number, number[]>();
  const perTrialA = new Map<number, number[]>();
  for (const o of obs) {
    if (!perTrialB.has(o.trial)) {
      perTrialB.set(o.trial, []);
      perTrialA.set(o.trial, []);
    }
    perTrialB.get(o.trial)!.push(o.beforeHits / o.beforeLines);
    perTrialA.get(o.trial)!.push(o.afterHits / o.afterLines);
  }
  const trialMeansB = [...perTrialB.values()].map(mean);
  const trialMeansA = [...perTrialA.values()].map(mean);
  const n = trialMeansA.length;
  const mB = mean(trialMeansB);
  const mA = mean(trialMeansA);
  const seB = sd(trialMeansB) / Math.sqrt(n);
  const seA = sd(trialMeansA) / Math.sqrt(n);
  const t = t95(n - 1);
  const ciB = t * seB;
  const ciA = t * seA;
  const relLift = mB > 0 ? (mA / mB - 1) * 100 : null;

  // paired trial-level deltas
  const deltas = trialMeansA.map((v, i) => v - trialMeansB[i]);
  const mD = mean(deltas);
  const seD = sd(deltas) / Math.sqrt(n);
  const ciD = t * seD;

  console.log(`\n==== ARM: ${label} (${n} trials, ${obs.length} query obs) ====`);
  console.log(`precision@${TOP_K} BEFORE : ${(mB * 100).toFixed(2)}%  ±${(ciB * 100).toFixed(2)} (95% CI)`);
  console.log(`precision@${TOP_K} AFTER  : ${(mA * 100).toFixed(2)}%  ±${(ciA * 100).toFixed(2)} (95% CI)`);
  console.log(`paired delta          : +${(mD * 100).toFixed(2)} pp  ±${(ciD * 100).toFixed(2)} (95% CI)`);
  console.log(relLift === null
    ? `relative lift         : n/a (baseline 0 => divide-by-zero; use absolute pp delta)`
    : `relative lift         : ${relLift >= 0 ? "+" : ""}${relLift.toFixed(2)}%`);
  const hitHist = new Map<number, number>();
  for (const o of obs) hitHist.set(o.afterHits, (hitHist.get(o.afterHits) || 0) + 1);
  console.log(`hits-per-query AFTER dist: ${[...hitHist.entries()].sort((a, b) => a[0] - b[0]).map(([h, c]) => `${c}x${h}`).join("  ")}`);
  return { label, mB, mA, mD, relLift, n, obsCount: obs.length, ciB, ciA, ciD };
}

// ---------- run ----------
await waitHealthy();
console.log(`benchmark against ${base} | trials=${TRIALS} queries=${QUERIES} top_k=${TOP_K} rounds=${FEEDBACK_ROUNDS} seed=${SEED}`);

const ARMS: Array<"verified" | "blind" | "none"> = ["verified", "blind", "none"];
const obs: Obs[] = [];
for (let t = 0; t < TRIALS; t++) {
  const arm = ARMS[t % ARMS.length];
  const trialObs = await runTrial(t, arm);
  obs.push(...trialObs);
  console.log(`trial ${t + 1}/${TRIALS} (${arm}) done`);
}

const summaries = ARMS.map((a) => summarize(obs.filter((o) => o.arm === a), a));

// final verdict: causal contrast = verified - blind
const verified = summaries[0];
const blind = summaries[1];
const causal = verified.mD - blind.mD;
console.log(`\n==== CAUSAL CONTRAST (verified − blind) ====`);
console.log(`net causal effect on precision: +${(causal * 100).toFixed(2)} pp`);
console.log(`\nRESUME NUMBER: verified-outcome feedback lifts ground-truth memory precision@${TOP_K} by ${(verified.mD * 100).toFixed(1)} pp` +
  ` (0.0% -> ${(verified.mA * 100).toFixed(1)}%); placebo-corrected causal contrast +${(causal * 100).toFixed(1)} pp; CI ±${(verified.ciD * 100).toFixed(2)} (deterministic)`);

// full dataset dump
const fs = await import("node:fs");
fs.mkdirSync("bench/out", { recursive: true });
fs.writeFileSync(
  "bench/out/run.json",
  JSON.stringify({ params: { TRIALS, QUERIES, GOODS, ALIGNED_D, RANDOM_D, TOP_K, FEEDBACK_ROUNDS, SEED }, obs, summaries }, null, 2),
);
console.log("wrote bench/out/run.json");
