// Who said it — carried from the recording into the PRD.
//
// FIELD 2026-10-26: "start on the speaker names in the PRD."
//
// The recording pipeline already does the hard part. lib/speakers.ts lines
// Deepgram's anonymous voices up against the live captions, and every caption
// is stamped with the name the person typed when they joined. The result is
// saved on every summary as `utterances[].who`. And then /api/prd threw it
// away: it read `summary.transcript`, which on the Deepgram path is the
// PARAGRAPH transcript — "Speaker 0: …", "Speaker 1: …" — so the model that
// writes the PRD never saw a single name, however well the alignment did.
//
// This module builds the transcript the PRD prompt reads FROM THE NAMED
// LINES, and produces the set of labels the model is allowed to attribute to.
// Everything the model returns is checked against that set afterwards, so a
// name that is not a speaker label in these meetings never reaches the
// document — the model is told not to invent one, and then it is not trusted.
//
// THE RULE, the same one lib/speakers.ts will not break: a confidently wrong
// name is worse than an anonymous one. An unnamed voice stays "Speaker 2";
// a room where several voices came through ONE person's microphone is said to
// be that, not attributed to the person who owns the microphone.
//
// PRIVACY: nothing here is new data. The names are the display names people
// typed at join, already stored in the summary's `utterances` and `people`;
// this only reads them.
//
// ZERO-IMPORT, so every judgement here is testable on its own.

export type Utt = { start?: number; speaker?: number; transcript?: string; who?: string };
export type SummaryLike = { transcript?: string; utterances?: Utt[]; people?: string[] };

export const UNKNOWN_SPEAKER = "Unknown speaker";
export const NAME_MAX = 60;

/** Labels that are a placeholder, not a person. "Someone" is what
 *  speakerLabel() writes when there is no speaker index at all. */
const GENERIC = /^(speaker\s*\d+|someone|unknown(\s+speaker)?|guest|participant)$/i;

/** A display name as it may appear in a prompt and a document: one line,
 *  no characters that would let a name pose as transcript structure
 *  ("Kiran: decided" inside a NAME would read as a line of speech). */
export function cleanName(s: unknown): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[:\[\]()_*`#<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** Is this a person's name, or a stand-in for one? */
export function isRealName(s: unknown): boolean {
  const n = cleanName(s);
  return Boolean(n) && !GENERIC.test(n);
}

function stamp(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type Attributed = {
  /** The transcript the PRD prompt reads, one `[mm:ss] Label: words` per turn. */
  text: string;
  /** Real display names that speak in it. */
  names: string[];
  /** Every label in it — names, "Speaker N", the shared-mic labels. */
  labels: string[];
  /** Turns carrying a real name, out of all turns. */
  named: number;
  total: number;
  /** Where the text came from: the named lines, or the bare transcript. */
  source: "utterances" | "transcript";
  /** Set when several voices came through one participant's microphone. */
  sharedMic: string | null;
};

/** The old caption transcript (`[12s] Kiran: words`) carries names in the
 *  text itself. Summaries from before `utterances` existed still have it. */
const CAPTION_LINE = /^\[\d+s\]\s+([^:\n]{1,80}):\s/;

/** One meeting's transcript, with the names put back. */
export function attributedTranscript(summary: SummaryLike | null | undefined): Attributed {
  const raw = String(summary?.transcript || "").trim();
  const utts = (Array.isArray(summary?.utterances) ? summary!.utterances! : [])
    .filter((u) => u && String(u.transcript || "").trim());

  if (!utts.length) {
    // No timed lines. A caption transcript still names its speakers in the
    // text; a Deepgram paragraph transcript says "Speaker 0:", which is a
    // voice and not a person.
    const names = new Set<string>();
    for (const line of raw.split("\n")) {
      const m = line.match(CAPTION_LINE);
      if (m && isRealName(m[1]) && cleanName(m[1]) === m[1].trim()) names.add(cleanName(m[1]));
    }
    return {
      text: raw, names: [...names], labels: [...names], named: 0, total: 0,
      source: "transcript", sharedMic: null,
    };
  }

  const roster = (Array.isArray(summary?.people) ? summary!.people! : [])
    .map(cleanName).filter((n) => isRealName(n));
  const voices = new Set(utts.map((u) => u.speaker).filter((x) => typeof x === "number" && x >= 0));
  // ONE person joined, and the recording heard SEVERAL voices: a laptop in a
  // meeting room. Every voice was mapped to that one name, because that one
  // name stamped every caption. Saying "Kiran decided" about a sentence
  // somebody across the table said is exactly the wrong name this module
  // exists to refuse.
  const sharedMic = roster.length === 1 && voices.size > 1 ? roster[0] : null;

  const labelOf = (u: Utt): string => {
    const who = cleanName(u.who);
    const n = typeof u.speaker === "number" && u.speaker >= 0 ? u.speaker + 1 : 0;
    if (sharedMic && (!isRealName(who) || who === sharedMic)) {
      return n ? `Speaker ${n} on ${sharedMic}'s mic` : `Someone on ${sharedMic}'s mic`;
    }
    if (isRealName(who)) return who;
    return n ? `Speaker ${n}` : UNKNOWN_SPEAKER;
  };

  const turns: Array<{ at: number; label: string; words: string[] }> = [];
  const names = new Set<string>();
  const labels = new Set<string>();
  let named = 0;
  for (const u of utts) {
    const label = labelOf(u);
    labels.add(label);
    const real = isRealName(label) && !/\bmic$/.test(label);
    if (real) names.add(label);
    const last = turns[turns.length - 1];
    if (last && last.label === label) {
      last.words.push(String(u.transcript).trim());
    } else {
      turns.push({ at: Number(u.start) || 0, label, words: [String(u.transcript).trim()] });
      if (real) named++;
    }
  }
  return {
    text: turns.map((t) => `[${stamp(t.at)}] ${t.label}: ${t.words.join(" ")}`).join("\n"),
    names: [...names],
    labels: [...labels],
    named,
    total: turns.length,
    source: "utterances",
    sharedMic,
  };
}

/** The labels a model may attribute to, across every meeting it read. */
export function allowedLabels(parts: Attributed[]): { names: string[]; labels: string[] } {
  const names = new Set<string>();
  const labels = new Set<string>();
  for (const p of parts || []) {
    for (const n of p?.names || []) names.add(n);
    for (const l of p?.labels || []) labels.add(l);
  }
  return { names: [...names].sort(), labels: [...labels].sort() };
}

/** The canonical label a model's string refers to, or "" when it names
 *  nobody in these meetings. Case and spacing forgiven; spelling is not —
 *  "Kieran" for "Kiran" is a different person as far as a document goes. */
export function matchLabel(given: unknown, allowed: string[]): string {
  const g = cleanName(given).toLowerCase();
  if (!g) return "";
  const hit = (allowed || []).find((a) => cleanName(a).toLowerCase() === g);
  return hit || "";
}

export type AttributionKind = "decision" | "requirement" | "open_question" | "action_item";
export const ATTRIBUTION_KINDS: AttributionKind[] = ["decision", "requirement", "open_question", "action_item"];
export type Attribution = { kind: AttributionKind; text: string; by: string[]; owner?: string };

export const ATTRIBUTION_TEXT_MAX = 300;
export const ATTRIBUTIONS_KEPT = 60;

const KIND_ALIASES: Record<string, AttributionKind> = {
  decision: "decision", decisions: "decision",
  requirement: "requirement", requirements: "requirement", story: "requirement", user_story: "requirement",
  open_question: "open_question", open_questions: "open_question", question: "open_question",
  action_item: "action_item", action_items: "action_item", action: "action_item", actions: "action_item",
};

/** What the model said about who raised what, with every name it could not
 *  have got from these meetings removed. An item whose only name was
 *  invented is KEPT, unattributed — the item is real even when the name is
 *  not, and the reader is better off seeing "unattributed" than nothing. */
export function normalizeAttributions(raw: unknown, allowed: string[]): Attribution[] {
  const rows: any[] = Array.isArray(raw) ? raw : [];
  const out: Attribution[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const kind = KIND_ALIASES[String(r.kind || "").trim().toLowerCase()];
    if (!kind) continue;
    const text = String(r.text || "").replace(/\s+/g, " ").trim().slice(0, ATTRIBUTION_TEXT_MAX);
    if (!text) continue;
    const key = `${kind}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const given = Array.isArray(r.by) ? r.by : (r.by ? [r.by] : []);
    const by = Array.from(new Set(given.map((x: unknown) => matchLabel(x, allowed)).filter(Boolean))).slice(0, 5) as string[];
    const item: Attribution = { kind, text, by };
    if (kind === "action_item") {
      const owner = matchLabel(r.owner, allowed);
      if (owner) item.owner = owner;
    }
    out.push(item);
    if (out.length >= ATTRIBUTIONS_KEPT) break;
  }
  return out;
}

/** The inline form the model is told to write in the artifact:
 *  `_(raised by Kiran, Priya)_`. Any name in one that is not a speaker label
 *  is removed, and an attribution left with nobody in it says so. Free prose
 *  elsewhere in the document cannot be policed this way — the prompt covers
 *  it — but the one sanctioned place a name is asserted is checked. */
const INLINE = /\((raised by|owner|owned by)\s*:?\s+([^()\n]{1,200})\)/gi;

export function scrubInlineNames(markdown: string, allowed: string[]): string {
  return String(markdown || "").replace(INLINE, (_m, verb: string, list: string) => {
    const whole = matchLabel(list, allowed);
    const parts = whole ? [whole] : String(list).split(/\s*,\s*|\s+and\s+|\s*&\s*/i);
    const kept = Array.from(new Set(parts.map((p) => matchLabel(p, allowed)).filter(Boolean)));
    const v = String(verb).toLowerCase().startsWith("raised") ? "raised by" : "owner:";
    return kept.length ? `(${v} ${kept.join(", ")})` : "(unattributed)";
  });
}

/** One plain sentence on how much of this could be attributed, for the
 *  document and the panel. Empty when every turn had a name. */
export function attributionNote(parts: Attributed[]): string {
  const ps = (parts || []).filter(Boolean);
  if (!ps.length) return "";
  const shared = Array.from(new Set(ps.map((p) => p.sharedMic).filter(Boolean)));
  const anyNames = ps.some((p) => p.names.length);
  const total = ps.reduce((s, p) => s + p.total, 0);
  const named = ps.reduce((s, p) => s + p.named, 0);
  const notes: string[] = [];
  if (!anyNames) {
    notes.push("No speaker names were available for these meetings — turn captions on during a recorded meeting and the names people joined with are attached to what they said. Nothing below is attributed.");
  } else if (total && named < total) {
    notes.push(`Names come from what each person typed when they joined. ${named} of ${total} turns could be matched to a name; the rest are shown as "Speaker N" rather than guessed.`);
  } else {
    notes.push("Names come from what each person typed when they joined.");
  }
  if (shared.length) {
    notes.push(`Several voices came through ${shared.join(", ")}'s microphone, so those are labelled by microphone, not by person.`);
  }
  return notes.join(" ");
}
