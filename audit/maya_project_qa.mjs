/**
 * MAYA QA — telling the app what the project actually IS.
 *
 * Maya asks: "I typed a project name and the agent asked me generic
 * questions. Where do I tell it what we're building — and if I answer a
 * question here, does it stick?"
 *
 * FIELD 2026-08-25: "How do users enter the project goals so readiness has a
 * context and asks the right follow-up questions?" They could not. The only
 * thing anybody typed about a project was its NAME.
 *
 * Deterministic + offline. Drives the REAL handlers in
 * app/api/project/route.ts. Run: node audit/maya_project_qa.mjs
 */
import { register } from "node:module";
register("./alias.mjs", import.meta.url);

const { CLOUD, reset } = await import("./fake-cloud.mjs");

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";

const { GET, POST } = await import("../app/api/project/route.ts");

const RESULTS = [];
class AssertErr extends Error { constructor(m) { super(m); this.name = "AssertErr"; } }
const _a = (c, m) => { if (!c) throw new AssertErr(m); };
async function check(tid, name, fn) {
  try { await fn(); RESULTS.push([tid, name, "PASS", ""]); }
  catch (e) { RESULTS.push([tid, name, "FAIL", String(e?.message).slice(0, 170)]); }
}

const post = (body, token = "good") =>
  POST(new Request("http://localhost/api/project", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
const get = (project, token = "good") =>
  GET(new Request(`http://localhost/api/project?project=${encodeURIComponent(project)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));

const BRIEF = "A tool for the finance team that turns a photo of a receipt into a filed expense, so nobody keeps paper.";

await check("PJ-01", "a brief saves, and is there when you come back", async () => {
  reset();
  const r = await post({ project: "Expenses", action: "brief", brief: BRIEF });
  _a(r.status === 200, `HTTP ${r.status}`);
  _a((await r.json()).brief === BRIEF, "it comes back as written");
  const g = await get("Expenses");
  _a(g.status === 200 && (await g.json()).brief === BRIEF, "and it is still there on the next read");
});

await check("PJ-02", "a project with nothing said about it is not an error", async () => {
  reset();
  const g = await get("Brand New");
  _a(g.status === 200, `HTTP ${g.status} — a project with no brief is the normal first state, not a 404`);
  const j = await g.json();
  _a(j.brief === "" && Array.isArray(j.decisions) && j.decisions.length === 0, "it answers empty rather than missing");
});

await check("PJ-03", "signed out is asked to sign in", async () => {
  reset();
  _a((await post({ project: "P", action: "brief", brief: "x" }, "nope")).status === 401, "POST is gated");
  _a((await get("P", "nope")).status === 401, "…and so is GET — a brief is somebody's product plan");
});

await check("PJ-04", "no project named fails cleanly", async () => {
  reset();
  _a((await post({ action: "brief", brief: "x" })).status === 400, "POST without a project");
  _a((await get("")).status === 400, "GET without a project");
});

await check("PJ-05", "a two-page brief is refused, with the reason", async () => {
  reset();
  const r = await post({ project: "Expenses", action: "brief", brief: "x".repeat(4000) });
  _a(r.status === 400, `HTTP ${r.status}`);
  _a(/two or three sentences/i.test((await r.json()).error),
     "it says what a brief is FOR — a second document competing with the PRD means whichever the model believes, the other is now wrong");
});

await check("PJ-06", "a brief can be cleared", async () => {
  reset();
  await post({ project: "Expenses", action: "brief", brief: BRIEF });
  const r = await post({ project: "Expenses", action: "brief", brief: "" });
  _a(r.status === 200 && (await r.json()).brief === "", "emptying it is allowed — this is optional, not a trap");
});

await check("PJ-07", "answering a question between meetings sticks", async () => {
  reset();
  const r = await post({ project: "Expenses", action: "decision", key: "scope",
                         question: "What has to be in the first version?", answer: "Photo upload only" });
  _a(r.status === 200, `HTTP ${r.status}`);
  const j = await r.json();
  _a(j.decisions.length === 1 && j.decisions[0].answer === "Photo upload only", "it is recorded");
  _a(j.decisions[0].at, "with a time on it, so the PRD can treat it as the current position");
});

await check("PJ-08", "changing your mind replaces, it does not pile up", async () => {
  reset();
  await post({ project: "Expenses", action: "decision", key: "scope", question: "What ships?", answer: "Upload only" });
  const r = await post({ project: "Expenses", action: "decision", key: "scope", question: "What ships?", answer: "Upload and export" });
  const j = await r.json();
  _a(j.decisions.length === 1, `one answer per question, got ${j.decisions.length} — keeping both hands the model the job of guessing which you meant`);
  _a(j.decisions[0].answer === "Upload and export", "and it is the newer one");
});

await check("PJ-09", "an answer with no answer in it fails cleanly", async () => {
  reset();
  const r = await post({ project: "Expenses", action: "decision", key: "scope", question: "What ships?" });
  _a(r.status === 400, `HTTP ${r.status} — never a 500`);
  _a(/pick one|own words/i.test((await r.json()).error), "and says what to do instead");
});

await check("PJ-10", "THE ONE THAT MATTERS: answering a question does not wipe the brief", async () => {
  reset();
  await post({ project: "Expenses", action: "brief", brief: BRIEF });
  await post({ project: "Expenses", action: "decision", key: "users", answer: "The finance team" });
  const j = await (await get("Expenses")).json();
  _a(j.brief === BRIEF, "the brief survived a decision being written");
  _a(j.decisions.length === 1, "and the decision survived too");
  await post({ project: "Expenses", action: "brief", brief: "A receipt filer." });
  const k = await (await get("Expenses")).json();
  _a(k.decisions.length === 1, "…and editing the brief does not wipe the answers. Read-modify-write, both directions");
});

await check("PJ-11", "an unreadable request, and an unknown one, both fail cleanly", async () => {
  reset();
  _a((await post("{not json")).status === 400, "malformed body");
  const r = await post({ project: "Expenses", action: "sing" });
  _a(r.status === 400, "unknown action");
  _a(/brief|answer/i.test((await r.json()).error), "and the error names what it DOES accept");
});

await check("PJ-12", "two projects do not share a brief", async () => {
  reset();
  await post({ project: "Expenses", action: "brief", brief: BRIEF });
  await post({ project: "Arcade", action: "brief", brief: "A game where you dodge waves." });
  _a((await (await get("Expenses")).json()).brief === BRIEF, "Expenses kept its own");
  _a(/dodge waves/.test((await (await get("Arcade")).json()).brief), "…and Arcade kept its own");
  _a(CLOUD.uploads.some((u) => u.path === "u1/prd/expenses.project.json"), "stored per project, under the owner's prefix");
});

console.log("=".repeat(78));
console.log("  MAYA QA — the project's own words");
console.log("=".repeat(78));
let passed = 0;
for (const [tid, name, status, detail] of RESULTS) {
  console.log(`  ${status === "PASS" ? "PASS" : "FAIL"}  ${tid}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (status === "PASS") passed++;
}
console.log("-".repeat(78));
console.log(`  ${passed}/${RESULTS.length} PASS`);
process.exit(passed === RESULTS.length ? 0 : 1);
