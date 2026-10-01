// The agent that sits in the meeting and asks the question nobody thought to.
//
// FIELD 2026-08-24: "build an AI agent for asking questions during the
// meeting, where a virtual agent can be enabled with a click of a button when
// the meeting starts, so live meetings are prompted with questions based on
// the project — for example Conclave follow-up questions to ensure the PRD is
// 100% complete."
//
// WHY THIS IS A REAL FEATURE AND NOT A GIMMICK: a project's PRD is scored on
// eight dimensions (lib/prd.ts, mirroring Conclave). Teams reliably talk about
// three of them — the problem, the scope, and whatever is on fire — and
// reliably never mention the other five. Two weeks later the PRD comes back
// 4/8 and somebody has to schedule ANOTHER meeting to ask "so how will we
// know it worked?". That question cost a calendar slot and a week. Asked at
// minute nineteen, while everybody was already in the room and already
// thinking about it, it costs eleven seconds.
//
// THE HARD PART IS NOT THE QUESTION. It is not asking. An assistant that
// interrupts is turned off inside two minutes and never turned back on, so
// every rule below is about EARNING the interruption:
//
//   · one question at a time, never a list;
//   · only in a pause — never over somebody's sentence;
//   · only when the room has actually produced new material since last time;
//   · about the dimension the room is ALREADY discussing where possible, so
//     it reads as a good follow-up and not as a form being filled in;
//   · never the same thing twice, and never a third time after being ignored
//     twice — silence is an answer;
//   · a hard cap per meeting, because the meeting belongs to the people in it.
//
// ZERO-IMPORT. Everything here is decided without a model, a network or a
// browser, so the thing that decides whether to interrupt a real meeting can
// be argued with in a test.

// ── the cadence ───────────────────────────────────────────────────────────

/** Never sooner than this after the last question. Long enough that the room
 *  gets a real stretch of its own conversation back; short enough that a
 *  45-minute meeting can still close five or six dimensions. */
export const MIN_GAP_MS = 180_000;

/** And never before the room has actually said something new. Sixty words is
 *  roughly twenty-five seconds of speech — below that there is nothing to
 *  have a fresh opinion about, and asking again reads as nagging. */
export const MIN_NEW_WORDS = 60;

/** A pause. The agent speaks into the gap between sentences, never across
 *  one. Two and a half seconds is the beat at the end of a thought — long
 *  enough not to be an interruption, short enough that the moment is still
 *  the moment. */
export const PAUSE_MS = 2500;

/** The meeting belongs to the people in it. Even a 90-minute session gets at
 *  most this many, and the agent stops without being told to. */
export const MAX_QUESTIONS = 8;

/** Ask about the same dimension at most twice. Ignored twice is an answer:
 *  they do not want to talk about it now, and a third ask is the assistant
 *  arguing with the room. */
export const MAX_PER_DIMENSION = 2;

/** Nothing at all in the first two minutes. People are still arriving,
 *  saying hello and finding their microphone; a question landing in the
 *  middle of that is the worst first impression the feature can make. */
export const WARMUP_MS = 120_000;

// Spec sessions are the opposite product. A solo host is talking a PRD out;
// the interview IS the meeting. Team meetings keep the silence-biased
// constants above. These fire only when AgentState.spec is true.
/** First prompt soon — they sat down to be interviewed, not to wait. */
export const SPEC_WARMUP_MS = 15_000;
/** After an answer, the next prompt. A solo host often goes quiet waiting. */
export const SPEC_MIN_GAP_MS = 25_000;
/** Do not demand a dump of new speech first. Zero means "ask anyway". */
export const SPEC_MIN_NEW_WORDS = 0;
/** Eight dimensions × a prompt and a follow-up, with a little room. */
export const SPEC_MAX_QUESTIONS = 24;
/** A thin answer gets one follow-up before the agent moves on. */
export const SPEC_MAX_PER_DIMENSION = 3;

// ── what the agent knows ──────────────────────────────────────────────────

export type AgentAsk = {
  /** the rubric dimension this closes */
  key: string;
  label: string;
  question: string;
  options: string[];
  why: string;
  /** when it was put to the room */
  at: number;
  /** did anybody engage with it */
  answered?: boolean;
};

export type AgentState = {
  /** the person switched it on — nothing happens until they do */
  on: boolean;
  /** ms since the meeting started */
  elapsedMs: number;
  /** ms since the last thing anybody said (the pause) */
  quietMs: number;
  /** ms since the agent last asked, or 0 if it never has */
  sinceAskMs: number;
  /** words spoken since the agent last asked */
  newWords: number;
  /** everything asked so far this meeting */
  asked: AgentAsk[];
  /** dimensions still open, most blocking first */
  open: Array<{ key: string; label: string; status: string }>;
  /** a question is already on screen waiting for the room */
  pending: boolean;
  /** a spec session interviews; a team meeting stays silence-biased */
  spec?: boolean;
  /** captions are actually on and producing a clock the agent can trust.
   *  undefined means "not specified" — existing callers without the field
   *  still ask. Only an explicit false is deafness. */
  hearing?: boolean;
};

export type AgentVerdict = {
  ask: boolean;
  /** why not, in words the UI can show the host — an agent that is silent for
   *  a reason is very different from an agent that is broken, and the person
   *  who switched it on deserves to know which they have. */
  reason: string;
  /** the dimension to ask about, when asking */
  key?: string;
};

const countAsks = (asked: AgentAsk[], key: string) =>
  (asked || []).filter((a) => a && a.key === key).length;

/** THE WHOLE POINT OF THIS FILE. Ordered so the cheap, certain refusals come
 *  first and the judgement calls come last. */
/** Everything the room can tell the agent, in wall-clock milliseconds.
 *
 *  ONE CLOCK. lastWordsAt null means nobody has spoken yet — quietMs is
 *  time since startedAt, not a caption .at added to startedAt (that bug
 *  made pause detection lie). */
export function observe(o: {
  now: number;
  lastWordsAt: number | null;
  lastAskAt: number;
  startedAt: number;
  wordsNow: number;
  wordsAtAsk: number;
}): { elapsedMs: number; quietMs: number; sinceAskMs: number; newWords: number } {
  const origin = o.lastWordsAt == null ? o.startedAt : o.lastWordsAt;
  return {
    elapsedMs: Math.max(0, o.now - o.startedAt),
    quietMs: Math.max(0, o.now - origin),
    sinceAskMs: o.lastAskAt ? Math.max(0, o.now - o.lastAskAt) : 0,
    newWords: Math.max(0, o.wordsNow - o.wordsAtAsk),
  };
}

export function shouldAsk(s: AgentState): AgentVerdict {
  const spec = Boolean(s.spec);
  const warmup = spec ? SPEC_WARMUP_MS : WARMUP_MS;
  const gap = spec ? SPEC_MIN_GAP_MS : MIN_GAP_MS;
  const minWords = spec ? SPEC_MIN_NEW_WORDS : MIN_NEW_WORDS;
  const maxQ = spec ? SPEC_MAX_QUESTIONS : MAX_QUESTIONS;
  const maxPer = spec ? SPEC_MAX_PER_DIMENSION : MAX_PER_DIMENSION;
  if (!s.on) return { ask: false, reason: "" };
  if (s.hearing === false) {
    return { ask: false, reason: "Captions are off — I can't hear the room. Turn captions on and I'll start." };
  }
  if (s.pending) return { ask: false, reason: "Waiting for an answer to the last question." };
  if (!s.open || !s.open.length) {
    return { ask: false, reason: "Nothing left to ask — every open part has been covered." };
  }
  if ((s.asked || []).length >= maxQ) {
    return { ask: false, reason: `That's ${maxQ} questions — the rest can wait for the notes.` };
  }
  if (s.elapsedMs < warmup) {
    return { ask: false, reason: spec
      ? "Give me a moment to listen, then I'll ask."
      : "Listening while everyone settles in." };
  }
  if (s.sinceAskMs && s.sinceAskMs < gap) {
    return { ask: false, reason: "Just asked — giving the room the floor back." };
  }
  if (s.newWords < minWords) {
    return { ask: false, reason: "Listening — nothing new to build a question on yet." };
  }
  if (s.quietMs < PAUSE_MS) {
    return { ask: false, reason: "Waiting for a pause — it won't talk over anyone." };
  }
  const key = pickDimension(s.open, s.asked, maxPer);
  if (!key) {
    return { ask: false, reason: "The open parts have all been raised once already." };
  }
  return { ask: true, reason: "", key };
}

/** Which dimension to ask about. `missing` before `partial` — a dimension
 *  with nothing at all in it is worth more than one that needs sharpening —
 *  and anything already asked twice is out. Ties break on the rubric's own
 *  order, which is the order Conclave lists them in, which is roughly the
 *  order a product is decided in. */
export function pickDimension(
  open: Array<{ key: string; label: string; status: string }>,
  asked: AgentAsk[],
  maxPer: number = MAX_PER_DIMENSION
): string {
  const cap = maxPer > 0 ? maxPer : MAX_PER_DIMENSION;
  const live = (open || []).filter((d) => d && d.key && countAsks(asked, d.key) < cap);
  if (!live.length) return "";
  const missing = live.find((d) => String(d.status) === "missing");
  return (missing || live[0]).key;
}

/** Re-rank the open dimensions by what the room is ALREADY talking about, so
 *  the question lands as a follow-up rather than as a form.
 *
 *  A question about success metrics while everybody is deep in the data model
 *  is technically correct and socially wrong — it reads as a bot working
 *  through a checklist, which is exactly the thing that gets it switched off.
 *  Asking about the thing under discussion reads as somebody paying
 *  attention. Relevance only REORDERS; it never adds or removes, because the
 *  rubric decides what must be closed and the conversation only decides
 *  when. */
const DIMENSION_CUES: Record<string, string[]> = {
  problem: ["problem", "pain", "why", "value", "matter", "solve", "need"],
  users: ["user", "customer", "audience", "who", "consumer", "buyer", "team", "people"],
  scope: ["scope", "v1", "first version", "mvp", "ship", "cut", "must have", "nice to have", "feature"],
  architecture: ["architecture", "stack", "backend", "frontend", "framework", "hosting", "server", "database", "api", "infra"],
  data_model: ["data", "table", "schema", "entity", "field", "store", "record", "model", "column"],
  ui_flows: ["screen", "page", "flow", "click", "button", "ui", "ux", "design", "journey", "onboarding"],
  risks: ["risk", "worry", "concern", "fail", "danger", "blocker", "problem if", "what if"],
  metrics: ["metric", "measure", "kpi", "success", "target", "number", "track", "conversion", "retention"],
  concept: ["concept", "feel", "fantasy", "theme", "genre", "vibe"],
  players: ["player", "platform", "console", "phone", "desktop", "controller"],
  core_loop: ["loop", "gameplay", "repeat", "session", "turn", "round"],
  mechanics: ["mechanic", "power", "level", "score", "combo", "difficulty"],
  tech: ["engine", "unity", "godot", "canvas", "webgl", "build"],
  content: ["art", "asset", "sprite", "music", "sound", "look", "style"],
  success: ["fun", "replay", "engagement", "success", "signal"],
  question: ["question", "answer", "ask", "unknown"],
  sources: ["source", "paper", "study", "data from", "reference", "citation"],
  methodology: ["method", "approach", "compare", "analysis", "framework"],
  findings: ["finding", "result", "found", "shows", "evidence"],
  counterpoints: ["counter", "objection", "against", "downside", "opposing"],
  recommendation: ["recommend", "conclusion", "decide", "advise"],
  data_sources: ["source", "warehouse", "table", "feed", "import", "pipeline"],
  transforms: ["transform", "aggregate", "join", "calculate", "etl", "compute"],
  visualizations: ["chart", "graph", "dashboard", "visual", "plot", "report"],
  quality: ["quality", "accuracy", "stale", "null", "trust", "check"],
  decisions: ["decision", "action", "act on", "drive"],
  goal: ["goal", "constraint", "criteria", "optimize"],
  options: ["option", "direction", "alternative", "idea"],
  tradeoffs: ["tradeoff", "trade-off", "cost", "downside", "versus"],
  differentiation: ["different", "unique", "competitor", "moat", "stand out"],
  next_step: ["next step", "prototype", "test", "try", "validate"],
};

/** WORD BOUNDARIES, and this one was caught by audit/maya_agent_qa.mjs AG-04
 *  before it ever reached a meeting.
 *
 *  The first version matched substrings. So in "what worries me most is the
 *  WHOLE thing failing on launch day", the cue "who" — which is there because
 *  people say "who is this for" — matched "whole", and the agent decided the
 *  room was discussing its TARGET USERS. It then asked a question about users
 *  in the middle of a conversation about risk, which is precisely the
 *  non-sequitur this ranking exists to prevent. lib/prd.ts already had the
 *  boundary rule for mode detection ("landscaper" is not "landscape") and
 *  this file did not; one module learning a lesson is not the codebase
 *  learning it. */
/** Live-caption intents — light local tags, not the brain.
 *
 *  The model still writes the question. These only REORDER which open PRD
 *  dimension to raise next, so a decision in the last few turns biases the
 *  ask toward scope/tradeoffs, a named persona toward users, a "park it for
 *  v2" toward deferral/scope — FSD-style: intent + context, not checklist. */
export const CAPTION_INTENTS = [
  "decision",
  "constraint",
  "user_story",
  "risk",
  "deferral",
  "acceptance",
  "persona",
  "metric",
] as const;
export type CaptionIntent = (typeof CAPTION_INTENTS)[number];

const INTENT_CUES: Record<CaptionIntent, string[]> = {
  decision: ["decide", "decided", "decision", "going with", "we'll go", "we will go", "pick", "chosen", "settled on", "locking in"],
  constraint: ["must", "have to", "can't", "cannot", "constraint", "budget", "deadline", "limited to", "nonnegotiable", "hard requirement"],
  user_story: ["user story", "as a", "they need to", "want to be able", "so that they", "journey", "use case"],
  risk: ["risk", "worry", "worried", "concern", "what if", "might fail", "blocker", "afraid", "fragile"],
  deferral: ["later", "not now", "v2", "out of scope", "park", "defer", "postpone", "after launch", "next version", "phase two"],
  acceptance: ["done when", "acceptance", "definition of done", "ship when", "ready when", "pass if", "accept if"],
  persona: ["persona", "who is this for", "target user", "customer is", "for people who", "audience", "buyer"],
  metric: ["metric", "kpi", "measure", "success if", "track", "conversion", "retention", "north star", "number we"],
};

/** Which open dimensions a detected intent should nudge toward. Boost only —
 *  never invents a dim that is not already open. */
const INTENT_TO_DIMS: Record<CaptionIntent, string[]> = {
  decision: ["scope", "architecture", "options", "recommendation", "next_step", "tradeoffs", "goal"],
  constraint: ["scope", "goal", "architecture", "tech", "problem"],
  user_story: ["users", "ui_flows", "problem", "players", "core_loop"],
  risk: ["risks", "counterpoints", "tradeoffs", "quality"],
  deferral: ["scope", "next_step", "options"],
  acceptance: ["metrics", "success", "goal", "quality"],
  persona: ["users", "players", "problem"],
  metric: ["metrics", "success", "quality", "decisions"],
};

function cueHits(textNorm: string, cues: string[]): number {
  let hits = 0;
  for (const c of cues) {
    const k = String(c || "").toLowerCase().trim();
    if (!k) continue;
    const pat = k.includes(" ")
      ? `\\s${k.replace(/\s+/g, "\\s")}\\s`
      : k.endsWith("y")
        ? `\\s${k.slice(0, -1)}(y|ies|ied|ying)\\s`
        : `\\s${k}(s|es|ed|ing)?\\s`;
    if (new RegExp(pat).test(textNorm)) hits++;
  }
  return hits;
}

function normalizeCaptionText(recentText: string): string {
  return ` ${String(recentText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
}

/** Dominant intents in the recent caption window, strongest first. */
export function detectIntents(recentText: string): Array<{ intent: CaptionIntent; hits: number }> {
  const t = normalizeCaptionText(recentText);
  if (!t.trim()) return [];
  const scored: Array<{ intent: CaptionIntent; hits: number }> = [];
  for (const intent of CAPTION_INTENTS) {
    const hits = cueHits(t, INTENT_CUES[intent]);
    if (hits > 0) scored.push({ intent, hits });
  }
  return scored.sort((a, b) => (b.hits - a.hits) || a.intent.localeCompare(b.intent));
}

/** Extra ranking weight from caption intents → related open dims. */
export function intentDimBoost(
  key: string,
  intents: Array<{ intent: CaptionIntent; hits: number }>
): number {
  const k = String(key || "");
  if (!k || !intents?.length) return 0;
  let boost = 0;
  for (const { intent, hits } of intents) {
    const dims = INTENT_TO_DIMS[intent] || [];
    if (dims.includes(k)) boost += hits;
  }
  return boost;
}

/** Drop open dims the room just covered in substance — reinforce anti-reask.
 *  High bar: enough recent speech AND strong topic match. Never empties the
 *  list (falls back to the original open set). */
export function dropCoveredByRecent(
  open: Array<{ key: string; label: string; status: string }>,
  recentText: string
): Array<{ key: string; label: string; status: string }> {
  const list = open || [];
  const words = String(recentText || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 40 || !list.length) return list;
  const kept = list.filter((d) => d && relevance(d.key, recentText) < 3);
  return kept.length ? kept : list;
}

export function relevance(key: string, recentText: string): number {
  const cues = DIMENSION_CUES[String(key || "")] || [];
  if (!cues.length) return 0;
  const t = ` ${String(recentText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let hits = 0;
  for (const c of cues) {
    // Multi-word cues ("what if", "next step") are matched whole; single
    // words match with their common endings, so "worries" hits "worry" and
    // "failing" hits "fail", without "whole" hitting "who".
    const k = String(c || "").toLowerCase().trim();
    if (!k) continue;
    const pat = k.includes(" ")
      ? `\\s${k.replace(/\s+/g, "\\s")}\\s`
      // A cue ending in -y needs its own stem, or "worry" never matches
      // "worries" — which is the word people actually use when they are
      // telling you the risk.
      : k.endsWith("y")
        ? `\\s${k.slice(0, -1)}(y|ies|ied|ying)\\s`
        : `\\s${k}(s|es|ed|ing)?\\s`;
    if (new RegExp(pat).test(t)) hits++;
  }
  return hits;
}

/** The rubric decides WHAT is still open; the conversation decides WHICH of
 *  those to raise now. Topic cues + caption-intent boosts reorder; equal
 *  scores keep rubric order. */
export function rankOpen(
  open: Array<{ key: string; label: string; status: string }>,
  recentText: string
): Array<{ key: string; label: string; status: string }> {
  const intents = detectIntents(recentText);
  return (open || [])
    .map((d, i) => ({
      d,
      i,
      r: relevance(d.key, recentText) + intentDimBoost(d.key, intents),
    }))
    .sort((a, b) => (b.r - a.r) || (a.i - b.i))
    .map((x) => x.d);
}

/** Did the room actually engage with the question, or talk straight past it?
 *
 *  Deliberately generous about what counts as engagement and deliberately
 *  dumb about what counts as an answer — this decides whether to ASK AGAIN,
 *  not whether the dimension is closed. The model's next readiness pass
 *  decides that. Getting this wrong in the generous direction costs one
 *  un-asked question; getting it wrong the other way is an assistant that
 *  repeats itself, which is the behaviour people actually complain about. */
export function looksAnswered(ask: AgentAsk, textSince: string): boolean {
  const t = String(textSince || "").toLowerCase().trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  // Anything under a dozen words after a question is "hmm" and a pause.
  if (words.length < 12) return false;
  // Somebody picking one of the offered answers, in their own words.
  for (const o of ask.options || []) {
    const key = String(o || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4).slice(0, 3);
    if (key.length && key.every((w) => t.includes(w))) return true;
  }
  // Or the room simply carried on about that subject at length, which is the
  // commonest and best kind of answer.
  return relevance(ask.key, t) >= 2 && words.length >= 25;
}

// ── what the agent says ───────────────────────────────────────────────────

/** The line it opens with when somebody switches it on. It says what it will
 *  do AND what it will not do, because the second half is what makes people
 *  leave it on. */
export function specOpeningLine(projectName: string, total: number): string {
  const name = String(projectName || "").trim();
  return (
    `I'm on. Talk through what you're building${name ? ` — ${name}` : ""}. ` +
    `I'll walk the ${total} parts of the PRD so nothing is missing, one question at a time, only in a pause. ` +
    "Talk, then answer the questions that come up."
  );
}

export function openingLine(projectName: string, total: number, opts?: { spec?: boolean; turnedCaptionsOn?: boolean }): string {
  const base = opts?.spec
    ? specOpeningLine(projectName, total)
    : (() => {
        const name = String(projectName || "").trim();
        return (
          `I'm listening for the ${total} things ${name ? `${name}'s` : "this project's"} PRD needs. ` +
          "I'll ask at most one question at a time, only in a pause, and never more than " +
          `${MAX_QUESTIONS} in a meeting. Anyone can dismiss a question or switch me off.`
        );
      })();
  if (!opts?.turnedCaptionsOn) return base;
  return base + " Captions just came on so I can hear the room.";
}

/** How many open dims the live strip shows before it collapses the rest to "+N". */
export const SPEC_GAP_CAP = 6;

export type SpecGapDim = { key: string; label?: string; status?: string };

export type SpecGapChip = { key: string; label: string; highlight: boolean };

export type SpecGapView = {
  /** room should paint the strip — agent on, or an ask still on screen */
  visible: boolean;
  chips: SpecGapChip[];
  /** open dims past the cap, for a "+N" chip */
  more: number;
  /** the dim the current ask is closing, if that dim is still on the strip */
  highlightKey: string;
};

/** Chip text. Rubric label when we have one — never a raw key if a label exists. */
export function gapChipLabel(dim: { key?: string; label?: string } | null | undefined): string {
  const label = String(dim?.label || "").trim();
  if (label) return label;
  return String(dim?.key || "").trim().replace(/_/g, " ");
}

/**
 * Which dims the live spec-gap strip shows, and which chip the current ask highlights.
 *
 * Visible when the agent is on OR an ask is on screen — host toggle still decides
 * whether questions are generated; this only decides whether the room can see the
 * remaining gaps. Caps at 6. The highlighted dim is pinned into the visible set
 * even if it would have fallen past the cap, so the question on screen always
 * points at a chip. Answered / dropped dims are simply absent from `open` — they
 * leave the strip. Never invents a chip for a key that is not still open.
 */
export function specGapStrip(opts: {
  open?: Array<SpecGapDim> | null;
  highlightKey?: string | null;
  agentOn?: boolean;
  askOnScreen?: boolean;
  cap?: number;
}): SpecGapView {
  const agentOn = Boolean(opts?.agentOn);
  const askOnScreen = Boolean(opts?.askOnScreen);
  const wanted = String(opts?.highlightKey || "").trim();
  const capRaw = opts?.cap;
  const cap = Number.isFinite(capRaw) && (capRaw as number) > 0
    ? Math.floor(capRaw as number)
    : SPEC_GAP_CAP;

  const seen = new Set<string>();
  const open: SpecGapDim[] = [];
  for (const d of opts?.open || []) {
    const key = String(d?.key || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    open.push({ key, label: String(d?.label || "").trim(), status: d?.status });
  }

  if ((!agentOn && !askOnScreen) || !open.length) {
    return { visible: false, chips: [], more: 0, highlightKey: "" };
  }

  const hi = wanted && seen.has(wanted) ? wanted : "";
  const pinned = hi ? open.filter((d) => d.key === hi) : [];
  const rest = open.filter((d) => d.key !== hi);
  const ordered = [...pinned, ...rest];
  const shown = ordered.slice(0, cap);
  const chips: SpecGapChip[] = shown.map((d) => ({
    key: d.key,
    label: gapChipLabel(d),
    highlight: Boolean(hi) && d.key === hi,
  }));
  return {
    visible: chips.length > 0,
    chips,
    more: Math.max(0, ordered.length - shown.length),
    highlightKey: hi,
  };
}

/** What the host sees while it is on and quiet. An assistant with no visible
 *  state is indistinguishable from a broken one. */
export function statusLine(s: AgentState, verdict: AgentVerdict): string {
  if (!s.on) return "";
  const done = (s.asked || []).length;
  const left = Math.max(0, (s.open || []).length);
  const names = (s.open || []).map((d) => d.label).filter(Boolean);
  const openList = names.slice(0, 4).join(" · ") + (names.length > 4 ? ` · +${names.length - 4}` : "");
  if (verdict.reason) return verdict.reason;
  if (s.spec && openList) {
    if (!done) return `Listening — still open: ${openList}.`;
    return `${done} asked · still open: ${openList}.`;
  }
  if (!done) return `Listening — ${left} part${left === 1 ? "" : "s"} still open.`;
  return `${done} asked · ${left} still open.`;
}

export function agentQuestionPrompt(opts: {
  projectName: string;
  artifact: string;
  key: string;
  label: string;
  desc: string;
  recent: string;
  alreadyAsked: string[];
  /** what the team wrote down that this project IS. Two or three sentences,
   *  typed once. Without it a first meeting's question is the generic one for
   *  the dimension; with it the question is about their actual product, which
   *  is the difference between an assistant and a form. */
  brief?: string;
  /** full host-console context (brief + between-meeting decisions), from
   *  lib/prd contextBlock. Prefer this over brief alone — decisions already
   *  answered outside the room must not be re-asked as if they were open. */
  context?: string;
  /** a spec session: pull a missing detail, do not recap. */
  spec?: boolean;
  /** light local intent tags from the recent caption window — hint only. */
  intents?: Array<{ intent: CaptionIntent; hits: number }>;
}): string {
  const brief = String(opts.brief || "").trim();
  const context = String(opts.context || "").trim();
  const stated = context
    ? `\n${context}\n`
    : brief
      ? `\nThe team describes the project this way, in their own words:\n\n  ${brief}\n`
      : "";
  const intents = (opts.intents && opts.intents.length)
    ? opts.intents
    : detectIntents(opts.recent);
  const intentLine = intents.length
    ? `Dominant intents in what they JUST said (local tags, verify against the transcript): ${intents.map((x) => x.intent).slice(0, 4).join(", ")}.`
    : "";
  return [
    `You are sitting in a live meeting about ${String(opts.projectName || "this project").trim() || "this project"}.`,
    "You are driving to a complete PRD. Ask the single highest-leverage missing detail given what was JUST said. Never ignore recent context for a random rubric row.",
    stated,
    `The team is building a ${opts.artifact}, and one part of it is still open:`,
    "",
    `  ${opts.key}: ${opts.label} — ${opts.desc}`,
    "",
    "Here is the last few minutes of what was actually said:",
    "",
    String(opts.recent || "").trim() || "(nothing yet)",
    "",
    intentLine,
    "",
    opts.alreadyAsked.length
      ? `You have already asked these — do not repeat them:\n${opts.alreadyAsked.map((q) => `  - ${q}`).join("\n")}\n`
      : "",
    "Ask ONE concrete follow-up that closes that gap — grounded in their recent words, not a checklist prompt.",
    "",
    opts.spec
      ? "This is a solo spec interview. Pull a MISSING detail — specific users, v1 vs out of scope, a success metric, or the top risk. Do not recap what they already said. If almost nothing has been said yet, ask the most useful opening question for this dimension."
      : "",
    "",
    "RULES, and they matter more than the question being clever:",
    "- It goes on a screen in front of people who are mid-conversation. One",
    "  sentence. Under 20 words. No preamble, no 'I noticed that'.",
    "- The people answering are NOT developers. Ask in the product's language —",
    "  what a person using this would see, feel or do. Never 'data model',",
    "  'schema', 'architecture' or 'success metric'.",
    "- Prefer a follow-up that quotes a short phrase they just used (a few",
    "  words in quotes) over an abstract rubric prompt. If they named a",
    "  decision, constraint, persona, risk, deferral, acceptance bar, or",
    "  metric — dig into THAT, tied to the open dimension above.",
    "- Build on what they were JUST saying. A question that follows from the",
    "  last thing said gets answered; one that arrives from nowhere gets ignored.",
    "- If the recent talk already answered this dimension, do not restate it —",
    "  ask the next missing detail on this dim, or say the gap is closed in why.",
    (context || brief)
      ? "- Ask about THEIR product, using their own nouns from the description above. A generic question about this dimension is one they could have got from a checklist. Do not re-ask a decision they already took deliberately."
      : "",
    "- Offer 2 or 3 short answers they could pick, most likely first. Each one",
    "  is a complete answer, not a category.",
    "- Say in one plain sentence what this choice actually changes for them.",
    "",
    'Respond with STRICT JSON ONLY: {"question":"...","options":["...","..."],"why":"..."}',
  ].filter(Boolean).join("\n");
}

/** Parse the agent's reply, with the 0209 floor: a question never reaches a
 *  meeting bare. If the model returns no options, the dimension's defaults
 *  are used — the promise cannot depend on model compliance. */
export function parseAgentQuestion(
  raw: string,
  fallback: { question: string; options: string[]; why: string }
): { question: string; options: string[]; why: string } {
  let parsed: any = null;
  const s = String(raw || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { parsed = JSON.parse(s.slice(start, end + 1)); } catch { parsed = null; }
  }
  const q = String(parsed?.question || "").trim();
  const opts = (Array.isArray(parsed?.options) ? parsed.options : [])
    .filter((o: any) => typeof o === "string" || typeof o === "number")
    .map((o: any) => String(o).trim().slice(0, 90))
    .filter(Boolean)
    .slice(0, 3);
  const why = String(parsed?.why || "").trim().slice(0, 200);
  return {
    question: q || fallback.question,
    options: opts.length ? opts : fallback.options,
    why: why || fallback.why,
  };
}
