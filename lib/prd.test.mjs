/**
 * MAYA GUARD — the PRD a project's meetings produce.
 *
 * Maya asks: "We recorded four meetings about this thing. Why am I still
 * writing the spec by hand, and why does the one the app gave me score 4/8
 * when I paste it into Conclave?"
 *
 * FIELD 2026-08-24: "Quantlys Meeting should have capability to produce PRD
 * from the recordings by project, similar to Conclave PRD which can be
 * attached to build products in Quantlys Conclave."
 *
 * THE GUARDS THAT MATTER MOST ARE THE DRIFT ONES. This file's rubric is a
 * COPY of quantlys-api/conclave/conclave/context.py and readiness.py — a copy
 * across a repo boundary and a language boundary, which is the exact shape of
 * thing that silently rots. Conclave's `_normalize` DROPS any dimension key
 * it does not recognise and backfills the rest as "missing", so one renamed
 * key here does not raise an error over there: it produces a PRD that scores
 * lower for no visible reason. Every key below is pinned.
 *
 * Run: node lib/prd.test.mjs
 */
import {
  RUBRICS, MODES, DEFAULT_MODE, MODE_META, rubricFor, metaFor, detectMode, anyKeyword,
  DEFAULT_SUGGESTIONS, suggestionsFor, STATUS_SCORE, PRD_MAX, OPTION_MAX, WHY_MAX,
  normalizeReport, fallbackReport, extractJson, bestEffortClose, roundHalfEven, topUpOptions,
  stitchTranscripts, handoffPlan, prdMarkdown, prdFilename, prdPath,
  prdPrompt, prdSystemPrompt,
  acceptBrief, acceptDecision, mergeDecisions, answeredKeys, contextBlock,
  detectModeFor, detectModeWhy, projectPath, BRIEF_MAX, DECISION_MAX, DECISIONS_KEPT,
} from "./prd.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. the contract with Conclave, key by key ────────────────────────────
ok(RUBRICS.build.map((d) => d.key).join(",") ===
   "problem,users,scope,architecture,data_model,ui_flows,risks,metrics",
  "THE CONTRACT: the build rubric is Conclave's eight keys, in Conclave's order — a rename here is a PRD that silently scores lower over there, with no error anywhere");
ok(RUBRICS.game.map((d) => d.key).join(",") === "concept,players,core_loop,mechanics,tech,content,risks,success",
  "…and the game rubric matches too");
ok(RUBRICS.research.map((d) => d.key).join(",") === "question,scope,sources,methodology,findings,counterpoints,recommendation",
  "…and research");
ok(RUBRICS.data_bi.map((d) => d.key).join(",") === "question,data_sources,metrics,transforms,visualizations,quality,decisions",
  "…and data/BI");
ok(RUBRICS.brainstorm.map((d) => d.key).join(",") === "problem,goal,options,tradeoffs,differentiation,next_step",
  "…and brainstorm");
ok(MODES.join(",") === "build,game,research,data_bi,brainstorm" && DEFAULT_MODE === "build",
  "the modes and the default are Conclave's");
ok(MODE_META.build.artifact === "PRD" && MODE_META.build.gate === "Build-ready",
  "a build produces a PRD and the gate is called Build-ready — the words appear in the document and in the prompt");
ok(MODE_META.research.artifact === "Research brief" && MODE_META.data_bi.gate === "Spec-ready",
  "…and the other artifacts and gates are the ones Conclave names");
ok(rubricFor("nonsense").map((d) => d.key).join(",") === RUBRICS.build.map((d) => d.key).join(","),
  "an unknown mode falls back to build rather than to nothing");
ok(RUBRICS.build.every((d) => d.key && d.label && d.desc),
  "every dimension carries the description the model is given — a key with no description is a dimension the model has to guess at");

// ── 2. which rubric a project gets ───────────────────────────────────────
ok(detectMode("we're building a game with levels and a score") === "game",
  "a game is scored on its core loop, not on its data model");
ok(detectMode("a dashboard of KPIs from the warehouse") === "data_bi", "a dashboard gets the BI rubric");
ok(detectMode("let's research the competitive landscape") === "research", "research gets the research rubric");
ok(detectMode("build an app for tracking expenses") === "build", "and a product gets the PRD rubric");
ok(detectMode("") === "build" && detectMode("mmm hmm yeah") === "build",
  "a meeting about nothing recognisable still gets a rubric — no mode is not an option");
ok(anyKeyword("the landscaper came round", ["landscape"]) === false,
  "word boundaries: 'landscaper' does not make this a research project. NEGATIVE CONTROL for a substring match, which is how a gardening chat became a literature review");
ok(anyKeyword("we shipped two features", ["feature"]) === true, "…but a plural still matches");

// ── 3. QUANTLYS-0209: a question is never bare ───────────────────────────
const bare = normalizeReport({ dimensions: RUBRICS.build.map((d) => ({ key: d.key, status: "missing" })) }, "build");
ok(bare.open_questions.length === 8, "every unmet dimension becomes a question");
ok(bare.open_questions.every((q) => q.question && q.options.length >= 2 && q.why),
  "0209: even when the model returns nothing but a status, every question arrives with pickable answers and a reason — a consumer clicks, they do not compose");
ok(bare.open_questions.every((q) => !/data model|schema|architecture/i.test(q.question)),
  "…and none of them are written in the spec's language. NEGATIVE CONTROL for 'Can you specify the data model?', the phrasing a customer called unanswerable");
ok(Object.keys(DEFAULT_SUGGESTIONS).length >= 30 && suggestionsFor("nope").options.length >= 2,
  "…and a key with no entry still gets options rather than an empty box");

// ── 4. the score, and what 'ready' means ─────────────────────────────────
ok(STATUS_SCORE.present === 1 && STATUS_SCORE.partial === 0.5 && STATUS_SCORE.missing === 0,
  "partial is worth half — Conclave's arithmetic, so the number in the meeting app is the number in Conclave");
const mixed = normalizeReport({ dimensions: [
  { key: "problem", status: "present", evidence: "Kiran named it" },
  { key: "users", status: "partial" },
  { key: "scope", status: "missing" },
] }, "build");
ok(mixed.total === 8 && mixed.present_count === 1,
  "dimensions the model forgot are counted as missing, not dropped — a PRD cannot score 1/1");
ok(mixed.score === 0.188, "the score is rounded to three places, like Conclave's");
// CAUGHT IN THE FIELD SUITE (audit/maya_prd_qa.mjs, PRD-02) before it shipped.
// Python rounds a tie to the EVEN digit; JavaScript rounds a tie up. Two
// present and one partial out of eight is exactly 0.3125 — Conclave would
// print 0.312 and this app would have printed 0.313, for the same project, in
// two windows, for ever. Every one of these values is what python3 actually
// answered for round(n/8, 3):
const PY = { 0.5: 0.062, 1.0: 0.125, 1.5: 0.188, 2.5: 0.312, 3.5: 0.438, 4.5: 0.562, 5.5: 0.688, 6.5: 0.812, 7.5: 0.938 };
ok(Object.entries(PY).every(([n, want]) => roundHalfEven(Number(n) / 8, 3) === want),
  "THE SCORE IS PYTHON'S NUMBER: every half-step rounds the way Conclave's round() rounds it, to the even digit");
ok(Math.round((2.5 / 8) * 1000) / 1000 === 0.313 && roundHalfEven(2.5 / 8, 3) === 0.312,
  "NEGATIVE CONTROL: plain Math.round really does disagree — this row is the bug, written down");
ok(mixed.ready === false && mixed.blocking.length === 7, "and nothing is ready while anything is unmet");
const all = normalizeReport({ dimensions: RUBRICS.build.map((d) => ({ key: d.key, status: "present", evidence: "settled" })) }, "build");
ok(all.ready === true && all.score === 1 && all.open_questions.length === 0,
  "all eight present is build-ready, with nothing left to ask");
ok(all.dimensions.every((d) => d.question === "" && d.options.length === 0 && d.why === ""),
  "a settled dimension carries no question — a checklist that keeps asking about the thing you answered is the thing people turn off");

// ── 5. the caps, which are storage contracts not style ───────────────────
const fat = normalizeReport({
  dimensions: [{ key: "problem", status: "missing", question: "q?", why: "y".repeat(400),
                 options: ["a".repeat(200), "b", "c", "d", "e"] }],
  prd: "#".repeat(40000),
}, "build");
ok(fat.dimensions[0].options.length === 3, "at most three options — a fourth is a menu, not a decision");
// Also caught by the field suite: a model that returns ONE option got one
// option, because backfilling only ever triggered on an empty list.
const single = normalizeReport({ dimensions: [{ key: "scope", status: "partial", question: "What ships first?", options: ["Photo upload only"] }] }, "build");
const scopeQ = single.open_questions.find((q) => q.key === "scope");
ok(scopeQ.options.length >= 2,
  "AT LEAST TWO: one option is not a choice, it is a suggestion with no alternative — and in a live meeting the buttons exist precisely so nobody has to compose an answer out loud");
ok(scopeQ.options[0] === "Photo upload only",
  "…and the model's own option stays FIRST, because it was written for this conversation; the defaults only top it up");
ok(topUpOptions(["Smallest thing that works — cut everything optional"], "scope").length === 2,
  "an option that duplicates a default does not appear twice");
ok(fat.dimensions[0].options[0].length === OPTION_MAX, `an option is capped at ${OPTION_MAX} chars`);
ok(fat.dimensions[0].why.length === WHY_MAX, `the reason is capped at ${WHY_MAX}`);
ok(fat.prd.length === PRD_MAX,
  `the document is capped at ${PRD_MAX} — Conclave truncates there, so a longer one would CHANGE when it is handed over`);

// ── 6. reading a model that was asked for JSON ───────────────────────────
ok(extractJson('here you go: {"dimensions":[{"key":"problem"}]} hope that helps')?.dimensions?.length === 1,
  "prose around the object is ignored");
ok(extractJson('```json\n{"dimensions":[{"key":"users"}]}\n```')?.dimensions?.length === 1, "so are code fences");
ok(extractJson('{"summary":"x"}\n{"dimensions":[{"key":"scope"}]}')?.dimensions?.length === 1,
  "the object with dimensions in it wins over an earlier one without — a model that thinks out loud in JSON still gets read");
ok(extractJson('{"dimensions":[{"key":"problem"},]}')?.dimensions?.length === 1, "a trailing comma is forgiven");
ok(extractJson('{"dimensions":[{"key":"problem","status":"present"}],"prd":"# PRD\\n```js\\nconst x = {a:1}\\n```"}')?.prd?.includes("const x"),
  "a PRD that embeds its own code fences does not break the span — braces inside a string are not structure");
const cut = extractJson('{"dimensions":[{"key":"problem","status":"partial"}],"prd":"# PRD\\n\\nThe thing we are bui');
ok(cut?.dimensions?.length === 1 && String(cut.prd).includes("The thing we are bui"),
  "a reply cut off mid-document at the token limit is salvaged, not thrown away — that is the common failure on a long PRD, and losing the whole assessment over it means paying twice");
ok(extractJson("no json here at all") === null && extractJson("") === null,
  "and a reply with nothing in it is null, not a fabricated report");
ok(bestEffortClose('{"a":[1,2') === '{"a":[1,2]}', "the repair closes what was open, in the right order");

// ── 7. when it cannot be assessed at all ─────────────────────────────────
const bad = fallbackReport("the model answered 502", "build");
ok(bad.prd === "" && bad.assessment_error === "the model answered 502",
  "a failed assessment produces NO document and says why. NEGATIVE CONTROL for the worst possible bug in this feature: a confident invented PRD that somebody then builds from");
ok(bad.dimensions.length === 8 && bad.open_questions.length === 8 && bad.ready === false,
  "…and still asks every question, so the meeting was not wasted");
ok(fallbackReport("x", "game").total === 8 && fallbackReport("x", "research").total === 7,
  "the fallback respects the mode's own rubric");

// ── 8. a project is several meetings ─────────────────────────────────────
const src = [
  { title: "Kickoff", at: "2026-08-01", transcript: "A".repeat(50) },
  { title: "Scope", at: "2026-08-08", transcript: "B".repeat(50) },
  { title: "Latest", at: "2026-08-20", transcript: "C".repeat(50) },
];
const st = stitchTranscripts(src, 100000);
ok(st.used === 3 && st.text.indexOf("Kickoff") < st.text.indexOf("Latest"),
  "meetings arrive oldest first, so 'the later meeting wins' is a thing the model can actually see");
ok(st.text.includes("2026-08-01"), "each is headed with its date, so the model can tell which is later");
const tight = stitchTranscripts(src, 120);
ok(tight.used >= 1 && tight.dropped >= 1 && tight.text.includes("Latest") && !tight.text.includes("Kickoff"),
  "over budget it drops the OLDEST — a project's current position is at the end. NEGATIVE CONTROL for truncating the tail, which would build the PRD from the meeting where nothing was decided yet");
ok(stitchTranscripts([{ transcript: "" }], 100).used === 0, "a meeting with no transcript contributes nothing rather than an empty heading");

// ── 9. the handoff, and the lie it refuses to tell ───────────────────────
const plan = handoffPlan(all, "Quantlys Meet");
ok(plan.length === 3 && /paste/i.test(plan[1].what + plan[1].detail),
  "the handoff is a PASTE, in three named steps");
ok(!plan.some((s) => /\bsend to conclave\b|automatic|one.click|we'?ll attach/i.test(`${s.what} ${s.detail}`)),
  "THE HONESTY GUARD: nothing here claims a one-click send. Conclave has no endpoint that accepts a PRD — export-prd writes a file OUT, state.prd is written only by its own readiness pass, and creating a conversation takes no body. A button claiming otherwise would be a lie with a spinner on it");
ok(handoffPlan(bare, "P")[2].what.includes("8"), "when questions are open the third step says how many");

// ── 10. the document a person receives ───────────────────────────────────
const md = prdMarkdown(bare, "Quantlys Meet", src);
ok(md.includes("Build-ready: 0 of 8"), "the document leads with its own score");
ok(bare.open_questions.every((q) => md.includes(q.question)),
  "…and carries every open question with it. A PRD handed over without them looks finished and is not");
ok(md.includes("Built from 3 recorded meetings") && md.includes("Kickoff"),
  "…and says which meetings it came from, so a claim in it can be traced to a conversation");
ok(prdMarkdown(all, "P", src).includes("This is build-ready"), "a complete one says so plainly");
ok(prdFilename("Quantlys Meet", "PRD") === "quantlys-meet-prd.md" && prdFilename("", "") === "project-prd.md",
  "the file has a name a person can find again");
ok(prdPath("u-1", "Quantlys Meet") === "u-1/prd/quantlys-meet.prd.json",
  "…and it is stored under the owner's own prefix, so the ownership check that guards every other route guards this one");

// ── 11. what the model is actually told ──────────────────────────────────
const sys = prdSystemPrompt("PRD", "Build-ready");
ok(/NEVER INVENT/i.test(sys) && /TBD/.test(sys),
  "the prompt's loudest instruction is not to invent — a section marked TBD is information, an invented one is a decision nobody made");
ok(/MINUTES\/HOURS/.test(sys) && /Post-V1/.test(sys),
  "…and it carries Conclave's timeline and shippability calibrations, so the roadmap is agent-scale and V1 is self-contained");
ok(/not developers|NOT developers/i.test(sys) && /options/.test(sys),
  "…and 0209 again: the questions are for the people who were in the meeting");
ok(/thinking out loud|floated/i.test(sys),
  "MEETINGS ARE NOT DELIBERATIONS: the prompt says an idea somebody floated is 'missing', not 'partial'. This is the whole difference between reading a transcript and reading a spec");
const up = prdPrompt("hello", RUBRICS.build, MODE_META.build);
ok(up.includes("problem: Problem & value") && /later|LATER/.test(up),
  "the user prompt lists the required dimensions and says the later meeting wins");

// ── 12. the project's own words ──────────────────────────────────────────
//
// FIELD 2026-08-25: "How do users enter the project goals so readiness has a
// context and asks the right follow-up questions?" They could not — the only
// thing typed about a project was its NAME.

ok(detectModeFor({ project: "Apollo" }) === "build",
  "NEGATIVE CONTROL, and this is the bug: a project called 'Apollo' is scored as a web app by DEFAULT, not by evidence. The name told us nothing and there was nowhere else to look");
ok(detectModeFor({ project: "Apollo", brief: "a game where you dodge waves and chase a high score" }) === "game",
  "…one sentence of brief and it is scored on its core loop instead. That is the entire fix, in one row");
ok(detectModeFor({ project: "Apollo", brief: "an app for filing expenses", transcript: "the player dodges waves" }) === "build",
  "the BRIEF outranks the transcript: what the team wrote down on purpose beats what happened to get said");
ok(detectModeFor({ project: "Q4 dashboard" }) === "data_bi",
  "a name that DOES carry evidence still works — the brief is the better signal, not the only one");
ok(detectModeFor({}) === "build", "and nothing at all still yields a rubric");
// Caught while writing the row above: detectMode returns "build" both when the
// text SAYS "app" and when it says nothing recognisable, because build is also
// the default — so "did this source have an opinion?" was unanswerable, and a
// perfectly good brief was being overruled by the transcript.
ok(detectModeWhy("an app for filing expenses").matched === true &&
   detectModeWhy("Apollo").matched === false,
  "'matched' separates a real build signal from a defaulted one. NEGATIVE CONTROL: both return mode 'build', so the mode alone cannot tell them apart");

const b = acceptBrief("  We are building   a receipt filer.  ");
ok(b.ok && b.value === "We are building a receipt filer.", "a brief is trimmed and its whitespace collapsed");
ok(acceptBrief("").ok && acceptBrief("").value === "", "no brief is a valid state, not an error — this is optional and the app works without it");
const long = acceptBrief("x".repeat(BRIEF_MAX + 500));
ok(!long.ok && /two or three sentences/i.test(long.why),
  "a two-page brief is refused with a reason: a second document competing with the one this produces means whichever the model believes, the other is now wrong");
ok(long.value.length === BRIEF_MAX, "…and what it hands back is already trimmed, so nothing oversized can be stored by ignoring the flag");

ok(!acceptDecision({ key: "scope" }).ok && /pick one|own words/i.test(acceptDecision({ key: "scope" }).why),
  "an answer with no answer in it fails with something a person can act on");
ok(!acceptDecision({ answer: "yes" }).ok, "…and an answer to nothing in particular fails too");
const d1 = acceptDecision({ key: "scope", question: "What ships first?", answer: "Photo upload only", at: "2026-08-25T10:00:00Z" }).value;
const d2 = acceptDecision({ key: "scope", question: "What ships first?", answer: "Add export too", at: "2026-08-26T10:00:00Z" }).value;
ok(d1.answer === "Photo upload only" && d1.at === "2026-08-25T10:00:00Z", "a good answer is kept as given");
ok(acceptDecision({ key: "k", answer: "y".repeat(900) }).value.answer.length === DECISION_MAX, "and bounded");
const merged = mergeDecisions(mergeDecisions([], d1), d2);
ok(merged.length === 1 && merged[0].answer === "Add export too",
  "changing your mind REPLACES: keeping both would hand the model the job of choosing which one you meant");
ok(mergeDecisions(mergeDecisions([], d1), acceptDecision({ key: "users", answer: "finance team" }).value).length === 2,
  "…but a different question is a different answer");
let many = [];
for (let i = 0; i < DECISIONS_KEPT + 20; i++) many = mergeDecisions(many, acceptDecision({ key: `k${i}`, answer: "a" }).value);
ok(many.length === DECISIONS_KEPT, "the list is bounded, oldest dropped");
ok(answeredKeys({ brief: "", decisions: [d2] }).join() === "scope", "the panel can tell which questions are already answered");

ok(contextBlock({ brief: "", decisions: [] }) === "",
  "a project with nothing stated produces NO block — the prompt reads exactly as it did before this feature existed");
const blk = contextBlock({ brief: "A receipt filer for the finance team.", decisions: [d2] });
ok(blk.includes("A receipt filer for the finance team."), "the brief reaches the prompt");
ok(/stated intent/i.test(blk), "…labelled as intent, so the model weighs the transcripts against it rather than treating it as another transcript");
ok(blk.includes("Add export too") && /outranks/i.test(blk),
  "…and a decision taken deliberately is marked as outranking what was said in a meeting. Somebody sat down and chose");
ok(blk.includes("[scope]"), "each decision names the dimension it closes");

const withCtx = prdPrompt("Kiran: hello", RUBRICS.build, MODE_META.build, { brief: "A receipt filer.", decisions: [d2] });
ok(withCtx.indexOf("Kiran: hello") < withCtx.indexOf("A receipt filer."),
  "the stated context sits AFTER the transcripts — the same place 'the later one wins' puts it");
ok(prdPrompt("Kiran: hello", RUBRICS.build, MODE_META.build) === prdPrompt("Kiran: hello", RUBRICS.build, MODE_META.build, null),
  "NEGATIVE CONTROL: no context and null context produce the identical prompt");

ok(projectPath("u-1", "Quantlys Meet") === "u-1/prd/quantlys-meet.project.json",
  "the stated context is stored under the owner's prefix");
ok(projectPath("u-1", "Quantlys Meet") !== prdPath("u-1", "Quantlys Meet"),
  "…and NOT in the assessment file. THE REBUILD GUARD: the assessment is regenerated every time somebody presses Build, and a rebuild must never wipe the sentences a person wrote");


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
