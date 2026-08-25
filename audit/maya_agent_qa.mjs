/**
 * MAYA QA — the agent that asks questions during the meeting.
 *
 * Maya asks: "There's a bot in my meeting. Does it actually ask something
 * useful about MY project, does it shut up when it should, and when the model
 * is down does it go quiet or does it say something stupid?"
 *
 * Deterministic + offline. Drives the REAL handler in
 * app/api/agent/question/route.ts, with Supabase and the model provider
 * replaced by audit/fake-cloud.mjs.
 *
 * WHERE THE OTHER HALF LIVES: whether to ask at all is decided in the browser
 * by lib/agent.ts and is guarded by lib/agent.test.mjs — 31 checks, most of
 * them refusals. This suite is only about the question itself. Neither file
 * can see the other's half, which is stated here so nobody reads a green run
 * as "the agent will not interrupt".
 *
 * Run: node audit/maya_agent_qa.mjs
 */
import { register } from "node:module";
register("./alias.mjs", import.meta.url);

const { CLOUD, reset, fakeFetch, content, RETIRED_MODEL_404 } = await import("./fake-cloud.mjs");

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.OPENROUTER_API_KEY = "or-key";
globalThis.fetch = fakeFetch;

const { POST } = await import("../app/api/agent/question/route.ts");

const RESULTS = [];
class AssertErr extends Error { constructor(m) { super(m); this.name = "AssertErr"; } }
const _a = (cond, msg) => { if (!cond) throw new AssertErr(msg); };
async function check(tid, name, fn) {
  try { await fn(); RESULTS.push([tid, name, "PASS", ""]); }
  catch (e) { RESULTS.push([tid, name, "FAIL", String(e?.message).slice(0, 170)]); }
}

const post = (body, token = "good") =>
  POST(new Request("http://localhost/api/agent/question", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

const ROOM_TALK =
  "Kiran: so the finance team uploads a photo of the receipt.\n" +
  "Raghu: right, and it files itself against the right expense code.\n" +
  "Kiran: what worries me is what happens when the photo is unreadable.";

const GOOD = content(JSON.stringify({
  question: "What should happen when a receipt photo can't be read?",
  options: ["Ask them to retake it", "File it for a human to check later"],
  why: "It decides whether people trust it enough to stop keeping paper.",
}));

// ── it asks something ────────────────────────────────────────────────────
await check("AG-01", "it asks one question, with answers to pick and a reason", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  const r = await post({ project: "Expenses", recent: ROOM_TALK });
  _a(r.status === 200, `HTTP ${r.status}`);
  const j = await r.json();
  _a(j.ask === true, "it decided there was something to ask");
  _a(j.question.length > 5 && j.question.length < 200, "one readable sentence");
  _a(j.options.length >= 2, "0209: never a bare question in a live meeting — the buttons are how somebody answers without saying it out loud in front of colleagues");
  _a(j.why, "and one line on what the choice changes");
});

await check("AG-02", "it is a Sonnet question", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  await post({ project: "Expenses", recent: ROOM_TALK });
  const call = CLOUD.calls[CLOUD.calls.length - 1];
  _a(call.model === "anthropic/claude-sonnet-4.5", `asked ${call.model}`);
  _a(call.max_tokens <= 600, "and a small budget — this is one sentence under time pressure, not an essay");
});

await check("AG-03", "what the room JUST said reaches the model", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  await post({ project: "Expenses", recent: ROOM_TALK });
  const sent = JSON.stringify(CLOUD.calls[CLOUD.calls.length - 1]);
  _a(sent.includes("unreadable"), "the last thing said is in the prompt — a question that follows from it gets answered; one from nowhere gets ignored");
  _a(/not developers|NOT developers/i.test(sent), "and the model is told the people answering are not developers");
});

await check("AG-04", "it asks about what the room is ALREADY discussing", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  const j = await (await post({
    project: "Expenses",
    recent: "Kiran: honestly what worries me most is the whole thing failing on launch day and nobody trusting it after that.",
  })).json();
  _a(j.key === "risks", `asked about ${j.key} — a question about success metrics while everyone is deep in what could go wrong reads as a bot working a checklist`);
});

await check("AG-05", "it does not re-ask what a previous meeting already settled", async () => {
  reset();
  CLOUD.files["u1/prd/expenses.prd.json"] = JSON.stringify({
    mode: "build",
    dimensions: [
      { key: "problem", label: "Problem & value", status: "present" },
      { key: "users", label: "Target users", status: "present" },
      { key: "risks", label: "Risks & mitigations", status: "present" },
      { key: "metrics", label: "Success metrics", status: "missing" },
    ],
  });
  CLOUD.chat = () => ({ status: 200, body: GOOD });
  const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
  _a(j.key === "metrics", `asked about ${j.key} — an agent that starts every meeting from zero asks what the team answered last Tuesday, which is the fastest way to get it switched off`);
});

await check("AG-06", "a dimension already worn out is left alone", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  const j = await (await post({
    project: "Expenses", recent: ROOM_TALK,
    open: [{ key: "metrics", label: "Success metrics", status: "missing" }],
    askedKeys: ["metrics", "metrics"],
  })).json();
  _a(j.ask === false, "it stops rather than asking a third time — silence is an answer");
  _a(String(j.reason).length > 5, "and says why it went quiet");
});

// ── when things are wrong ────────────────────────────────────────────────
await check("AG-07", "only a signed-in host can run it", async () => {
  reset();
  const r = await post({ project: "P", recent: ROOM_TALK }, "not-a-token");
  _a(r.status === 401, `HTTP ${r.status} — an open model endpoint in a room anyone can join is a bill anyone can run up`);
});

await check("AG-08", "before anybody speaks it stays quiet", async () => {
  reset();
  const j = await (await post({ project: "P", recent: "" })).json();
  _a(j.ask === false && /nothing/i.test(j.reason), "no transcript, no question");
  _a(CLOUD.calls.length === 0, "and it does not pay a model to tell it that");
});

await check("AG-09", "an unreadable request fails cleanly", async () => {
  reset();
  const r = await post("{not json");
  _a(r.status === 400, `HTTP ${r.status} — never a 500`);
});

await check("AG-10", "a model that refuses does not silence the agent", async () => {
  reset();
  CLOUD.chat = () => ({ status: 404, body: RETIRED_MODEL_404 });
  const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
  _a(j.ask === true, "it still asks — the rubric's own question is a real question");
  _a(j.options.length >= 2 && j.why, "still with answers to pick");
  _a(/404/.test(j.model_note), "and the degrade is SAID OUT LOUD, with the provider's status");
  _a(/No endpoints found/.test(j.model_note), "…and the provider's own words, so one screenshot diagnoses it");
});

await check("AG-11", "no model key at all still gets a question asked", async () => {
  reset();
  const had = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
    _a(j.ask === true && j.options.length >= 2, "the standard question for that dimension beats saying nothing");
    _a(/No model key/i.test(j.model_note), "and it says that is what happened rather than pretending it wrote it");
  } finally { process.env.OPENROUTER_API_KEY = had; }
});

await check("AG-12", "a model that ignores the format never puts an empty card on the screen", async () => {
  reset();
  CLOUD.chat = () => ({ status: 200, body: content("Great question! Let me think about that...") });
  const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
  _a(j.ask === true && j.question.length > 5, "there is still a question");
  _a(j.options.length >= 2, "and still answers to pick");
});

await check("AG-13", "a model reply with a question but no options is topped up", async () => {
  reset();
  CLOUD.chat = () => ({ status: 200, body: content('{"question":"How will you know it worked?"}') });
  const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
  _a(j.question === "How will you know it worked?", "the model's question is used");
  _a(j.options.length >= 2, "0209 holds even when the model half-complies");
});

// MAYA V2-2 — capability tiers. An account can arrive with OpenRouter, or
// with a plain OpenAI key and no Anthropic models on it at all. The tier we
// recommend is OpenRouter, so it is the one every check above exercises; this
// is the other one a real user can turn up with.
await check("AG-14", "an OpenAI-only account still gets a question asked", async () => {
  reset({ models: ["gpt-4o-mini", "gpt-4o"] });
  CLOUD.chat = () => ({ status: 200, body: GOOD });
  const had = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  try {
    const j = await (await post({ project: "Expenses", recent: ROOM_TALK })).json();
    _a(j.ask === true, "the meeting does not lose its agent because of which provider somebody signed up with");
    _a(/^gpt-/.test(CLOUD.calls[CLOUD.calls.length - 1].model), `used ${CLOUD.calls[CLOUD.calls.length - 1].model} — the provider's own naming, not Anthropic's`);
    _a(j.options.length >= 2, "with the same promise about answers to pick");
  } finally {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = had;
  }
});

await check("AG-16", "a meeting does not re-ask the provider what models it has", async () => {
  reset();
  CLOUD.chat = () => ({ status: 200, body: GOOD });
  await post({ project: "Expenses", recent: ROOM_TALK });
  const after = CLOUD.listCalls;
  await post({ project: "Expenses", recent: ROOM_TALK + "\nRaghu: and another thing." });
  _a(CLOUD.listCalls === after,
     `the model list is cached (30 minutes, lib/model.ts) — a 45-minute meeting must not spend eight round-trips finding out the same answer. listCalls went ${after} -> ${CLOUD.listCalls}`);
});

await check("AG-15", "a project's first meeting has everything open", async () => {
  reset(); CLOUD.chat = () => ({ status: 200, body: GOOD });
  const j = await (await post({ project: "Brand New", recent: ROOM_TALK })).json();
  _a(j.ask === true && j.key, "with no saved assessment it still knows what to ask about");
});

await check("AG-17", "the brief reaches the question asked in the room", async () => {
  reset();
  CLOUD.files["u1/prd/expenses.project.json"] = JSON.stringify({
    brief: "A receipt filer for the finance team so nobody keeps paper.", decisions: [],
  });
  CLOUD.chat = () => ({ status: 200, body: GOOD });
  await post({ project: "Expenses", recent: ROOM_TALK });
  const sent = JSON.stringify(CLOUD.calls[CLOUD.calls.length - 1]);
  _a(sent.includes("A receipt filer for the finance team"),
     "THE FIRST MEETING'S FIX: without this the agent knows a project NAME and asks the generic question for the dimension — a checklist, not an assistant");
  _a(/THEIR product/i.test(sent), "and it is told to ask about their product, using their nouns");
});

await check("AG-18", "a game brief puts the agent on the game rubric from minute one", async () => {
  reset();
  CLOUD.files["u1/prd/apollo.project.json"] = JSON.stringify({
    brief: "A game where you dodge waves and chase a high score.", decisions: [],
  });
  CLOUD.chat = () => ({ status: 200, body: GOOD });
  const j = await (await post({ project: "Apollo", recent: "Kiran: so the first screen." })).json();
  _a(["concept", "players", "core_loop", "mechanics", "tech", "content", "risks", "success"].includes(j.key),
     `asked about "${j.key}" — with only the name "Apollo" this would have been a web-app dimension`);
});

console.log("=".repeat(78));
console.log("  MAYA QA — the agent asking questions during the meeting");
console.log("=".repeat(78));
let passed = 0;
for (const [tid, name, status, detail] of RESULTS) {
  console.log(`  ${status === "PASS" ? "PASS" : "FAIL"}  ${tid}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (status === "PASS") passed++;
}
console.log("-".repeat(78));
console.log(`  ${passed}/${RESULTS.length} PASS`);
process.exit(passed === RESULTS.length ? 0 : 1);
