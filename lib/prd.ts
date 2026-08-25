// The PRD a project's meetings are already carrying.
//
// FIELD 2026-08-24: "Quantlys Meeting should have capability to produce PRD
// from the recordings by project, similar to Conclave PRD which can be
// attached to build products in Quantlys Conclave."
//
// The thing that makes this worth building is that it is not a new document
// format. Quantlys Conclave already decides what "build-ready" means, in
// quantlys-api/conclave/conclave/readiness.py and context.py: five rubrics,
// a fixed set of dimension keys per mode, a three-value status, a score, and
// a set of open questions phrased for a CONSUMER rather than a developer.
// That rubric is the product's definition of done. A meeting app that invents
// its own headings produces a document that looks like a PRD and cannot be
// handed to the thing that builds products.
//
// So this module is a MIRROR, and it is deliberately a copy rather than an
// import — the two live in different repos and different languages. Every
// value here traces to a line over there, and lib/prd.test.mjs pins the ones
// that would silently drift.
//
// THE ONE THING THIS CANNOT DO, said out loud because a fake integration is
// worse than an honest gap: Conclave has NO endpoint that accepts a PRD.
// `POST /api/conclave/export-prd` is outbound only; `state.prd` is written
// only by its own `run_readiness`; `POST /api/conversations` takes no body.
// The real handoff is therefore "the PRD becomes the first message of a
// conclave" (or an attachment on one), and handoffPlan() below produces
// exactly that, with the steps named. See lib/prd.test.mjs for the guard that
// keeps anybody from claiming otherwise.
//
// ZERO-IMPORT so it travels and so every judgement here is testable without a
// network, a model, or a browser.

// ── the rubrics, mirrored from conclave/conclave/context.py ────────────────

export type Dim = { key: string; label: string; desc: string };

const _d = (key: string, label: string, desc: string): Dim => ({ key, label, desc });

/** mode -> ordered dimensions. The KEYS are the contract: Conclave's
 *  `_normalize` drops any key not in its rubric and backfills the rest as
 *  "missing", so a key that drifts here becomes a dimension that silently
 *  reads as a gap over there. */
export const RUBRICS: Record<string, Dim[]> = {
  build: [
    _d("problem", "Problem & value", "The core problem being solved and why it matters / the value delivered."),
    _d("users", "Target users", "Who it is for — specific user segments and their context."),
    _d("scope", "Requirements & v1 scope", "The concrete v1 feature set and the explicit non-goals."),
    _d("architecture", "Architecture & stack", "The chosen tech stack and high-level architecture."),
    _d("data_model", "Data model", "Core entities/tables and how they relate."),
    _d("ui_flows", "Key UI flows", "The primary screens and user journeys."),
    _d("risks", "Risks & mitigations", "The top risks and how they are addressed."),
    _d("metrics", "Success metrics", "How success is measured, with targets."),
  ],
  game: [
    _d("concept", "Concept & fantasy", "What the game is and the fantasy it delivers."),
    _d("players", "Players & platform", "Who plays it and where."),
    _d("core_loop", "Core loop", "What the player does over and over."),
    _d("mechanics", "Mechanics", "The systems that carry the loop."),
    _d("tech", "Tech & engine", "How it is built and what it runs on."),
    _d("content", "Content & art", "The look, the assets and how much there is."),
    _d("risks", "Risks & mitigations", "The top risks and how they are addressed."),
    _d("success", "Success signals", "What tells you it is fun."),
  ],
  research: [
    _d("question", "The question", "The precise question the work must answer."),
    _d("scope", "Scope & boundaries", "What is in and explicitly out."),
    _d("sources", "Sources", "What the answer stands on."),
    _d("methodology", "Methodology", "How the analysis is done."),
    _d("findings", "Findings", "What has been established so far."),
    _d("counterpoints", "Counterpoints", "The strongest opposing case."),
    _d("recommendation", "Recommendation", "The conclusion somebody can act on."),
  ],
  data_bi: [
    _d("question", "The question", "The decision this must inform."),
    _d("data_sources", "Data sources", "Where the numbers come from and at what grain."),
    _d("metrics", "Metrics", "The measures and their definitions."),
    _d("transforms", "Transforms", "How raw data becomes the metrics."),
    _d("visualizations", "Visualizations", "How the results are shown."),
    _d("quality", "Data quality", "The checks that make it trustworthy."),
    _d("decisions", "Decisions supported", "What action this drives."),
  ],
  brainstorm: [
    _d("problem", "Problem", "What we are trying to solve."),
    _d("goal", "Goal & constraints", "What a good answer looks like."),
    _d("options", "Options", "The distinct directions on the table."),
    _d("tradeoffs", "Trade-offs", "The honest cost of each."),
    _d("differentiation", "Differentiation", "What makes this stand out."),
    _d("next_step", "Next step", "The cheapest way to test it."),
  ],
};

export const MODES = ["build", "game", "research", "data_bi", "brainstorm"];
export const DEFAULT_MODE = "build";

/** artifact name + the gate word, mirrored from MODE_META. The artifact name
 *  changes the document's title and the prompt's language; the JSON key that
 *  carries it is literally `prd` for every mode, over there and here. */
export const MODE_META: Record<string, { crew: string; artifact: string; gate: string }> = {
  build: { crew: "Agile Engineering crew", artifact: "PRD", gate: "Build-ready" },
  game: { crew: "Game Studio crew", artifact: "Game design doc", gate: "Build-ready" },
  research: { crew: "Research crew", artifact: "Research brief", gate: "Research-complete" },
  data_bi: { crew: "Data & BI crew", artifact: "BI spec", gate: "Spec-ready" },
  brainstorm: { crew: "Ideation crew", artifact: "Idea brief", gate: "Direction set" },
};

export function rubricFor(mode: string): Dim[] {
  return RUBRICS[String(mode || "")] || RUBRICS[DEFAULT_MODE];
}

export function metaFor(mode: string): { crew: string; artifact: string; gate: string } {
  return MODE_META[String(mode || "")] || MODE_META[DEFAULT_MODE];
}

// Ordered most-specific first, exactly as over there: the first hit wins.
// Word-boundary matching, so "landscaper" does not match "landscape".
const MODE_KEYWORDS: Array<[string, string[]]> = [
  ["game", ["game", "gameplay", "player", "arcade", "level", "sprite", "score", "platformer", "puzzle", "rpg", "shooter"]],
  ["data_bi", ["dashboard", "bi", "kpi", "metric", "analytics", "warehouse", "etl", "report", "chart", "sql"]],
  ["research", ["research", "study", "literature", "survey", "compare", "investigate", "analysis", "evidence", "source"]],
  ["brainstorm", ["brainstorm", "ideate", "ideas", "explore", "options", "direction", "concept"]],
  ["build", ["app", "build", "product", "feature", "platform", "api", "website", "tool", "saas", "service"]],
];

/** Word-boundary keyword hit, with naive plurals — the behaviour of
 *  quantlys-api/conclave/kwmatch.py, which is itself mirrored in
 *  quantlys-app/src/lib/conclaveCrews.js. Three copies now; the guard in
 *  lib/prd.test.mjs is what stops this one drifting. */
export function anyKeyword(text: string, words: string[]): boolean {
  const t = ` ${String(text || "").toLowerCase()} `;
  return (words || []).some((w) => {
    const k = String(w || "").toLowerCase().trim();
    if (!k) return false;
    return new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?([^a-z0-9]|$)`).test(t);
  });
}

export function detectMode(text: string): string {
  return detectModeWhy(text).mode;
}

/** The same detection, but saying whether it actually MATCHED anything.
 *
 *  CAUGHT BY lib/prd.test.mjs before it shipped: detectMode returns "build"
 *  both when the text says "app" and when the text says nothing recognisable,
 *  because build is also the default. Any caller that wants to ask "did this
 *  source have an opinion?" — which is exactly what detectModeFor does when it
 *  ranks the brief above the transcript — cannot tell those two apart from the
 *  return value alone. A brief reading "an app for filing expenses" was being
 *  treated as no evidence at all, and the transcript then overruled it. */
export function detectModeWhy(text: string): { mode: string; matched: boolean } {
  const t = String(text || "");
  for (const [mode, words] of MODE_KEYWORDS) if (anyKeyword(t, words)) return { mode, matched: true };
  return { mode: DEFAULT_MODE, matched: false };
}

// ── QUANTLYS-0209: never a bare question ──────────────────────────────────
//
// Mirrored from readiness.py's _DEFAULT_SUGGESTIONS, and it is the single
// most important borrowed rule in this file. Conclave learned it from a
// customer: "give them options to respond — the consumer doesn't know what
// the answer is." A meeting is a worse place to be asked a bare question
// than a chat window is, because in a meeting somebody has to answer out loud
// in front of colleagues. Every question this app asks — in the room, live,
// or in the report afterwards — arrives with 2-3 pickable answers and one
// sentence on what the choice changes.

export type Suggestion = { q: string; why: string; options: string[] };

export const DEFAULT_SUGGESTIONS: Record<string, Suggestion> = {
  problem: { q: "What problem should this solve first?", why: "This anchors what v1 must do — everything else hangs off it.",
    options: ["Keep it focused on the single core problem we discussed", "Broaden it slightly to cover the adjacent pain point"] },
  users: { q: "Who is this for?", why: "Who it's for decides how simple v1 has to be.",
    options: ["Just us / internal first", "A small group we know personally", "Anyone who finds it — make it self-explanatory"] },
  scope: { q: "What has to be in the first version?", why: "This is the line between shipping this week and never shipping.",
    options: ["Smallest thing that works — cut everything optional", "Core plus the one feature that makes it shareable"] },
  architecture: { q: "Where should this run?", why: "This decides where it runs and what it costs to keep up.",
    options: ["Single self-contained app — no accounts, no server", "Simple app with a small hosted backend"] },
  data_model: { q: "What should it remember between visits?", why: "What it remembers decides what it can show you later.",
    options: ["Keep everything on the device — nothing to set up", "Save to an online account so it syncs"] },
  ui_flows: { q: "What should the first screen do?", why: "The first screen decides whether people stay.",
    options: ["One screen that does the main thing immediately", "A short guided setup, then the main screen"] },
  risks: { q: "What worries you most about this?", why: "Naming the top risk now is cheaper than meeting it later.",
    options: ["Biggest risk is scope creep — lock v1 now", "Biggest risk is nobody tries it — make sharing effortless"] },
  metrics: { q: "How will you know it worked?", why: "One number tells you whether this is working.",
    options: ["People come back a second time", "A session lasts more than two minutes"] },
  concept: { q: "What kind of game should this feel like?", why: "The fantasy is why anyone presses play.",
    options: ["Pure classic arcade — instant action, no story", "Arcade with a light twist that's ours"] },
  players: { q: "Where will people play it?", why: "Where it's played shapes the controls.",
    options: ["Desktop browser, keyboard first", "Phone + desktop — touch and keys both work"] },
  core_loop: { q: "What does a player do over and over?", why: "This is the 30 seconds players repeat for an hour.",
    options: ["Dodge, shoot, survive waves, chase the high score", "Short levels with a clear end and a score screen"] },
  mechanics: { q: "Which mechanics matter most for v1?", why: "Two mechanics done well beat five done half.",
    options: ["Escalating waves + power-ups", "Lives + combo multiplier"] },
  tech: { q: "How should it be built?", why: "Decides whether it runs anywhere or needs installing.",
    options: ["Single HTML file — runs in any browser", "Small engine build for smoother effects"] },
  content: { q: "What should it look like?", why: "A consistent look reads as finished.",
    options: ["Neon vector shapes — clean and fast", "Pixel-art sprites — retro feel"] },
  success: { q: "What would make this feel finished?", why: "'Fun' needs one observable signal.",
    options: ["Testers replay without being asked", "Average run beats two minutes"] },
  question: { q: "What exactly should this answer?", why: "A sharp question keeps the work from sprawling.",
    options: ["Keep the question exactly as stated", "Narrow it to the next decision only"] },
  sources: { q: "What should the answer be based on?", why: "The answer is only as good as what it stands on.",
    options: ["Primary sources + official docs only", "Include credible secondary analysis too"] },
  methodology: { q: "How should we approach the analysis?", why: "How we look decides what we can claim.",
    options: ["Side-by-side comparison on fixed criteria", "Deep dive on the leading option only"] },
  findings: { q: "How much should we settle before reporting?", why: "Findings are the product — the rest is packaging.",
    options: ["Summarize the top three findings so far", "Hold findings until every source is in"] },
  counterpoints: { q: "How hard should we argue the other side?", why: "The strongest opposing view is the test the answer must pass.",
    options: ["Steelman the best counter-argument", "List the top two objections briefly"] },
  recommendation: { q: "What kind of answer do you need?", why: "A conclusion someone can act on is the finish line.",
    options: ["One clear recommendation with confidence level", "Ranked options with the trade-off named"] },
  data_sources: { q: "Where does the data come from?", why: "Wrong grain in, wrong numbers out.",
    options: ["Use the sample data we described", "Connect the real source before building"] },
  transforms: { q: "How much should the numbers be pre-computed?", why: "This is where numbers quietly go wrong.",
    options: ["Keep transforms minimal and visible", "Pre-aggregate for speed, document each step"] },
  visualizations: { q: "How should the results be shown?", why: "The chart is the interface to the answer.",
    options: ["One overview dashboard with the 3 key charts", "A drill-down per metric"] },
  quality: { q: "How careful do the data checks need to be?", why: "A dashboard people distrust is worse than none.",
    options: ["Add freshness + null checks on every metric", "Manual spot-check for v1, automate later"] },
  decisions: { q: "What decision should this drive?", why: "A report that drives no action is decoration.",
    options: ["Name the one decision this must inform", "List the weekly decisions it supports"] },
  goal: { q: "What makes a good answer here?", why: "Constraints are what make brainstorming converge.",
    options: ["Optimize for cheapest to try this week", "Optimize for most differentiated"] },
  options: { q: "How wide should we cast the net?", why: "Three real directions beat ten vague ones.",
    options: ["Generate three distinct directions", "Push the two leading ideas further apart"] },
  tradeoffs: { q: "How deep should we go on the downsides?", why: "Honest cons now save a rebuild later.",
    options: ["List the strongest con of the leading idea", "Compare the top two on cost and risk"] },
  differentiation: { q: "What should make this stand out?", why: "If it isn't different, it's a commodity.",
    options: ["Name the one thing competitors can't copy", "Lean into the niche instead of the mass"] },
  next_step: { q: "What is the cheapest way to test this?", why: "The cheapest test beats the best argument.",
    options: ["Build the thin prototype this week", "Show the idea to three people first"] },
};

const GENERIC_SUGGESTION: Suggestion = {
  q: "", why: "Answering this sharpens what gets built.",
  options: ["Go with the Conclave's recommendation", "Keep it as simple as possible for v1"],
};

export function suggestionsFor(key: string): Suggestion {
  return DEFAULT_SUGGESTIONS[String(key || "")] || GENERIC_SUGGESTION;
}

/** At least two, at most three, no duplicates — the model's own options
 *  first, because they are written for this conversation. */
export function topUpOptions(given: string[], key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const o of [...(given || []), ...suggestionsFor(key).options]) {
    const v = String(o || "").trim().slice(0, OPTION_MAX);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

// ── the report, in Conclave's own shape ───────────────────────────────────

export type Status = "present" | "partial" | "missing";
export const VALID_STATUS: Status[] = ["present", "partial", "missing"];
export const STATUS_SCORE: Record<Status, number> = { present: 1.0, partial: 0.5, missing: 0.0 };

export type ReportDim = {
  key: string; label: string; status: Status;
  evidence: string; question: string; options: string[]; why: string;
};

export type OpenQuestion = { key: string; label: string; question: string; options: string[]; why: string };

export type Report = {
  dimensions: ReportDim[];
  present_count: number;
  total: number;
  score: number;
  ready: boolean;
  blocking: string[];
  open_questions: OpenQuestion[];
  summary: string;
  prd: string;
  mode: string;
  artifact: string;
  gate: string;
  model?: string;
  assessment_error?: string;
};

/** Conclave's storage guard, to the character. A PRD longer than this is
 *  truncated over there, so producing a longer one here would mean a document
 *  that changes when it is handed over. */
export const PRD_MAX = 24000;
export const OPTION_MAX = 90;
export const WHY_MAX = 200;

/** Python's round(), which is NOT JavaScript's.
 *
 *  CAUGHT BY audit/maya_prd_qa.mjs, PRD-02, and it is exactly the class of
 *  drift this whole mirror is at risk of: two present and one partial out of
 *  eight is 0.3125, and `round(0.3125, 3)` in Python is 0.312 while
 *  `Math.round(312.5)/1000` in JavaScript is 0.313. Python rounds a tie to
 *  the EVEN digit; JavaScript rounds a tie up. Nobody would ever notice
 *  except the one person who has the same project open in both windows, and
 *  what they would conclude is that one of the two is lying about their
 *  progress. Ties land on a half-step exactly as often as a rubric has an
 *  even number of dimensions and an odd number of partials — which is to say,
 *  constantly. */
export function roundHalfEven(value: number, places = 3): number {
  const f = Math.pow(10, places);
  const scaled = value * f;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  // A float that is a hair either side of .5 is not a tie; only an exact one
  // is, and only an exact one gets the even-digit rule.
  let n: number;
  if (Math.abs(diff - 0.5) < Number.EPSILON * Math.abs(scaled) * 4 || diff === 0.5) {
    n = floor % 2 === 0 ? floor : floor + 1;
  } else {
    n = Math.round(scaled);
  }
  return n / f;
}

function finalize(dims: ReportDim[], opts: { summary: string; mode: string; prd: string; model?: string; error?: string }): Report {
  const present = dims.filter((d) => d.status === "present").length;
  const score = roundHalfEven(dims.reduce((s, d) => s + STATUS_SCORE[d.status], 0) / Math.max(dims.length, 1), 3);
  const blocking = dims.filter((d) => d.status !== "present").map((d) => d.key);
  const meta = metaFor(opts.mode);
  const report: Report = {
    dimensions: dims,
    present_count: present,
    total: dims.length,
    score,
    ready: blocking.length === 0,
    blocking,
    open_questions: dims
      .filter((d) => d.status !== "present" && d.question)
      .map((d) => ({
        key: d.key,
        label: d.label,
        question: d.question,
        // 0209: never bare. A model that omits options does not get to break
        // the promise — the defaults are the floor, not the decoration.
          // TOPPED UP, not replaced — and this is a DELIBERATE divergence from
        // Conclave, caught by audit/maya_prd_qa.mjs PRD-04. Over there a
        // model that returns a single option gets a single option, because
        // `_finalize` only backfills when the list is empty. One option is
        // not a choice; it is a suggestion with no alternative, and 0209 was
        // raised because consumers cannot compose an answer from nothing.
        // In a LIVE MEETING it is worse still — the whole point of the
        // buttons is that somebody can answer without having to phrase it out
        // loud in front of colleagues. So the floor is two, always.
        options: topUpOptions(d.options, d.key),
        why: d.why || suggestionsFor(d.key).why,
      })),
    summary: opts.summary || "",
    prd: opts.prd || "",
    mode: opts.mode,
    artifact: meta.artifact,
    gate: meta.gate,
  };
  if (opts.model) report.model = opts.model;
  if (opts.error) report.assessment_error = opts.error;
  return report;
}

/** An honest "we could not assess this" — every dimension missing, every
 *  question still asked, and the reason named. Never an empty screen and
 *  never a fabricated PRD. */
export function fallbackReport(reason: string, mode: string = DEFAULT_MODE): Report {
  const dims = rubricFor(mode);
  return finalize(
    dims.map((d) => ({
      key: d.key, label: d.label, status: "missing" as Status, evidence: "",
      question: suggestionsFor(d.key).q || `Can you say more about the ${d.label.toLowerCase()}?`,
      options: suggestionsFor(d.key).options,
      why: suggestionsFor(d.key).why,
    })),
    { summary: "", mode, prd: "", error: reason }
  );
}

export function normalizeReport(parsed: any, mode: string, model?: string): Report {
  const dims = rubricFor(mode);
  const keys = dims.map((d) => d.key);
  const labels: Record<string, string> = Object.fromEntries(dims.map((d) => [d.key, d.label]));
  const byKey: Record<string, any> = {};
  const rows = Array.isArray(parsed?.dimensions) ? parsed.dimensions : [];
  for (const item of rows) {
    if (item && typeof item === "object" && keys.includes(String(item.key))) byKey[String(item.key)] = item;
  }

  const out: ReportDim[] = keys.map((k) => {
    const raw = byKey[k] || {};
    let status = String(raw.status || "missing").trim().toLowerCase() as Status;
    if (!VALID_STATUS.includes(status)) status = "missing";
    let question = String(raw.question || "").trim();
    if (status !== "present" && !question) {
      question = suggestionsFor(k).q || `Can you say more about the ${String(labels[k] || k).toLowerCase()}?`;
    }
    const opts = (Array.isArray(raw.options) ? raw.options : [])
      .filter((o: any) => typeof o === "string" || typeof o === "number")
      .map((o: any) => String(o).trim().slice(0, OPTION_MAX))
      .filter(Boolean)
      .slice(0, 3);
    const why = String(raw.why || "").trim().slice(0, WHY_MAX);
    return {
      key: k,
      label: labels[k],
      status,
      evidence: String(raw.evidence || "").trim(),
      question: status !== "present" ? question : "",
      options: status !== "present" ? opts : [],
      why: status !== "present" ? why : "",
    };
  });

  return finalize(out, {
    summary: String(parsed?.summary || "").trim(),
    mode,
    prd: String(parsed?.prd || "").trim().slice(0, PRD_MAX),
    model,
  });
}

// ── pulling JSON out of a model that was asked for JSON ───────────────────
//
// Mirrored from readiness.py's _extract_json_object, because the failure modes
// are the model's, not the language's: prose around the object, ```json
// fences, code fences INSIDE a string value (a PRD that embeds its own
// examples), trailing commas, and — the common one on a long PRD — a reply
// truncated mid-string at the token limit.

function balancedFrom(text: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Repair a reply cut off mid-PRD: close a dangling string, drop the trailing
 *  comma, and append the missing closers in the right order. Salvages the
 *  common case; harmlessly returns junk otherwise, which the tolerant parse
 *  then rejects. */
export function bestEffortClose(fragment: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of String(fragment || "")) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" && stack[stack.length - 1] === "{") stack.pop();
    else if (c === "]" && stack[stack.length - 1] === "[") stack.pop();
  }
  let out = String(fragment || "") + (inStr ? '"' : "");
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
}

function loadsTolerant(s: string): any {
  for (const candidate of [s, s.replace(/,(\s*[}\]])/g, "$1")]) {
    try { return JSON.parse(candidate); } catch { /* try the next repair */ }
  }
  return null;
}

export function extractJson(text: string): any {
  const s = String(text || "");
  if (!s) return null;
  let best: any = null;
  let i = 0;
  for (;;) {
    const start = s.indexOf("{", i);
    if (start === -1) break;
    const obj = balancedFrom(s, start);
    if (obj === null) break;
    const parsed = loadsTolerant(obj);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.dimensions) return parsed;
      best = best || parsed;
    }
    i = start + obj.length;
  }
  if (best) return best;
  const start = s.indexOf("{");
  if (start !== -1) {
    const parsed = loadsTolerant(bestEffortClose(s.slice(start)));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

// ── the prompt ────────────────────────────────────────────────────────────

/** Conclave's system prompt reads a council DELIBERATION. This one reads
 *  MEETINGS — several of them, held on different days, by people who were not
 *  writing a spec at the time. Three things follow from that and they are the
 *  only real differences:
 *
 *   1. NOTHING IN A MEETING IS A DECISION UNLESS SOMEBODY DECIDED IT. A
 *      transcript is full of thinking out loud. A PRD that promotes "we could
 *      maybe use Postgres" to an architecture decision is worse than a PRD
 *      with the section marked TBD, because somebody will build from it.
 *   2. LATER MEETINGS WIN. Projects change their minds; the transcripts
 *      arrive oldest-first and the most recent statement on a subject is the
 *      current one.
 *   3. WHO SAID IT MATTERS, because the person answering the open questions
 *      afterwards is one of the people in the room. */
// ── the project's stated intent, and the answers given outside a meeting ──
//
// FIELD 2026-08-25: "How do users enter the project goals so readiness has a
// context and asks the right follow-up questions?"
//
// They could not. The only thing anybody typed about a project was its NAME,
// and everything else had to be inferred from what happened to get said. From
// the second meeting that is fine — the saved assessment carries the project's
// real state. The thin spot was the FIRST meeting, where the agent had a
// string like "Apollo" and nothing else, so its opening questions were the
// generic ones for each dimension rather than ones about the actual product.
// detectMode("Apollo") is "build" by default, not by evidence.
//
// Two things fix that, and they are the same shape: text the team writes
// down ON PURPOSE, which outranks anything inferred from conversation.
//
//   · the BRIEF — two or three sentences of "what are we building, and why",
//     typed once per project;
//   · DECISIONS — an open question answered in the host console between
//     meetings, rather than waiting for the next one.
//
// Both are deliberate statements, so both are treated as the current position
// and placed AFTER the transcripts, where "the later one wins" puts them.

export type Decision = {
  /** the rubric dimension it closes */
  key: string;
  question: string;
  answer: string;
  /** ISO — deliberately a string, so a stored decision never depends on a
   *  clock this code cannot see */
  at: string;
};

export type ProjectContext = { brief: string; decisions: Decision[] };

export const BRIEF_MAX = 1200;
export const DECISION_MAX = 400;
export const DECISIONS_KEPT = 60;

export const EMPTY_CONTEXT: ProjectContext = { brief: "", decisions: [] };

/** A brief is short on purpose. Two or three sentences is a statement of
 *  intent that a model can weigh against a transcript; two pages is a second
 *  document competing with the one this is supposed to produce, and whichever
 *  the model believes, the other one is now wrong. */
export function acceptBrief(text: string): { ok: boolean; value: string; why: string } {
  const v = String(text || "").replace(/\s+/g, " ").trim();
  if (!v) return { ok: true, value: "", why: "" };
  if (v.length > BRIEF_MAX) {
    return {
      ok: false, value: v.slice(0, BRIEF_MAX),
      why: `That's longer than a brief — keep it to two or three sentences (${BRIEF_MAX} characters). The meetings carry the detail; this is just what the project IS.`,
    };
  }
  return { ok: true, value: v, why: "" };
}

/** An answer given outside a meeting. `at` is passed in rather than read from
 *  a clock, so this is pure and a suite can pin the ordering. */
export function acceptDecision(input: {
  key?: string; question?: string; answer?: string; at?: string;
}): { ok: boolean; value: Decision | null; why: string } {
  const key = String(input?.key || "").trim();
  const question = String(input?.question || "").trim().slice(0, 300);
  const answer = String(input?.answer || "").replace(/\s+/g, " ").trim();
  if (!key) return { ok: false, value: null, why: "Which part of the PRD does this answer?" };
  if (!answer) return { ok: false, value: null, why: "Pick one of the answers, or write your own." };
  return {
    ok: true,
    value: {
      key, question,
      answer: answer.slice(0, DECISION_MAX),
      at: String(input?.at || "").trim(),
    },
    why: "",
  };
}

/** Newest wins, one per dimension kept at the front, and the list is bounded.
 *  Somebody who changes their mind about the same question has changed their
 *  mind — keeping both would put the model in the position of choosing. */
export function mergeDecisions(existing: Decision[], next: Decision): Decision[] {
  const out = (existing || []).filter((d) => d && d.key !== next.key);
  out.push(next);
  return out.slice(-DECISIONS_KEPT);
}

/** Which dimensions have been answered outside a meeting. The panel uses this
 *  so a question you already answered stops looking unanswered. */
export function answeredKeys(ctx: ProjectContext | null | undefined): string[] {
  return ((ctx && ctx.decisions) || []).map((d) => String(d?.key || "")).filter(Boolean);
}

/** The block that carries the team's own words into the prompt. Empty when
 *  there is nothing stated, so a project with no brief reads exactly as it
 *  did before this existed. */
export function contextBlock(ctx: ProjectContext | null | undefined): string {
  const brief = String(ctx?.brief || "").trim();
  const decisions = (ctx?.decisions || []).filter((d) => d && d.key && d.answer);
  if (!brief && !decisions.length) return "";
  const lines: string[] = [];
  if (brief) {
    lines.push("What the team says this project IS, in their own words. This is");
    lines.push("their stated intent — weigh the transcripts against it, and when a");
    lines.push("meeting wandered somewhere this does not cover, that is a wander,");
    lines.push("not a change of direction:");
    lines.push("");
    lines.push(brief);
    lines.push("");
  }
  if (decisions.length) {
    lines.push("Decisions the team took DELIBERATELY, outside a meeting, by");
    lines.push("answering these exact questions. Each one is the current position");
    lines.push("and outranks anything said in a transcript about the same thing —");
    lines.push("somebody sat down and chose:");
    lines.push("");
    for (const d of decisions) {
      lines.push(`- [${d.key}] ${d.question ? `${d.question} → ` : ""}${d.answer}${d.at ? ` (${String(d.at).slice(0, 10)})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Mode from the strongest signal available. The brief is a sentence somebody
 *  wrote about what they are building; a project NAME is a label. "Apollo"
 *  tells you nothing and falls to the default; "a game where you dodge waves"
 *  tells you everything. Ordered, so the best evidence decides. */
export function detectModeFor(opts: { brief?: string; project?: string; transcript?: string }): string {
  const brief = String(opts?.brief || "").trim();
  if (brief) {
    const m = detectModeWhy(brief);
    if (m.matched) return m.mode;
  }
  const name = String(opts?.project || "").trim();
  if (name) {
    const m = detectModeWhy(name);
    if (m.matched) return m.mode;
  }
  return detectMode(`${name} ${String(opts?.transcript || "").slice(0, 4000)}`);
}

/** Where a project's stated context lives. Deliberately NOT the same file as
 *  the assessment: the assessment is regenerated every time somebody presses
 *  Build, and a rebuild must never wipe the sentences the team wrote. */
export function projectPath(userId: string, projectName: string): string {
  const slug = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${String(userId || "")}/prd/${slug}.project.json`;
}

export function prdPrompt(
  transcript: string,
  dims: Dim[],
  meta: { artifact: string; gate: string },
  ctx?: ProjectContext | null
): string {
  const lines = ["Required dimensions:"];
  for (const d of dims) lines.push(`- ${d.key}: ${d.label} — ${d.desc}`);
  lines.push("");
  lines.push("Meeting transcripts for this project, oldest first. Each is headed");
  lines.push("with its date and title. Where two meetings disagree, the LATER one");
  lines.push("is the current position.");
  lines.push("");
  lines.push(transcript.trim() || "(no transcripts yet)");
  const ctxBlock = contextBlock(ctx);
  if (ctxBlock) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(ctxBlock);
  }
  return lines.join("\n");
}

export function prdSystemPrompt(artifact: string, gate: string): string {
  return (
    "You are the Quantlys Meeting analyst. You are reading the recorded " +
    "conversations of a real project team and producing the document that " +
    "lets Quantlys Conclave build what they were talking about. Do THREE " +
    "things and return them together.\n\n" +
    `1) READINESS: assess whether the project is ${gate.toUpperCase()} — has ` +
    "enough concrete detail — per required dimension. Status exactly " +
    "'present'/'partial'/'missing', a one-sentence evidence note QUOTING or " +
    "closely paraphrasing what was actually said, and (when not present) a " +
    "single sharp question that closes the gap. Be strict: people think out " +
    "loud in meetings, and an idea somebody floated is 'missing', not " +
    "'partial'. Something raised and left open is 'partial'. Only something " +
    "the room actually settled is 'present'.\n" +
    "QUESTIONS ARE FOR THE PEOPLE WHO WERE IN THE MEETING, and they are not " +
    "developers. Phrase each question in the product's language — what the " +
    "user sees and feels — never the spec's. Ask about difficulty, screens " +
    "and what happens when something fails, not about 'data models'. With " +
    "each question include `options`: 2-3 SHORT suggested answers, each a " +
    "complete pickable answer with the most likely first, and `why`: one " +
    "plain sentence on what this decision changes for them. Never leave a " +
    "question bare.\n" +
    `2) ARTIFACT: write a ${artifact} in MARKDOWN from what the meetings ` +
    "actually establish. NEVER INVENT. If the meetings did not settle " +
    "something, write 'TBD' under that heading and move on — a section marked " +
    "TBD is information; an invented one is a decision nobody made that " +
    "somebody will now build. Attribute the load-bearing choices to the " +
    "person who made them where the transcript is clear. TIMELINE " +
    "CALIBRATION: this plan is executed by Quantlys' AI agents, not a human " +
    "team — any roadmap must be dependency-ordered with effort in " +
    "MINUTES/HOURS (a full V1 is typically under 5 hours), never weeks or " +
    "months; convert any human-scale timeline the meeting used, and label " +
    "external waits (device testing, App Store review) as wait time rather " +
    "than engineering effort. SHIPPABILITY CALIBRATION: the V1 scope must be " +
    "a SELF-CONTAINED deliverable with NO third-party SDKs, ads, in-app " +
    "purchases, analytics services or external accounts in V1; move any of " +
    "those to an explicit 'Post-V1' section. A feature the artifact marks " +
    "'future' must not also appear in the V1 scope.\n" +
    "3) DISAGREEMENTS: where the meetings show the team genuinely split on " +
    "something (0-4), name the topic, each side's position and who held it, " +
    "and whether it was resolved. Do not invent disagreements that are not " +
    "there — a question somebody asked is not a disagreement.\n\n" +
    "Respond with STRICT JSON ONLY:\n" +
    '{"dimensions":[{"key":"...","status":"present|partial|missing",' +
    '"evidence":"...","question":"...","options":["...","..."],"why":"..."}],' +
    '"summary":"one-line state of the project",' +
    `"prd":"# ${artifact}\\n...markdown...",` +
    '"arguments":[{"topic":"...","side_a":{"role":"...","point":"..."},' +
    '"side_b":{"role":"...","point":"..."},"arbitration":"..."}]}'
  );
}

// ── stitching a project's meetings into one transcript ────────────────────

export type MeetingSource = { title?: string; at?: string; room?: string; transcript?: string };

/** Oldest first, each headed so the model can tell them apart and honour
 *  "the later meeting wins". Bounded, because a project with forty meetings
 *  would otherwise blow the context window and get silently truncated at the
 *  wrong end — the END is the part that matters, so when the budget bites we
 *  drop the OLDEST meetings and say how many. */
export function stitchTranscripts(
  sources: MeetingSource[],
  budget = 120000
): { text: string; used: number; dropped: number } {
  const rows = (sources || []).filter((s) => s && String(s.transcript || "").trim());
  const blocks = rows.map((s) => {
    const head = `## ${String(s.title || s.room || "Meeting").trim()}${s.at ? ` — ${String(s.at).slice(0, 10)}` : ""}`;
    return `${head}\n\n${String(s.transcript).trim()}`;
  });
  const out: string[] = [];
  let total = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (total + b.length > budget && out.length) break;
    out.unshift(b);
    total += b.length;
  }
  return { text: out.join("\n\n---\n\n"), used: out.length, dropped: blocks.length - out.length };
}

// ── the handoff to Conclave, described honestly ───────────────────────────

export type HandoffStep = { n: number; what: string; detail: string };

/** WHAT THIS IS NOT: an integration. Conclave has no endpoint that accepts a
 *  PRD — `export-prd` writes a file OUT, `state.prd` is written only by its
 *  own readiness pass, and `POST /api/conversations` takes no body at all. A
 *  button here that claimed to "attach this to Conclave" would be a lie with
 *  a spinner on it.
 *
 *  What actually works is that a PRD is a very good first message. So this
 *  returns the steps, in order, with the exact thing to paste — and the UI
 *  shows them rather than pretending. When Conclave grows an import endpoint,
 *  this function is the one place that changes. */
export function handoffPlan(report: Report, projectName: string): HandoffStep[] {
  const name = String(projectName || "this project").trim() || "this project";
  const openN = report.open_questions.length;
  return [
    { n: 1, what: "Start a new Conclave", detail: `Open Quantlys Conclave and start a conversation for ${name}.` },
    {
      n: 2,
      what: `Paste the ${report.artifact} as the first message`,
      detail:
        "Conclave reads the first message to choose its crew, so pasting the " +
        `document itself puts it on the ${metaFor(report.mode).crew}. Use the Copy button below, or attach the .md file.`,
    },
    {
      n: 3,
      what: openN ? `Answer the ${openN} open question${openN === 1 ? "" : "s"}` : "Run readiness",
      detail: openN
        ? "These are the same dimensions Conclave scores, so answering them here is answering them there."
        : `Every dimension is already present — Conclave should score this ${report.gate.toLowerCase()} on the first pass.`,
    },
  ];
}

/** The document as a person receives it: the artifact, plus what is still
 *  open, plus where it came from. A PRD handed over without its open
 *  questions is a PRD that looks finished and is not. */
export function prdMarkdown(report: Report, projectName: string, sources: MeetingSource[]): string {
  const name = String(projectName || "").trim();
  const lines: string[] = [];
  const body = String(report.prd || "").trim();
  lines.push(body || `# ${report.artifact}${name ? ` — ${name}` : ""}\n\n_Not enough was said in these meetings to draft one yet._`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## ${report.gate}: ${report.present_count} of ${report.total} · score ${report.score.toFixed(2)}`);
  lines.push("");
  if (report.ready) {
    lines.push(`Every dimension is settled. This is ${report.gate.toLowerCase()}.`);
  } else {
    lines.push("Still open — each of these is a dimension Quantlys Conclave will score as incomplete:");
    lines.push("");
    for (const q of report.open_questions) {
      lines.push(`### ${q.label}`);
      lines.push("");
      lines.push(`**${q.question}**`);
      lines.push("");
      for (const o of q.options) lines.push(`- ${o}`);
      lines.push("");
      lines.push(`_${q.why}_`);
      lines.push("");
    }
  }
  const used = (sources || []).filter((s) => String(s?.transcript || "").trim());
  if (used.length) {
    lines.push("---");
    lines.push("");
    lines.push(`## Built from ${used.length} recorded meeting${used.length === 1 ? "" : "s"}`);
    lines.push("");
    for (const s of used) {
      lines.push(`- ${String(s.title || s.room || "Meeting").trim()}${s.at ? ` — ${String(s.at).slice(0, 10)}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** A filename a person can find again. */
export function prdFilename(projectName: string, artifact: string): string {
  const slug = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const kind = String(artifact || "PRD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "prd";
  return `${slug}-${kind}.md`;
}

/** Where a project's assessment lives in storage. Under the person's own
 *  prefix, like everything else in this app, so the ownership check that
 *  guards every other route guards this one too. */
export function prdPath(userId: string, projectName: string): string {
  const slug = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${String(userId || "")}/prd/${slug}.prd.json`;
}
