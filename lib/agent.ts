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
export function shouldAsk(s: AgentState): AgentVerdict {
  if (!s.on) return { ask: false, reason: "" };
  if (s.pending) return { ask: false, reason: "Waiting for an answer to the last question." };
  if (!s.open || !s.open.length) {
    return { ask: false, reason: "Nothing left to ask — every part of the PRD has been covered." };
  }
  if ((s.asked || []).length >= MAX_QUESTIONS) {
    return { ask: false, reason: `That's ${MAX_QUESTIONS} questions — the rest can wait for the notes.` };
  }
  if (s.elapsedMs < WARMUP_MS) {
    return { ask: false, reason: "Listening while everyone settles in." };
  }
  if (s.sinceAskMs && s.sinceAskMs < MIN_GAP_MS) {
    return { ask: false, reason: "Just asked — giving the room the floor back." };
  }
  if (s.newWords < MIN_NEW_WORDS) {
    return { ask: false, reason: "Listening — nothing new to build a question on yet." };
  }
  if (s.quietMs < PAUSE_MS) {
    return { ask: false, reason: "Waiting for a pause — it won't talk over anyone." };
  }
  const key = pickDimension(s.open, s.asked);
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
  asked: AgentAsk[]
): string {
  const live = (open || []).filter((d) => d && d.key && countAsks(asked, d.key) < MAX_PER_DIMENSION);
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
 *  those to raise now. Stable: equal relevance keeps rubric order. */
export function rankOpen(
  open: Array<{ key: string; label: string; status: string }>,
  recentText: string
): Array<{ key: string; label: string; status: string }> {
  return (open || [])
    .map((d, i) => ({ d, i, r: relevance(d.key, recentText) }))
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
export function openingLine(projectName: string, total: number): string {
  const name = String(projectName || "").trim();
  return (
    `I'm listening for the ${total} things ${name ? `${name}'s` : "this project's"} PRD needs. ` +
    "I'll ask at most one question at a time, only in a pause, and never more than " +
    `${MAX_QUESTIONS} in a meeting. Anyone can dismiss a question or switch me off.`
  );
}

/** What the host sees while it is on and quiet. An assistant with no visible
 *  state is indistinguishable from a broken one. */
export function statusLine(s: AgentState, verdict: AgentVerdict): string {
  if (!s.on) return "";
  const done = (s.asked || []).length;
  const left = Math.max(0, (s.open || []).length);
  if (verdict.reason) return verdict.reason;
  if (!done) return `Listening — ${left} part${left === 1 ? "" : "s"} of the PRD still open.`;
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
}): string {
  const brief = String(opts.brief || "").trim();
  return [
    `You are sitting in a live meeting about ${String(opts.projectName || "this project").trim() || "this project"}.`,
    brief ? `\nThe team describes the project this way, in their own words:\n\n  ${brief}\n` : "",
    `The team is building a ${opts.artifact}, and one part of it is still open:`,
    "",
    `  ${opts.key}: ${opts.label} — ${opts.desc}`,
    "",
    "Here is the last few minutes of what was actually said:",
    "",
    String(opts.recent || "").trim() || "(nothing yet)",
    "",
    opts.alreadyAsked.length
      ? `You have already asked these — do not repeat them:\n${opts.alreadyAsked.map((q) => `  - ${q}`).join("\n")}\n`
      : "",
    "Ask ONE question that closes that gap.",
    "",
    "RULES, and they matter more than the question being clever:",
    "- It goes on a screen in front of people who are mid-conversation. One",
    "  sentence. Under 20 words. No preamble, no 'I noticed that'.",
    "- The people answering are NOT developers. Ask in the product's language —",
    "  what a person using this would see, feel or do. Never 'data model',",
    "  'schema', 'architecture' or 'success metric'.",
    "- Build on what they were JUST saying where you can. A question that",
    "  follows from the last thing said gets answered; one that arrives from",
    "  nowhere gets ignored.",
    brief
      ? "- Ask about THEIR product, using their own nouns from the description above. A generic question about this dimension is one they could have got from a checklist."
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
