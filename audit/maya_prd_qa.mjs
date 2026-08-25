/**
 * MAYA QA — the PRD a project's recorded meetings produce.
 *
 * Maya asks: "I recorded three meetings about the same project. Can I press
 * one button and get the spec — and when something goes wrong, does it tell
 * me, or does it hand me a confident document somebody will build from?"
 *
 * Deterministic + offline. Drives the REAL route handler in
 * app/api/prd/route.ts through its real Request/Response, with Supabase and
 * the model provider replaced by audit/fake-cloud.mjs. Nothing leaves the
 * machine — fakeFetch throws on any URL it does not recognise, which is the
 * check that the suite cannot quietly become an integration test.
 *
 * Run: node audit/maya_prd_qa.mjs
 */
import { register } from "node:module";
register("./alias.mjs", import.meta.url);

const { CLOUD, reset, fakeFetch, content, RETIRED_MODEL_404 } = await import("./fake-cloud.mjs");

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.OPENROUTER_API_KEY = "or-key";
globalThis.fetch = fakeFetch;

const { POST, GET } = await import("../app/api/prd/route.ts");

const RESULTS = [];
async function check(tid, name, fn) {
  try { await fn(); RESULTS.push([tid, name, "PASS", ""]); }
  catch (e) {
    RESULTS.push([tid, name, e instanceof AssertErr ? "FAIL" : "ERROR",
      `${e?.name === "AssertErr" ? "" : `${e?.constructor?.name}: `}${String(e?.message).slice(0, 170)}`]);
  }
}
class AssertErr extends Error { constructor(m) { super(m); this.name = "AssertErr"; } }
const _a = (cond, msg) => { if (!cond) throw new AssertErr(msg); };

const post = (body, token = "good") =>
  POST(new Request("http://localhost/api/prd", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  }));

/** Two recorded meetings on one project, the way the finish route writes them. */
function seedProject(project = "Quantlys Meet", extra = {}) {
  reset();
  CLOUD.listing["u1"] = [{ name: "room-a" }, { name: "room-b" }];
  CLOUD.listing["u1/room-a"] = [{ name: "2026-08-01T10-00.summary.json", id: "f1" }];
  CLOUD.listing["u1/room-b"] = [{ name: "2026-08-08T10-00.summary.json", id: "f2" }];
  CLOUD.files["u1/room-a/2026-08-01T10-00.summary.json"] = JSON.stringify({
    room: "room-a", project, title: "Kickoff", at: "2026-08-01",
    transcript: "Kiran: the problem is expense receipts get lost. Raghu: our users are the finance team.",
    ...extra,
  });
  CLOUD.files["u1/room-b/2026-08-08T10-00.summary.json"] = JSON.stringify({
    room: "room-b", project, title: "Scope", at: "2026-08-08",
    transcript: "Raghu: v1 is upload a photo and it files itself. Kiran: nothing else in v1.",
    ...extra,
  });
}

const GOOD_REPLY = content(JSON.stringify({
  dimensions: [
    { key: "problem", status: "present", evidence: "Kiran named lost receipts." },
    { key: "users", status: "present", evidence: "Raghu said the finance team." },
    { key: "scope", status: "partial", question: "What has to be in the first version?", options: ["Photo upload only"], why: "It decides what ships." },
    { key: "architecture", status: "missing" },
  ],
  summary: "An expense capture tool, scoped but not designed.",
  prd: "# PRD — Expenses\n\n## Problem\nReceipts get lost.\n\n## Architecture\nTBD",
}));

// ── the happy path ────────────────────────────────────────────────────────
await check("PRD-01", "three recorded meetings become one PRD", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  const r = await post({ project: "Quantlys Meet" });
  _a(r.status === 200, `HTTP ${r.status}`);
  const j = await r.json();
  _a(j.prd.includes("Receipts get lost"), "the document says what the meetings said");
  _a(j.markdown.includes("# PRD"), "and there is a document to hand somebody");
});

await check("PRD-02", "it is scored on Conclave's own eight dimensions", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  _a(j.total === 8, `eight dimensions, got ${j.total}`);
  _a(j.present_count === 2 && j.score === 0.312, `2 present, score 0.312 — got ${j.present_count}/${j.score}`);
  _a(j.ready === false && j.blocking.length === 6, "and it is not ready while six are unmet");
  _a(j.gate === "Build-ready" && j.artifact === "PRD", "with Conclave's words for the gate and the artifact");
});

await check("PRD-03", "what was actually SAID reaches the model", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  await post({ project: "Quantlys Meet" });
  const sent = JSON.stringify(CLOUD.calls[CLOUD.calls.length - 1]);
  _a(sent.includes("expense receipts get lost"), "the first meeting's words are in the prompt");
  _a(sent.includes("upload a photo"), "…and the second meeting's too — a PRD from one meeting is not a project's PRD");
  _a(sent.indexOf("receipts get lost") < sent.indexOf("upload a photo"), "oldest first, so 'the later meeting wins' is visible");
});

await check("PRD-04", "every unmet dimension comes back as a question with answers to pick", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  _a(j.open_questions.length === 6, `six open, got ${j.open_questions.length}`);
  _a(j.open_questions.every((q) => q.question && q.options.length >= 2 && q.why),
     "0209: not one of them arrives bare, even the five the model said nothing about");
  _a(!j.open_questions.some((q) => /data model|schema/i.test(q.question)),
     "and none of them are written for a developer");
});

await check("PRD-05", "the assessment is saved, so opening it twice is not billed twice", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  await post({ project: "Quantlys Meet" });
  _a(CLOUD.uploads.some((u) => u.path === "u1/prd/quantlys-meet.prd.json"),
     `saved under the owner's own prefix; uploads were ${JSON.stringify(CLOUD.uploads.map((u) => u.path))}`);
  const g = await GET(new Request("http://localhost/api/prd?project=Quantlys%20Meet", { headers: { authorization: "Bearer good" } }));
  _a(g.status === 200, `reading it back: HTTP ${g.status}`);
  _a((await g.json()).prd.includes("Receipts get lost"), "and it is the same document");
  _a(CLOUD.calls.length === 1, "with no second call to the model");
});

// ── the ways it goes wrong ───────────────────────────────────────────────
await check("PRD-06", "signed out is asked to sign in, not shown an error page", async () => {
  seedProject();
  const r = await post({ project: "X" }, "wrong-token");
  _a(r.status === 401, `HTTP ${r.status}`);
  _a(/sign in/i.test((await r.json()).error), "in those words");
});

await check("PRD-07", "no project named fails cleanly and says what to do", async () => {
  seedProject();
  const r = await post({});
  _a(r.status === 400, `HTTP ${r.status}`);
  _a(/project/i.test((await r.json()).error), "naming the thing that is missing");
});

await check("PRD-08", "a project nobody tagged says so, and says how to fix it", async () => {
  seedProject("Something Else");
  const r = await post({ project: "Quantlys Meet" });
  _a(r.status === 404, `HTTP ${r.status} — never a 500`);
  const j = await r.json();
  _a(/tagged/i.test(j.error), "it explains that the tag is what groups meetings");
  _a(j.error.includes("2"), "and says how many recordings DO carry a tag, so a typo is findable");
});

await check("PRD-09", "no transcript is a different problem, and gets a different answer", async () => {
  seedProject();
  for (const k of Object.keys(CLOUD.files)) {
    const j = JSON.parse(CLOUD.files[k]); j.transcript = ""; CLOUD.files[k] = JSON.stringify(j);
  }
  const r = await post({ project: "Quantlys Meet" });
  _a(r.status === 422, `HTTP ${r.status}`);
  _a(/transcript|captions/i.test((await r.json()).error), "and points at captions, which is the actual fix");
});

await check("PRD-10", "somebody else's recordings are refused", async () => {
  seedProject();
  const r = await post({ project: "P", summaryPaths: ["u2/room-x/a.summary.json"] });
  _a(r.status === 403, `HTTP ${r.status}`);
});

await check("PRD-11", "no model key explains itself and keeps the recordings safe", async () => {
  seedProject();
  const had = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const r = await post({ project: "Quantlys Meet" });
    _a(r.status === 503, `HTTP ${r.status}`);
    const j = await r.json();
    _a(/OPENROUTER_API_KEY/.test(j.error), "naming the exact variable to set");
    _a(/already saved/i.test(j.error), "and saying the recordings are not at risk");
  } finally { process.env.OPENROUTER_API_KEY = had; }
});

// ── the provider misbehaving ─────────────────────────────────────────────
await check("PRD-12", "a model that refuses does NOT produce an invented PRD", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 404, body: RETIRED_MODEL_404 });
  const r = await post({ project: "Quantlys Meet" });
  _a(r.status === 200, `still answers: HTTP ${r.status}`);
  const j = await r.json();
  _a(j.prd === "", "THE WORST BUG THIS FEATURE COULD HAVE: no document at all beats a confident invented one somebody builds from");
  _a(j.assessment_error.includes("404"), "the provider's status is carried through");
  _a(j.assessment_error.includes("No endpoints found"), "…and the provider's OWN WORDS, so one screenshot is enough to diagnose it");
  _a(j.open_questions.length === 8, "and every question is still asked, so the meeting was not wasted");
});

await check("PRD-13", "a model that ignores the format degrades honestly", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: content("Sure! Here's a great PRD for you...") });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  _a(j.prd === "" && /couldn't be read/i.test(j.assessment_error), "no document, and it says why");
  _a(j.score === 0, "and scores zero rather than guessing");
});

await check("PRD-14", "a reply cut off mid-document is salvaged, not thrown away", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: content(
    '{"dimensions":[{"key":"problem","status":"present","evidence":"named"}],"prd":"# PRD\\n\\nThe problem is receipts get l') });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  _a(j.present_count === 1, "the assessment survives the truncation");
  _a(j.prd.includes("receipts get l"), "and so does as much of the document as arrived — losing it all means paying twice");
});

await check("PRD-15", "a PRD that embeds code fences does not break the parse", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: content(JSON.stringify({
    dimensions: [{ key: "problem", status: "present", evidence: "x" }],
    prd: "# PRD\n\n```ts\nconst shape = { a: 1 };\n```\n",
  })) });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  _a(j.prd.includes("const shape"), "braces inside a string value are content, not structure");
});

await check("PRD-16", "one unreadable recording does not cost the whole project", async () => {
  seedProject();
  CLOUD.files["u1/room-a/2026-08-01T10-00.summary.json"] = "{ this is not json";
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  const r = await post({ project: "Quantlys Meet" });
  _a(r.status === 200, `HTTP ${r.status}`);
  const j = await r.json();
  _a(j.meetings_used === 1, "the readable one is still used");
});

await check("PRD-17", "a game project is scored as a game, not as a web app", async () => {
  seedProject("Arcade");
  for (const k of Object.keys(CLOUD.files)) {
    const j = JSON.parse(CLOUD.files[k]);
    j.transcript = "Kiran: the player dodges waves and chases a high score across levels.";
    CLOUD.files[k] = JSON.stringify(j);
  }
  CLOUD.chat = () => ({ status: 200, body: content(JSON.stringify({ dimensions: [{ key: "core_loop", status: "present", evidence: "dodge and score" }], prd: "# Game design doc" })) });
  const j = await (await post({ project: "Arcade" })).json();
  _a(j.mode === "game", `mode was ${j.mode}`);
  _a(j.artifact === "Game design doc", "and it is called what Conclave calls it");
  _a(j.dimensions.some((d) => d.key === "core_loop"), "scored on the core loop rather than on a data model it will never have");
});

await check("PRD-18", "the handoff never claims a one-click send to Conclave", async () => {
  seedProject();
  CLOUD.chat = () => ({ status: 200, body: GOOD_REPLY });
  const j = await (await post({ project: "Quantlys Meet" })).json();
  const text = JSON.stringify(j.handoff);
  _a(j.handoff.length === 3, "three real steps");
  _a(/paste/i.test(text), "and the middle one is a paste");
  _a(!/one.click|automatic|we'?ll (attach|send)/i.test(text),
     "THE HONESTY GUARD: Conclave has no endpoint that accepts a PRD, so nothing here may imply it does");
});

// ── report ───────────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("  MAYA QA — PRD from recorded meetings, by project");
console.log("=".repeat(78));
let passed = 0;
for (const [tid, name, status, detail] of RESULTS) {
  console.log(`  ${status === "PASS" ? "PASS" : "FAIL"}  ${tid}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (status === "PASS") passed++;
}
console.log("-".repeat(78));
console.log(`  ${passed}/${RESULTS.length} PASS`);
process.exit(passed === RESULTS.length ? 0 : 1);
