/**
 * MAYA GUARD — the agent in the meeting.
 *
 * Maya asks: "There's a bot in my meeting now. When exactly does it talk, and
 * what stops it talking over me?"
 *
 * FIELD 2026-08-24: "build an AI agent for asking questions during the
 * meeting… so live meetings are prompted with questions based on the project
 * — Conclave follow-up questions to ensure the PRD is 100% complete."
 *
 * This feature's failure mode is not being WRONG, it is being ANNOYING. An
 * assistant that interrupts is switched off in the first two minutes and
 * never switched back on, and then the eight dimensions it existed to close
 * stay open for ever. So almost every guard below is about a refusal, and
 * each one has a negative control proving the refusal is real rather than
 * decorative.
 *
 * Run: node lib/agent.test.mjs
 */
import {
  shouldAsk, pickDimension, rankOpen, relevance, looksAnswered, parseAgentQuestion, agentQuestionPrompt,
  statusLine, openingLine, specOpeningLine,
  MIN_GAP_MS, MIN_NEW_WORDS, PAUSE_MS, MAX_QUESTIONS, MAX_PER_DIMENSION, WARMUP_MS,
  SPEC_WARMUP_MS, SPEC_MIN_GAP_MS, SPEC_MIN_NEW_WORDS, SPEC_MAX_QUESTIONS, SPEC_MAX_PER_DIMENSION,
} from "./agent.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const OPEN = [
  { key: "problem", label: "Problem & value", status: "partial" },
  { key: "metrics", label: "Success metrics", status: "missing" },
  { key: "risks", label: "Risks & mitigations", status: "missing" },
];
// A state where every gate is already open — each guard below closes exactly
// one of them, so a passing row means that ONE rule did the refusing.
const GO = {
  on: true, elapsedMs: WARMUP_MS + 1, quietMs: PAUSE_MS + 1, sinceAskMs: MIN_GAP_MS + 1,
  newWords: MIN_NEW_WORDS + 1, asked: [], open: OPEN, pending: false,
};
const ask = (o) => shouldAsk({ ...GO, ...o });

// ── 1. it asks, when everything is right ─────────────────────────────────
ok(ask({}).ask === true && ask({}).key === "metrics",
  "with the room in a pause, three minutes since the last one, and new things said, it asks — about a MISSING dimension before a partial one");

// ── 2. and refuses, for reasons a person can read ────────────────────────
ok(ask({ on: false }).ask === false, "switched off means silent — no exceptions, no 'just this one'");
ok(ask({ elapsedMs: WARMUP_MS - 1 }).ask === false,
  `nothing in the first ${WARMUP_MS / 60000} minutes: people are still arriving and finding their microphone. NEGATIVE CONTROL: one millisecond later it would ask`);
ok(ask({ elapsedMs: WARMUP_MS + 1 }).ask === true, "…and one millisecond later it does");
ok(ask({ quietMs: PAUSE_MS - 1 }).ask === false,
  "it will not talk over a sentence — it waits for a real pause. This is the single rule that decides whether the feature survives its first meeting");
ok(ask({ sinceAskMs: MIN_GAP_MS - 1 }).ask === false,
  `and never twice inside ${MIN_GAP_MS / 60000} minutes, however open the PRD is`);
ok(ask({ newWords: MIN_NEW_WORDS - 1 }).ask === false,
  "…nor before the room has said anything new. A question with nothing behind it is nagging");
ok(ask({ pending: true }).ask === false, "one question at a time — never a second on top of an unanswered one");
ok(ask({ asked: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ key: `k${i}`, at: 0, options: [] })) }).ask === false,
  `and it stops at ${MAX_QUESTIONS} without being told to — the meeting belongs to the people in it`);
ok(ask({ open: [] }).ask === false, "nothing open, nothing to ask");
ok(shouldAsk({ ...GO, on: false }).reason === "",
  "an agent that is OFF says nothing at all — a status line from a switched-off feature is noise");
for (const patch of [{ elapsedMs: 0 }, { quietMs: 0 }, { sinceAskMs: 1 }, { newWords: 0 }, { pending: true }, { open: [] }]) {
  const v = shouldAsk({ ...GO, ...patch });
  if (!(v.ask === false && v.reason.length > 8)) { fail++; console.error("  FAIL - silent refusal with no reason:", JSON.stringify(patch)); }
}
ok(true, "every refusal carries a sentence the host can read — an assistant that is quiet for a reason and one that is broken must not look identical");

// ── 3. which dimension, and when to let one go ───────────────────────────
ok(pickDimension(OPEN, []) === "metrics", "missing before partial: a dimension with nothing in it is worth more than one that needs sharpening");
ok(pickDimension([{ key: "problem", label: "", status: "partial" }], []) === "problem", "…but a partial one is asked about when it is all there is");
const twice = [{ key: "metrics", at: 1, options: [] }, { key: "metrics", at: 2, options: [] }];
ok(pickDimension(OPEN, twice) === "risks",
  `asked ${MAX_PER_DIMENSION} times and ignored, it moves on. Silence is an answer — a third ask is the assistant arguing with the room`);
ok(pickDimension([{ key: "metrics", label: "", status: "missing" }], twice) === "",
  "…and when everything open has been worn out it asks nothing at all rather than repeating itself");

// ── 4. asking about what the room is actually discussing ─────────────────
const talking = "so the schema would have a table for each customer and the fields we store";
ok(relevance("data_model", talking) > relevance("metrics", talking),
  "it can tell what the room is talking about");
const ranked = rankOpen([
  { key: "metrics", label: "", status: "missing" },
  { key: "risks", label: "", status: "missing" },
], "what worries me is the whole thing failing on launch day");
ok(ranked[0].key === "risks",
  "…and raises THAT one first. A question about success metrics while everybody is deep in what could go wrong is technically correct and socially wrong — it reads as a bot working a checklist");
ok(rankOpen(OPEN, "").map((d) => d.key).join(",") === "problem,metrics,risks",
  "with nothing to go on it keeps rubric order — which is roughly the order a product gets decided in");
// CAUGHT BY THE FIELD SUITE (audit/maya_agent_qa.mjs AG-04) before it reached
// a meeting: relevance matched SUBSTRINGS, so the cue "who" — there because
// people say "who is this for" — matched "the WHOLE thing", and the agent
// decided a conversation about risk was a conversation about target users.
ok(relevance("users", "what worries me is the whole thing failing") === 0,
  "'whole' is not 'who'. NEGATIVE CONTROL for the substring match that made the agent ask about users in the middle of a risk discussion");
ok(relevance("users", "who is this actually for") >= 1, "…but the real word still counts");
ok(relevance("risks", "that worries me a lot") >= 1,
  "and 'worries' finds 'worry' — the word people actually use when they are telling you the risk, which a plain suffix rule misses");
ok(relevance("risks", "it might fail on launch") >= 1, "…as does 'failing' finding 'fail'");
ok(rankOpen(OPEN, "anything").length === OPEN.length,
  "NEGATIVE CONTROL: relevance only REORDERS. The rubric decides what must be closed; the conversation only decides when");

// ── 5. did the room answer, or talk straight past it? ────────────────────
const q = { key: "metrics", label: "", question: "How will you know it worked?", options: ["People come back a second time"], why: "", at: 0 };
ok(looksAnswered(q, "hmm") === false, "a grunt is not an answer");
ok(looksAnswered(q, "yeah I think people should come back a second time and that is the number we watch") === true,
  "somebody picking one of the offered answers in their own words counts");
ok(looksAnswered(q, "the success measure we track is retention and the target number is forty percent of people returning in week two which is what we will measure") === true,
  "…and so does the room simply carrying on about it at length, which is the best kind of answer");
ok(looksAnswered(q, "anyway about the logo, I think blue is nicer than green and we should ask the designer") === false,
  "NEGATIVE CONTROL: a long reply about something else is not an answer. Getting this wrong the generous way costs one un-asked question; getting it wrong the other way is an assistant that repeats itself");

// ── 6. the question that reaches the screen ──────────────────────────────
const fb = { question: "Fallback?", options: ["a", "b"], why: "because" };
const good = parseAgentQuestion('{"question":"Who is this for?","options":["Just us","Anyone"],"why":"It decides how simple v1 is."}', fb);
ok(good.question === "Who is this for?" && good.options.length === 2, "a well-formed reply is used as written");
ok(parseAgentQuestion("the model just chatted", fb).question === "Fallback?",
  "a model that ignores the format does not produce an empty card — the rubric's own question is a real question");
ok(parseAgentQuestion('{"question":"Q?"}', fb).options.length === 2,
  "0209 AGAIN, and this is the one that matters most in a live meeting: a question with no options makes somebody answer out loud in front of colleagues with nothing to push against");
ok(parseAgentQuestion(`{"question":"Q?","options":["${"x".repeat(300)}","b","c","d"]}`, fb).options.length === 3 &&
   parseAgentQuestion(`{"question":"Q?","options":["${"x".repeat(300)}"]}`, fb).options[0].length === 90,
  "…and options stay short and few enough to read at a glance mid-meeting");

// ── 7. what the host sees while it is quiet ──────────────────────────────
ok(statusLine({ ...GO, asked: [] }, { ask: false, reason: "Waiting for a pause — it won't talk over anyone." })
   === "Waiting for a pause — it won't talk over anyone.",
  "the status line says what it is doing right now");
ok(statusLine({ ...GO, on: false }, { ask: false, reason: "x" }) === "", "and says nothing when it is off");
ok(/at most one question|never more than/i.test(openingLine("P", 8)) && openingLine("P", 8).includes("switch me off"),
  "the line it opens with promises the LIMITS, not the feature — the half that makes people leave it on is the half about what it will not do");

// ── 8. the brief, which is what makes a FIRST meeting worth attending ─────
const base = { projectName: "Apollo", artifact: "PRD", key: "users", label: "Target users",
               desc: "Who it is for.", recent: "Kiran: right, so the upload.", alreadyAsked: [] };
const bare = agentQuestionPrompt(base);
const brief = agentQuestionPrompt({ ...base, brief: "A receipt filer for the finance team so nobody keeps paper." });
ok(brief.includes("A receipt filer for the finance team"),
  "what the team wrote about the project reaches the question the agent asks");
ok(/their own words/i.test(brief), "…labelled as their words, not as more transcript");
ok(/THEIR product/i.test(brief) && !/THEIR product/i.test(bare),
  "…and with a brief the model is told to use their nouns. NEGATIVE CONTROL: without one that instruction is absent, because telling a model to be specific about a product it knows nothing about produces invention");
ok(bare.length < brief.length && bare.includes("Apollo"),
  "a project with no brief still gets a working prompt — this is optional, and the feature degrades to what it was");

// ── 9. spec session: the interview IS the product ────────────────────────
const SPEC_GO = {
  on: true, spec: true, elapsedMs: SPEC_WARMUP_MS + 1, quietMs: PAUSE_MS + 1, sinceAskMs: 0,
  newWords: 0, asked: [], open: OPEN, pending: false,
};
const specAsk = (o) => shouldAsk({ ...SPEC_GO, ...o });
ok(specAsk({ elapsedMs: SPEC_WARMUP_MS - 1 }).ask === false,
  "spec session does not ask before warmup");
ok(/moment to listen/i.test(specAsk({ elapsedMs: SPEC_WARMUP_MS - 1 }).reason),
  "spec warmup says it will ask, not that everyone is settling in");
ok(specAsk({}).ask === true && specAsk({}).key === "metrics",
  "after SPEC_WARMUP it asks — even with no new words. A quiet solo host is waiting for the prompt");
ok(specAsk({ newWords: 0 }).ask === true,
  "SPEC_MIN_NEW_WORDS does not demand a sixty-word dump first");
ok(specAsk({ sinceAskMs: SPEC_MIN_GAP_MS - 1, newWords: 5 }).ask === false,
  "after an answer it still waits the short spec gap, not mid-sentence on the next thought");
ok(specAsk({ sinceAskMs: SPEC_MIN_GAP_MS + 1, newWords: 0 }).ask === true,
  "…then asks the next prompt without sixty new words");
ok(ask({ elapsedMs: SPEC_WARMUP_MS + 1, newWords: 0 }).ask === false,
  "NEGATIVE CONTROL: a team meeting still refuses at spec warmup with no new words — spec cadence is opt-in");
ok(ask({ elapsedMs: WARMUP_MS + 1, newWords: MIN_NEW_WORDS - 1 }).ask === false,
  "NEGATIVE CONTROL: team meetings still need sixty new words");
ok(specAsk({ asked: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ key: `k${i}`, at: 0, options: [] })) }).ask === true,
  "spec session is allowed past the team meeting's 8-question cap so the rubric can be covered");
ok(specAsk({ asked: Array.from({ length: SPEC_MAX_QUESTIONS }, (_, i) => ({ key: `k${i}`, at: 0, options: [] })) }).ask === false,
  "…and still stops, because the meeting belongs to the host");
const twiceSpec = [{ key: "metrics", at: 1, options: [] }, { key: "metrics", at: 2, options: [] }];
const thriceSpec = [...twiceSpec, { key: "metrics", at: 3, options: [] }];
ok(pickDimension(OPEN, twiceSpec) === "risks",
  "team path still moves on after two ignored asks on a dimension");
ok(pickDimension(OPEN, twiceSpec, SPEC_MAX_PER_DIMENSION) === "metrics",
  "spec session follows up a thin answer on the same dimension a third time");
ok(pickDimension(OPEN, thriceSpec, SPEC_MAX_PER_DIMENSION) === "risks",
  "…then moves on, so it does not argue with a host who already passed");
ok(/walk the PRD|nothing is missing/i.test(specOpeningLine("P", 8)) && /Talk through/i.test(specOpeningLine("P", 8)),
  "spec opening line is an interviewer walking the PRD, not a waiter while everyone settles in");
ok(!/settles in/i.test(specOpeningLine("P", 8)),
  "…and does not talk about everyone settling in");
ok(/still open/i.test(statusLine(SPEC_GO, { ask: false, reason: "" })),
  "spec status names the parts of the PRD still open so the host can see the checklist");
const specPrompt = agentQuestionPrompt({ ...base, spec: true });
ok(/missing detail|specific users|success metric/i.test(specPrompt),
  "spec question prompt tells the model to pull a missing PRD detail, not recap");
ok(!/solo spec interview/i.test(bare),
  "NEGATIVE CONTROL: team-meeting prompts do not switch into interview mode");


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
