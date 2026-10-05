// Memory mode — oral-historian / podcast-producer artifact from a session.
//
// Strong second surface on Meeting: same room, recording, captions, and
// whiteboard; different agent intent and output. Default remains Meeting/PRD.
//
// ZERO-IMPORT so judgements stay offline-testable.

export type SessionMode = "meeting" | "memory";

export const SESSION_MODES: SessionMode[] = ["meeting", "memory"];
export const DEFAULT_SESSION_MODE: SessionMode = "meeting";

/** Soft output intents Memory can lean toward. One agent covers all three. */
export type MemoryIntent = "story" | "podcast" | "book";
export const MEMORY_INTENTS: MemoryIntent[] = ["story", "podcast", "book"];
export const DEFAULT_MEMORY_INTENT: MemoryIntent = "story";

export type Dim = { key: string; label: string; desc: string };

const _d = (key: string, label: string, desc: string): Dim => ({ key, label, desc });

/** Oral-historian dimensions — chronology, people, turning points, sensory
 *  detail, lessons, quotable lines, open threads. Not a PRD checklist. */
export const MEMORY_RUBRIC: Dim[] = [
  _d("chronology", "Chronology", "When things happened and in what order — eras, dates, before/after."),
  _d("people", "People", "Who was there, relationships, and how they shaped the story."),
  _d("turning_points", "Turning points", "Moments that changed the path — decisions, accidents, arrivals, losses."),
  _d("sensory", "Sensory detail", "Place, sights, sounds, smells, weather, and how it felt in the body."),
  _d("lessons", "Lessons", "What was learned, what they would tell someone younger, the hard-won clarity."),
  _d("quotes", "Quotable lines", "Lines worth keeping — exact words, catchphrases, things said that stuck."),
  _d("open_threads", "Open threads", "What still wants telling, unresolved questions, sequels."),
];

export const MEMORY_META = {
  artifact: "Memory package",
  gate: "Story-ready",
  crew: "Oral historian",
};

export function acceptSessionMode(raw: unknown): SessionMode {
  const v = String(raw || "").trim().toLowerCase();
  return v === "memory" ? "memory" : "meeting";
}

export function acceptMemoryIntent(raw: unknown): MemoryIntent {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "podcast" || v === "book" || v === "story") return v;
  return DEFAULT_MEMORY_INTENT;
}

export function memoryRubric(): Dim[] {
  return MEMORY_RUBRIC.slice();
}

export function memoryDim(key: string): Dim | undefined {
  return MEMORY_RUBRIC.find((d) => d.key === key);
}

/** Storage path for a project's Memory package (mirrors prdPath). */
export function memoryPath(userId: string, projectName: string): string {
  const slug = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${String(userId || "")}/memory/${slug}.memory.json`;
}

export function memoryFilename(projectName: string): string {
  const slug = String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${slug}-memory.md`;
}

export type MemorySuggestion = { q: string; why: string; options: string[] };

export const MEMORY_SUGGESTIONS: Record<string, MemorySuggestion> = {
  chronology: {
    q: "Where does this story begin?",
    why: "A clear start lets chapters line up.",
    options: ["Start at the moment that changed everything", "Start earlier — the years that set it up"],
  },
  people: {
    q: "Who has to be in this story?",
    why: "People carry the plot; names make it real.",
    options: ["Focus on one person at the center", "Bring in the two or three who shaped it most"],
  },
  turning_points: {
    q: "What was the moment nothing was the same after?",
    why: "Turning points become chapter breaks.",
    options: ["Name the single sharpest turn", "There were two — tell both briefly"],
  },
  sensory: {
    q: "If you closed your eyes, what would you still see or hear from that day?",
    why: "Sensory detail is what readers and listeners remember.",
    options: ["One strong image or sound", "The place itself — room, street, weather"],
  },
  lessons: {
    q: "What do you know now that you did not know then?",
    why: "Lessons give the story its spine.",
    options: ["One hard lesson in a sentence", "What you would tell someone younger"],
  },
  quotes: {
    q: "Is there a line someone said that you still hear?",
    why: "Quotable lines become pull-quotes and episode titles.",
    options: ["Yes — say it as close to exact as you can", "Not a quote — a phrase you always used"],
  },
  open_threads: {
    q: "What part of this still feels unfinished?",
    why: "Open threads become sequels and follow-up episodes.",
    options: ["There is one chapter still missing", "It feels complete enough for now"],
  },
};

const GENERIC_MEMORY: MemorySuggestion = {
  q: "What should we not leave out?",
  why: "The next question keeps the story from going thin.",
  options: ["Stay with what just came up", "Go back to what was skipped"],
};

export function memorySuggestionsFor(key: string): MemorySuggestion {
  return MEMORY_SUGGESTIONS[String(key || "")] || GENERIC_MEMORY;
}

export const MEMORY_OPTION_MAX = 90;
export const MEMORY_WHY_MAX = 200;
export const MEMORY_MAX = 24000;

export type MemoryStatus = "present" | "partial" | "missing";
export const MEMORY_VALID_STATUS: MemoryStatus[] = ["present", "partial", "missing"];

export type MemoryReportDim = {
  key: string;
  label: string;
  status: MemoryStatus;
  evidence: string;
  question: string;
  options: string[];
  why: string;
};

export type MemoryChapter = {
  heading: string;
  /** optional mm:ss or section cue from the transcript */
  at?: string;
  body: string;
};

export type MemoryPackage = {
  title: string;
  summary: string;
  chapters: MemoryChapter[];
  quotes: string[];
  open_threads: string[];
  intent: MemoryIntent;
  markdown: string;
  dimensions: MemoryReportDim[];
  present_count: number;
  total: number;
  score: number;
  ready: boolean;
  artifact: string;
  gate: string;
  /** always "memory" so regenerate knows which surface produced this */
  sessionMode: "memory";
  model?: string;
  assessment_error?: string;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function topUpMemoryOptions(given: string[], key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const o of [...(given || []), ...(memorySuggestionsFor(key).options || [])]) {
    const v = String(o || "").trim().slice(0, MEMORY_OPTION_MAX);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

export function memorySystemPrompt(intent: MemoryIntent = DEFAULT_MEMORY_INTENT): string {
  const lean =
    intent === "podcast"
      ? "Lean toward podcast episode structure: cold open hook, acts, and a closing beat."
      : intent === "book"
        ? "Lean toward a manuscript outline: chapter titles a reader would recognize, scene texture, and a through-line."
        : "Lean toward a lived story: scenes a reader can walk into, with chronology and people clear.";
  return (
    "You are an oral historian and podcast producer sitting with someone who is " +
    "telling a lived story — expertise, legacy, a book they are carrying, or a " +
    "podcast they are shaping. You are NOT writing a product PRD. Do not invent " +
    "features, scopes, metrics, or architecture.\n\n" +
    lean + "\n\n" +
    "From the transcripts (and any whiteboard notes), produce:\n" +
    "1) READINESS on the Memory dimensions (chronology, people, turning_points, " +
    "sensory, lessons, quotes, open_threads). Status exactly present/partial/missing. " +
    "Quote or closely paraphrase evidence. When not present, ask ONE oral-historian " +
    "follow-up with 2-3 short pickable options and a one-sentence why.\n" +
    "2) A Memory package: title, short 'for readers' summary, chapters with " +
    "timestamps or section headings when the transcript supports them, notable " +
    "quotes, and open threads. NEVER invent facts. Mark gaps as TBD.\n\n" +
    "Respond with STRICT JSON ONLY:\n" +
    '{"dimensions":[{"key":"...","status":"present|partial|missing","evidence":"...",' +
    '"question":"...","options":["...","..."],"why":"..."}],' +
    '"title":"...","summary":"2-4 sentences for readers",' +
    '"chapters":[{"heading":"...","at":"optional mm:ss or cue","body":"..."}],' +
    '"quotes":["..."],"open_threads":["..."],' +
    '"markdown":"# Title\\n...full package markdown..."}'
  );
}

export function memoryUserPrompt(
  transcript: string,
  intent: MemoryIntent = DEFAULT_MEMORY_INTENT,
  extra?: string
): string {
  const lines = [
    `Intent lean: ${intent} (still one Memory package — cover story, podcast, and book needs).`,
    "",
    "Required Memory dimensions:",
  ];
  for (const d of MEMORY_RUBRIC) lines.push(`- ${d.key}: ${d.label} — ${d.desc}`);
  lines.push("");
  lines.push("Session transcripts / captions, oldest first when several:");
  lines.push("");
  lines.push(String(transcript || "").trim() || "(nothing yet)");
  if (extra && String(extra).trim()) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(String(extra).trim());
  }
  return lines.join("\n");
}

export function fallbackMemoryPackage(reason: string, intent: MemoryIntent = DEFAULT_MEMORY_INTENT): MemoryPackage {
  const dims: MemoryReportDim[] = MEMORY_RUBRIC.map((d) => {
    const s = memorySuggestionsFor(d.key);
    return {
      key: d.key,
      label: d.label,
      status: "missing" as MemoryStatus,
      evidence: "",
      question: s.q,
      options: s.options,
      why: s.why,
    };
  });
  return finalizeMemory(dims, {
    title: "",
    summary: "",
    chapters: [],
    quotes: [],
    open_threads: [],
    intent,
    markdown: "",
    error: reason,
  });
}

function finalizeMemory(
  dims: MemoryReportDim[],
  opts: {
    title: string;
    summary: string;
    chapters: MemoryChapter[];
    quotes: string[];
    open_threads: string[];
    intent: MemoryIntent;
    markdown: string;
    model?: string;
    error?: string;
  }
): MemoryPackage {
  const present = dims.filter((d) => d.status === "present").length;
  const score = round3(
    dims.reduce((s, d) => s + (d.status === "present" ? 1 : d.status === "partial" ? 0.5 : 0), 0) /
      Math.max(dims.length, 1)
  );
  const ready = dims.every((d) => d.status === "present");
  const title = opts.title || "Untitled memory";
  const markdown =
    String(opts.markdown || "").trim() ||
    memoryMarkdownFromParts({
      title,
      summary: opts.summary,
      chapters: opts.chapters,
      quotes: opts.quotes,
      open_threads: opts.open_threads,
      dims,
    });
  const out: MemoryPackage = {
    title,
    summary: opts.summary || "",
    chapters: opts.chapters || [],
    quotes: opts.quotes || [],
    open_threads: opts.open_threads || [],
    intent: opts.intent,
    markdown: markdown.slice(0, MEMORY_MAX),
    dimensions: dims.map((d) => ({
      ...d,
      options: d.status !== "present" ? topUpMemoryOptions(d.options, d.key) : [],
      why: d.status !== "present" ? d.why || memorySuggestionsFor(d.key).why : "",
      question: d.status !== "present" ? d.question : "",
    })),
    present_count: present,
    total: dims.length,
    score,
    ready,
    artifact: MEMORY_META.artifact,
    gate: MEMORY_META.gate,
    sessionMode: "memory",
  };
  if (opts.model) out.model = opts.model;
  if (opts.error) out.assessment_error = opts.error;
  return out;
}

export function memoryMarkdownFromParts(parts: {
  title: string;
  summary: string;
  chapters: MemoryChapter[];
  quotes: string[];
  open_threads: string[];
  dims?: MemoryReportDim[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${String(parts.title || "Memory").trim() || "Memory"}`);
  lines.push("");
  if (parts.summary) {
    lines.push("## For readers");
    lines.push("");
    lines.push(parts.summary);
    lines.push("");
  }
  if (parts.chapters?.length) {
    lines.push("## Chapters");
    lines.push("");
    for (const c of parts.chapters) {
      const head = String(c.heading || "Untitled").trim();
      const at = String(c.at || "").trim();
      lines.push(at ? `### ${head} (${at})` : `### ${head}`);
      lines.push("");
      lines.push(String(c.body || "").trim() || "_TBD_");
      lines.push("");
    }
  }
  if (parts.quotes?.length) {
    lines.push("## Notable quotes");
    lines.push("");
    for (const q of parts.quotes) lines.push(`> ${String(q).trim()}`);
    lines.push("");
  }
  if (parts.open_threads?.length) {
    lines.push("## Open threads");
    lines.push("");
    for (const t of parts.open_threads) lines.push(`- ${String(t).trim()}`);
    lines.push("");
  }
  const open = (parts.dims || []).filter((d) => d.status !== "present" && d.question);
  if (open.length) {
    lines.push("---");
    lines.push("");
    lines.push("## Still to draw out");
    lines.push("");
    for (const d of open) {
      lines.push(`### ${d.label}`);
      lines.push("");
      lines.push(`**${d.question}**`);
      lines.push("");
      for (const o of d.options || []) lines.push(`- ${o}`);
      if (d.why) {
        lines.push("");
        lines.push(`_${d.why}_`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function normalizeMemoryPackage(parsed: any, intent: MemoryIntent, model?: string): MemoryPackage {
  const keys = MEMORY_RUBRIC.map((d) => d.key);
  const labels: Record<string, string> = Object.fromEntries(MEMORY_RUBRIC.map((d) => [d.key, d.label]));
  const byKey: Record<string, any> = {};
  for (const item of Array.isArray(parsed?.dimensions) ? parsed.dimensions : []) {
    if (item && typeof item === "object" && keys.includes(String(item.key))) {
      byKey[String(item.key)] = item;
    }
  }
  const dims: MemoryReportDim[] = keys.map((k) => {
    const raw = byKey[k] || {};
    let status = String(raw.status || "missing").trim().toLowerCase() as MemoryStatus;
    if (!MEMORY_VALID_STATUS.includes(status)) status = "missing";
    let question = String(raw.question || "").trim();
    if (status !== "present" && !question) question = memorySuggestionsFor(k).q;
    const opts = (Array.isArray(raw.options) ? raw.options : [])
      .filter((o: any) => typeof o === "string" || typeof o === "number")
      .map((o: any) => String(o).trim().slice(0, MEMORY_OPTION_MAX))
      .filter(Boolean)
      .slice(0, 3);
    return {
      key: k,
      label: labels[k],
      status,
      evidence: String(raw.evidence || "").trim(),
      question: status !== "present" ? question : "",
      options: status !== "present" ? opts : [],
      why: status !== "present" ? String(raw.why || "").trim().slice(0, MEMORY_WHY_MAX) : "",
    };
  });

  const chapters: MemoryChapter[] = (Array.isArray(parsed?.chapters) ? parsed.chapters : [])
    .filter((c: any) => c && (c.heading || c.body))
    .map((c: any) => ({
      heading: String(c.heading || "Untitled").trim().slice(0, 200),
      at: String(c.at || "").trim().slice(0, 40) || undefined,
      body: String(c.body || "").trim().slice(0, 4000),
    }))
    .slice(0, 24);

  const quotes = (Array.isArray(parsed?.quotes) ? parsed.quotes : [])
    .map((q: any) => String(q || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const open_threads = (Array.isArray(parsed?.open_threads) ? parsed.open_threads : [])
    .map((t: any) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 12);

  return finalizeMemory(dims, {
    title: String(parsed?.title || "").trim().slice(0, 200),
    summary: String(parsed?.summary || "").trim().slice(0, 1200),
    chapters,
    quotes,
    open_threads,
    intent,
    markdown: String(parsed?.markdown || "").trim(),
    model,
  });
}

/** Host-visible toggle labels. */
export function sessionModeLabel(mode: SessionMode): string {
  return mode === "memory" ? "Memory" : "Meeting";
}

/** Guest-facing chip when the host picked Memory. */
export function sessionModeGuestCue(mode: SessionMode): string {
  return mode === "memory"
    ? "Memory mode — leaving with a story"
    : "";
}

/** End-session handoff copy. */
export function memoryHandoffCopy(opts: { hasPackage: boolean; shareUrl?: string }): string {
  if (!opts.hasPackage) {
    return "Session ended. Build the Memory package below — story / manuscript .md from this room. Each chapter also downloads as full video (one continuous 1080p MP4/WebM take), captions (.vtt/.srt), and audio clips.";
  }
  if (opts.shareUrl) {
    return "Session ended. Your Memory package is ready — copy the shareable link or download the .md. Full video (continuous 1080p MP4/WebM), captions (.vtt/.srt) and audio clips are per chapter in the Memory panel.";
  }
  return "Session ended. Your Memory package is ready — copy or download the .md, or turn on a shareable link. Full video (continuous 1080p MP4/WebM), captions (.vtt/.srt) and audio clips are per chapter in the Memory panel.";
}

/** Agent opening line in Memory mode. */
export function memoryOpeningLine(projectName: string, total: number, opts?: { turnedCaptionsOn?: boolean }): string {
  const name = String(projectName || "").trim();
  const base =
    `I'm listening for the ${total} things a lived story needs${name ? ` — ${name}` : ""}. ` +
    "Chronology, people, turning points, sensory detail, lessons, quotable lines. " +
    "One question at a time, only in a pause — leave with a story, not a PRD.";
  if (!opts?.turnedCaptionsOn) return base;
  return base + " Captions just came on so I can hear the room.";
}

export function memoryStatusLine(
  asked: number,
  openLabels: string[],
  reason: string
): string {
  if (reason) return reason;
  const left = openLabels.length;
  const openList = openLabels.slice(0, 4).join(" · ") + (openLabels.length > 4 ? ` · +${openLabels.length - 4}` : "");
  if (!asked) return left ? `Listening for the story — still open: ${openList}.` : "Listening for the story.";
  return left ? `${asked} asked · still open: ${openList}.` : `${asked} asked · story dimensions covered.`;
}

/** Prompt for one live Memory follow-up (replaces PRD gap policy). */
export function memoryAgentQuestionPrompt(opts: {
  projectName: string;
  key: string;
  label: string;
  desc: string;
  recent: string;
  alreadyAsked: string[];
  intent?: MemoryIntent;
}): string {
  const intent = opts.intent || DEFAULT_MEMORY_INTENT;
  return [
    `You are an oral historian / podcast producer in a live room${opts.projectName ? ` about ${opts.projectName}` : ""}.`,
    "You are drawing out a lived story — not filling a PRD checklist. No product scope, metrics, or architecture questions.",
    `Soft lean: ${intent} (story, podcast, and book all share the same Memory agent).`,
    "",
    `One part of the Memory package is still thin:`,
    `  ${opts.key}: ${opts.label} — ${opts.desc}`,
    "",
    "Last few minutes of what was said:",
    "",
    String(opts.recent || "").trim() || "(nothing yet)",
    "",
    opts.alreadyAsked.length
      ? `Already asked — do not repeat:\n${opts.alreadyAsked.map((q) => `  - ${q}`).join("\n")}\n`
      : "",
    "Ask ONE concrete oral-historian follow-up that deepens that dimension.",
    "",
    "RULES:",
    "- One sentence, under 20 words. No preamble.",
    "- Prefer chronology, people, turning points, sensory detail, lessons, or exact quotes.",
    "- Build on what they JUST said; quote a short phrase when you can.",
    "- Offer 2 or 3 short complete answers they could pick.",
    "- Say in one plain sentence what this choice adds to the story.",
    "",
    'Respond with STRICT JSON ONLY: {"question":"...","options":["...","..."],"why":"..."}',
  ].filter(Boolean).join("\n");
}
