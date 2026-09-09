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
  shouldAsk, observe, pickDimension, rankOpen, relevance, looksAnswered, parseAgentQuestion, agentQuestionPrompt,
  statusLine, openingLine, specOpeningLine,
  detectIntents, intentDimBoost, dropCoveredByRecent,
  specGapStrip, gapChipLabel, SPEC_GAP_CAP,
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
import { contextBlock as prdContextBlock, answeredKeys as prdAnsweredKeys } from "./prd.ts";
const decided = { brief: "A receipt filer for finance.", decisions: [{ key: "scope", question: "V1?", answer: "Receipts only", at: "2026-01-01" }] };
const ctxPrompt = agentQuestionPrompt({ ...base, context: prdContextBlock(decided) });
ok(ctxPrompt.includes("Receipts only") && ctxPrompt.includes("[scope]"),
  "contextBlock (brief + between-meeting decisions) reaches the live question prompt");
ok(/do not re-ask a decision/i.test(ctxPrompt),
  "…and the model is told not to re-ask deliberate console decisions");
ok(prdAnsweredKeys(decided).join() === "scope",
  "answeredKeys from lib/prd is the same helper Build PRD uses — exclude those dims from open");
ok(pickDimension(
  [{ key: "scope", label: "Scope", status: "missing" }, { key: "metrics", label: "Metrics", status: "missing" }]
    .filter((d) => !prdAnsweredKeys(decided).includes(d.key)),
  []
) === "metrics",
  "excluding answeredKeys from open makes the next ask a different dim");

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

// ── 10. captions are the ears; pause uses one wall clock ─────────────────
ok(shouldAsk({ ...GO, hearing: false }).ask === false,
  "captions-off: shouldAsk refuses");
ok(/caption|hear/i.test(shouldAsk({ ...GO, hearing: false }).reason),
  "…and the reason mentions captions/hear so the host can fix it");
ok(shouldAsk(GO).ask === true,
  "hearing omitted does not refuse — existing callers without the field still ask");

const NOW = 1_700_000_000_000;
const started = NOW - 600_000;
const paused = observe({
  now: NOW, lastWordsAt: NOW - 4_000, lastAskAt: 0,
  startedAt: started, wordsNow: 900, wordsAtAsk: 0,
});
ok(paused.quietMs === 4_000,
  "quietMs uses wall-clock lastWordsAt, not a caption offset added to startedAt");
ok(paused.elapsedMs === 600_000, "elapsedMs is the same wall clock since startedAt");
const nobody = observe({
  now: NOW, lastWordsAt: null, lastAskAt: 0,
  startedAt: started, wordsNow: 0, wordsAtAsk: 0,
});
ok(nobody.quietMs === 600_000,
  "nobody has spoken yet: quietMs is time since startedAt, not a caption .at");

ok(/caption/i.test(openingLine("P", 8, { turnedCaptionsOn: true })),
  "openingLine turnedCaptionsOn mentions captions");
ok(/walk the PRD|nothing is missing/i.test(openingLine("P", 8, { spec: true })),
  "spec opening still interviewer voice");
ok(!/settles in/i.test(openingLine("P", 8, { spec: true })),
  "spec opening does not say everyone settles in");
ok(!/caption/i.test(openingLine("P", 8)),
  "team opening does not mention captions unless they were just turned on");

import { readFileSync } from "node:fs";
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AGENT_TSX = strip(readFileSync(new URL("../app/room/[room]/Agent.tsx", import.meta.url), "utf8"));
const CONF_TSX = strip(readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8"));
ok(/enableCaptions/.test(AGENT_TSX) && /captionsOn/.test(AGENT_TSX),
  "Agent.tsx calls enableCaptions / captionsOn");
ok(/captionsOn=\{cc\.on\}/.test(CONF_TSX) && /enableCaptions=\{cc\.enable\}/.test(CONF_TSX),
  "Conference passes captionsOn and enableCaptions");
ok(/\{current \? \(/.test(AGENT_TSX) && !/on && current/.test(AGENT_TSX),
  "qa-card renders when current is set — NOT gated on agent toggle (room-wide ask)");
ok(/isHost=\{isHost\}/.test(CONF_TSX) && /isHost \? \(/.test(AGENT_TSX),
  "PRD agent toggle is host-only; Conference passes isHost");
ok(/Agent asking/.test(AGENT_TSX),
  "non-hosts see a read-only Agent asking chip instead of the generation toggle");
ok(/setOpen\(\(o\) => o\.filter/.test(AGENT_TSX),
  "live answer drops that key from local open so the next ask targets a different dim");
ok(/!isHost \|\| !on/.test(AGENT_TSX),
  "shouldAsk tick is host+on only — guests never call /api/agent/question");
ok(/const enable = useCallback\(\(\) => \{ if \(!on\) toggle\(\); \}/.test(CONF_TSX),
  "enable only turns captions ON");


// ── 11. caption intents: FSD-style follow-ups, not checklist spam ─────────
const riskTalk = "what worries me is the whole thing failing on launch day and that risk is a real blocker";
const riskIntents = detectIntents(riskTalk);
ok(riskIntents.some((x) => x.intent === "risk"),
  "detectIntents tags risk talk as risk");
ok(detectIntents("").length === 0, "empty captions yield no intents");
ok(detectIntents("hello there how are you today").length === 0,
  "NEGATIVE CONTROL: chit-chat without PRD intent yields no tags");
ok(intentDimBoost("risks", [{ intent: "risk", hits: 2 }]) >= 2,
  "intentDimBoost nudges the risks dim when risk intent fires");
ok(intentDimBoost("metrics", [{ intent: "risk", hits: 2 }]) === 0,
  "…and does not invent a boost for an unrelated dim");
const deferTalk = "lets park analytics for v2 and keep that out of scope for now after launch";
ok(detectIntents(deferTalk).some((x) => x.intent === "deferral"),
  "deferral / out-of-scope talk is tagged");
const personaTalk = "the target user is a buyer in finance — who is this for if not that audience";
ok(detectIntents(personaTalk).some((x) => x.intent === "persona"),
  "persona / audience talk is tagged");
const metricTalk = "our north star metric is retention and the kpi we track is conversion";
ok(detectIntents(metricTalk).some((x) => x.intent === "metric"),
  "metric / kpi talk is tagged");
// Intent boost can surface a related open dim ahead of rubric order when the
// room just made a decision — still only reorders open dims.
const openWithScope = [
  { key: "metrics", label: "Success metrics", status: "missing" },
  { key: "scope", label: "Scope", status: "missing" },
  { key: "risks", label: "Risks", status: "missing" },
];
const decidedRank = rankOpen(openWithScope, "we decided we are going with receipts only and settled on that decision");
ok(decidedRank[0].key === "scope",
  "decision intent boosts scope ahead of a bare metrics-first rubric order");
ok(rankOpen(openWithScope, "").map((d) => d.key).join(",") === "metrics,scope,risks",
  "NEGATIVE CONTROL: no captions → rubric order unchanged");
// Anti-reask: recent substance on a dim drops it when other dims remain.
const coveredTalk = [
  "the success metric we measure is retention and the kpi number we track is forty percent",
  "conversion is the other measure and we will track that north star every week as our metric",
  "so that is the full success story on how we measure whether this worked for the team",
].join(" ");
const afterDrop = dropCoveredByRecent(openWithScope, coveredTalk);
ok(!afterDrop.find((d) => d.key === "metrics") && afterDrop.some((d) => d.key === "scope"),
  "dropCoveredByRecent skips a dim the room just covered in substance");
ok(dropCoveredByRecent(openWithScope, "short").length === openWithScope.length,
  "…but short captions never drop anything");
ok(dropCoveredByRecent([{ key: "metrics", label: "", status: "missing" }], coveredTalk).length === 1,
  "NEGATIVE CONTROL: never empties open — falls back when every dim looks covered");
const intentPrompt = agentQuestionPrompt({
  projectName: "Apollo", artifact: "PRD", key: "risks", label: "Risks",
  desc: "What could go wrong.", recent: riskTalk, alreadyAsked: [],
  intents: riskIntents,
});
ok(/highest-leverage missing detail/i.test(intentPrompt),
  "prompt drives to a complete PRD from what was JUST said");
ok(/Never ignore recent context/i.test(intentPrompt),
  "…and forbids ignoring recent talk for a random rubric row");
ok(/quotes a short phrase|follow-up that quotes/i.test(intentPrompt),
  "…prefers quoting their words over abstract checklist");
ok(/Dominant intents/i.test(intentPrompt) && /risk/.test(intentPrompt),
  "…surfaces detected intent tags for the model to verify");
ok(/concrete follow-up/i.test(intentPrompt),
  "…asks for a concrete follow-up, not a generic gap fill");

const ROUTE_TS = strip(readFileSync(new URL("../app/api/agent/question/route.ts", import.meta.url), "utf8"));
ok(/dropCoveredByRecent/.test(ROUTE_TS) && /detectIntents/.test(ROUTE_TS),
  "question route applies dropCoveredByRecent + detectIntents before asking");
ok(/intents/.test(ROUTE_TS),
  "…and passes intent tags into agentQuestionPrompt");





// ── 12. live spec-gap strip: which chips, which highlight ────────────────
const EIGHT = [
  { key: "problem", label: "Problem & value", status: "missing" },
  { key: "users", label: "Target users", status: "missing" },
  { key: "scope", label: "Requirements & v1 scope", status: "missing" },
  { key: "architecture", label: "Architecture & stack", status: "missing" },
  { key: "data_model", label: "Data model", status: "missing" },
  { key: "ui_flows", label: "Key UI flows", status: "missing" },
  { key: "risks", label: "Risks & mitigations", status: "missing" },
  { key: "metrics", label: "Success metrics", status: "missing" },
];
ok(SPEC_GAP_CAP === 6, "the strip caps at six chips before a +N");
ok(specGapStrip({ open: EIGHT, agentOn: false, askOnScreen: false }).visible === false,
  "hidden when the agent is off and no ask is on screen — not a second rail sitting there forever");
ok(specGapStrip({ open: [], agentOn: true, askOnScreen: false }).visible === false,
  "nothing open means no strip, even with the agent on");
const shown = specGapStrip({ open: EIGHT, agentOn: true, askOnScreen: false });
ok(shown.visible && shown.chips.length === 6 && shown.more === 2,
  "agent on: six human-labelled chips and +2 for the rest");
ok(shown.chips.every((c) => c.label && !c.label.includes("_")),
  "chips use rubric labels, not raw keys");
ok(shown.chips[0].label === "Problem & value" && shown.chips[0].highlight === false,
  "with no ask, nothing is highlighted");
const hi = specGapStrip({ open: EIGHT, highlightKey: "metrics", agentOn: true, askOnScreen: true });
ok(hi.highlightKey === "metrics" && hi.chips[0].key === "metrics" && hi.chips[0].highlight === true,
  "the dim the current ask is closing is highlighted and pinned into the visible set even past the cap");
ok(hi.chips.filter((c) => c.highlight).length === 1, "only that one chip is highlighted");
ok(hi.more === 2, "pinning the highlight does not drop the +N for the dims still past the cap");
const quietAsk = specGapStrip({ open: EIGHT, highlightKey: "users", agentOn: false, askOnScreen: true });
ok(quietAsk.visible && quietAsk.chips[0].key === "users" && quietAsk.chips[0].highlight,
  "an ask still on screen keeps the strip up and highlighted even if generation was switched off");
const answered = EIGHT.filter((d) => d.key !== "metrics");
const after = specGapStrip({ open: answered, highlightKey: "metrics", agentOn: true, askOnScreen: false });
ok(!after.chips.some((c) => c.key === "metrics") && after.highlightKey === "",
  "an answered or dropped dim leaves the strip — the helper does not invent a chip for a key that is gone");
ok(gapChipLabel({ key: "data_model", label: "Data model" }) === "Data model",
  "a rubric label wins over the key");
ok(gapChipLabel({ key: "data_model", label: "" }) === "data model",
  "without a label the key is spaced, not shown raw with an underscore");
ok(specGapStrip({
  open: [EIGHT[0], EIGHT[0], { key: "", label: "Nope" }, EIGHT[1]],
  agentOn: true,
}).chips.map((c) => c.key).join(",") === "problem,users",
  "duplicate and empty keys are collapsed, order otherwise kept");
ok(/qa-gaps/.test(AGENT_TSX) && /specGapStrip/.test(AGENT_TSX),
  "Agent.tsx paints the strip from specGapStrip — a chip row, not a second live-notes rail");
ok(/kind: "gaps"/.test(AGENT_TSX),
  "the open list is broadcast on qm-agent so guests see chips clear too");
ok(/!isHostRef\.current/.test(AGENT_TSX) && /kind === "gaps"/.test(AGENT_TSX),
  "guests apply the gaps shout; the host does not apply its own echo");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
