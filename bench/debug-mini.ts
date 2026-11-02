const base = "http://127.0.0.1:3030";
async function req(p: string, body?: unknown, method = "POST"): Promise<{ s: number; j: any }> {
  const r = await fetch(base + p, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { s: r.status, j: r.status === 204 ? null : await r.json().catch(() => null) };
}

const s = await req("/sessions");
const sid: string = s.j.session_id;
const texts = ["kvm lesson aaaaa bbbbb", "kvm noise ccccc", "kvm rule kkmvp eeeee", "kvm noise fffff"];
let i = 0;
for (const t of texts) {
  await req(`/sessions/${sid}/messages`, { id: `db${i}`, role: "user", content: t });
  i++;
}
await new Promise((r) => setTimeout(r, 400));
await req(`/sessions/${sid}/messages`, { role: "user", content: "kvm ask kkmvp zzz" });
await new Promise((r) => setTimeout(r, 400));

const c = await req(`/sessions/${sid}/context?max_tokens=8000&similarity_threshold=0&long_term_top_k=10`, undefined as any, "GET" as any);
console.log("BEFORE:");
console.log(c.j.context);

const fb = await req(`/sessions/${sid}/feedback`, {
  query_id: c.j.query_id,
  outcome: "positive",
  memory_feedback: [
    { memory_id: "db0", signal: "positive" },
    { memory_id: "db3", signal: "negative" },
  ],
});
console.log("feedback applied:", JSON.stringify(fb.j));

const c2 = await req(`/sessions/${sid}/context?max_tokens=8000&similarity_threshold=0&long_term_top_k=10`, undefined as any, "GET" as any);
console.log("AFTER:");
console.log(c2.j.context);
await req(`/sessions/${sid}`, null, "DELETE");
