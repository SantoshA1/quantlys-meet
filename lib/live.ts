// Live notes — the meeting writing itself down while it happens.
//
// DESIGN 2026-08-18. The in-meeting rail shows what was just said, and lifts
// out the two kinds of sentence a meeting exists to produce: a DECISION and
// a COMMITMENT. The rules are the SAME ones the finish route applies to the
// recording afterwards — one set of rules, imported by both, because the
// moment the live rail and the emailed notes disagree about what was decided,
// both stop being believed.
//
// Detection is deliberately deterministic (regex over final captions). A
// model could catch more; it could also invent one, live, in front of the
// person it misquotes. These rules only ever promote a sentence somebody
// actually said.

export type Caught = {
  kind: "decision" | "action";
  at: number;        // ms since captions started — the caption's own clock
  who: string;
  text: string;
};

// The shared rules — the route's own, moved here verbatim so the live rail
// and the emailed notes can never disagree about what counts.
export const COMMIT = new RegExp(
  "\\b(i'?ll|i will|we'?ll|we will|i'?m going to|we'?re going to|" +
    "we need to|we should|you should|let'?s|can you|could you|please|" +
    "make sure|follow ?up|action item|take (?:this|that|it) on|i'?ll own|" +
    "send (?:me|us|over)|share (?:the|a)|set up|schedule|by (?:eod|cob|" +
    "today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|" +
    "end of (?:day|week)))\\b",
  "i"
);
export const DECIDE = new RegExp(
  "\\b(we (?:decided|agreed|settled on)|let'?s go with|we'?re going with|" +
    "the decision is|final answer|agreed[,.]|sign(?:ed)? off|approved)\\b",
  "i"
);
export const NOISE = /^(?:yeah|yes|no|ok|okay|right|sure|thanks|thank you|hello|hi|mm+|uh+|um+)[\s.,!?]*$/i;

type FinalCaption = { who: string; text: string; at: number; final?: boolean };

/** Read the finals so far and promote what qualifies. Pure and idempotent:
 *  feed it the whole list every time, it returns the whole caught list —
 *  no incremental state to drift. Deduped on the sentence, because people
 *  repeat the decision back and one decision is not two. */
export function catchLive(finalsList: FinalCaption[], caps = { decisions: 10, actions: 15 }): Caught[] {
  const out: Caught[] = [];
  const seen = new Set<string>();
  let d = 0, a = 0;
  for (const c of finalsList || []) {
    const text = String(c.text || "").trim();
    if (text.length < 12 || NOISE.test(text)) continue;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    if (DECIDE.test(text)) {
      if (d >= caps.decisions) continue;
      seen.add(key); d++;
      out.push({ kind: "decision", at: Number(c.at) || 0, who: String(c.who || ""), text });
    } else if (COMMIT.test(text)) {
      if (a >= caps.actions) continue;
      seen.add(key); a++;
      out.push({ kind: "action", at: Number(c.at) || 0, who: String(c.who || ""), text });
    }
  }
  return out;
}

export function caughtCounts(list: Caught[]): { decisions: number; actions: number } {
  let decisions = 0, actions = 0;
  for (const c of list || []) c.kind === "decision" ? decisions++ : actions++;
  return { decisions, actions };
}

/** Who has talked how much, from the captions the room already shares.
 *  Percent by words, keyed by display name. The tile badge reads this. */
export function talked(finalsList: Array<{ who: string; text: string }>): Record<string, number> {
  const count: Record<string, number> = {};
  let total = 0;
  for (const c of finalsList || []) {
    const w = String(c.text || "").split(/\s+/).filter(Boolean).length;
    if (!w || !c.who) continue;
    count[c.who] = (count[c.who] || 0) + w;
    total += w;
  }
  const out: Record<string, number> = {};
  if (!total) return out;
  for (const k of Object.keys(count)) out[k] = Math.round((count[k] / total) * 100);
  return out;
}

/** "LINK EXCELLENT · 42 MS" from LiveKit's connection quality. The design
 *  prints a measurement, so this only prints the latency when one was
 *  actually measured — "LINK EXCELLENT · ?" is worse than no number. */
export function linkLabel(quality: string, rttMs?: number | null): string {
  const q = String(quality || "").toLowerCase();
  const word =
    q === "excellent" ? "EXCELLENT" :
    q === "good" ? "GOOD" :
    q === "poor" ? "POOR" :
    q === "lost" ? "LOST" : "";
  if (!word) return "";
  const ms = Number(rttMs);
  return Number.isFinite(ms) && ms > 0 ? `LINK ${word} · ${Math.round(ms)} MS` : `LINK ${word}`;
}

/** What clock a flag gets stamped with — or -1 when there is nothing durable
 *  to anchor it to. The rules, in order of trust:
 *    1. the last caption final's own clock (the transcript's clock);
 *    2. time since captions switched on, when they're on but nothing has
 *       been said yet — the transcript will start from that same origin;
 *    3. the recording clock, when recording without captions;
 *    4. nothing → -1, and the button should be disabled, because a flag
 *       nobody can find afterwards is worse than no flag.
 *  FIELD 2026-08-18: captions ON with no finals yet fell through to -1 and
 *  the button silently did nothing — "unable to Flag any moment". */
export function flagAt(input: {
  ccOn: boolean;
  lastFinalAt?: number | null;   // ms, the newest final's stamp
  ccElapsedMs?: number | null;   // ms since captions switched on
  recording: boolean;
  recElapsedSec?: number | null; // the recording counter, seconds
}): number {
  // Number(null) is 0 — an absent clock must never read as clock-zero, so
  // null/undefined are rejected BEFORE coercion. The guard that caught this
  // is the "nothing said yet" one.
  const num = (v: number | null | undefined) =>
    v === null || v === undefined ? NaN : Number(v);
  if (input.ccOn) {
    const last = num(input.lastFinalAt);
    if (Number.isFinite(last) && last >= 0) return Math.round(last);
    const cc = num(input.ccElapsedMs);
    if (Number.isFinite(cc) && cc >= 0) return Math.round(cc);
  }
  if (input.recording) {
    const rec = num(input.recElapsedSec);
    if (Number.isFinite(rec) && rec >= 0) return Math.round(rec * 1000);
  }
  return -1;
}

/** The clock label on a caught card — captions stamp in ms. */
export function atLabel(ms: number): string {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
