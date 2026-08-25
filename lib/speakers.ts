// Putting the right name on the right voice.
//
// FIELD 2026-08-25: "users names are missing, instead shows sometimes
// Speaker. The speaker names should pick from the name the user entered when
// joining the meeting and map to while they are talking."
//
// The app HAS the names. Everybody types one on the way in, the join token
// carries it, and every live caption is stamped with it. And then the
// recording pipeline throws them away — not by accident, by preference:
//
//   · Deepgram diarises a COMPOSITE recording. One mixed audio file goes up,
//     and what comes back is `speaker: 0, 1, 2` — anonymous by construction,
//     because there is nothing in a mixed waveform that says "Kiran".
//     speakerName() turned those into "Speaker 1", "Speaker 2".
//   · The captions, which DO carry real names, were used only when Deepgram
//     produced nothing at all (`if (!heard && ...)`). So the better the
//     transcription worked, the more certainly the names were lost.
//   · And even on that fallback path, `who` was dropped when the timed lines
//     were built — so the sidecar a person downloads had numbers in it either
//     way.
//
// THE INSIGHT: the two sources are good at opposite things. Deepgram has the
// words. The captions have the names and the clock. Overlap them and you get
// both — Deepgram's accuracy with certain names attached, and no guessing.
//
// THE RULE THIS FILE WILL NOT BREAK, and it is the codebase's own, from the
// notes prompt: a confidently wrong name is worse than an anonymous one,
// because it puts words in somebody's mouth. Every mapping below has to earn
// its confidence, and an unclear one stays a number.
//
// ZERO-IMPORT, so the alignment can be argued with in a test.

export type DgUtterance = { start: number; end?: number; speaker?: number; transcript?: string };
export type CapLine = { start: number; end?: number; who?: string; transcript?: string };

/** A caption line covers about this long when it has no end of its own. The
 *  caption stream emits one line per utterance, so this is the typical spoken
 *  phrase rather than a guess pulled out of the air. */
export const CAP_SPAN_S = 4;

/** A speaker is only given a name when that name owns this much of their
 *  overlapped speech. Below it, two people were talking over each other and
 *  the honest answer is the number. */
export const NAME_CONFIDENCE = 0.6;

/** And there has to be enough overlap to mean anything. One second of
 *  coincidence is not evidence. */
export const MIN_OVERLAP_S = 2;

const norm = (s: any) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const spanOf = (x: { start: number; end?: number }) => {
  const a = Number(x?.start) || 0;
  const b = Number(x?.end);
  return { a, b: Number.isFinite(b) && b > a ? b : a + CAP_SPAN_S };
};

function overlap(x: { start: number; end?: number }, y: { start: number; end?: number }): number {
  const p = spanOf(x), q = spanOf(y);
  return Math.max(0, Math.min(p.b, q.b) - Math.max(p.a, q.a));
}

/** THE CLOCKS DO NOT SHARE AN ORIGIN, and assuming they do is how this whole
 *  idea quietly produces the wrong names.
 *
 *  A caption's `start` is seconds since CAPTIONS were switched on. A Deepgram
 *  utterance's `start` is seconds since the RECORDING began. Somebody who
 *  turns captions on ten minutes into a recorded meeting has two timelines ten
 *  minutes apart, and naive overlapping would map every voice to whoever
 *  happened to be talking ten minutes earlier.
 *
 *  So the offset is MEASURED, from the text itself: find lines whose words
 *  match, take the median of their time differences. Median rather than mean
 *  because one mismatched pair should not drag the answer. Returns null when
 *  there is not enough agreement to be sure — and a null offset means no
 *  names, which is the correct outcome for two recordings that have nothing
 *  to do with each other. */
export function estimateOffset(dg: DgUtterance[], caps: CapLine[]): number | null {
  const byText = new Map<string, number>();
  for (const c of caps || []) {
    const t = norm(c?.transcript);
    // Short phrases are common ("yes", "okay") and match everything.
    if (t.length < 18) continue;
    if (!byText.has(t)) byText.set(t, Number(c?.start) || 0);
  }
  const deltas: number[] = [];
  for (const u of dg || []) {
    const t = norm(u?.transcript);
    if (t.length < 18) continue;
    const capAt = byText.get(t);
    if (capAt === undefined) continue;
    deltas.push((Number(u?.start) || 0) - capAt);
  }
  if (deltas.length < 2) return null;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
  return Math.round(median * 100) / 100;
}

export type SpeakerMap = Record<number, string>;

/** Deepgram speaker index -> the name of the person who was actually talking.
 *
 *  Built by overlapping every diarised utterance with the caption timeline and
 *  asking which named person was speaking at that moment. A speaker is named
 *  only when one person owns a clear majority of their overlapped time. */
export function nameSpeakers(
  dg: DgUtterance[],
  caps: CapLine[],
  offsetSeconds: number | null
): SpeakerMap {
  if (offsetSeconds === null || !Array.isArray(dg) || !Array.isArray(caps) || !caps.length) return {};
  // Move the captions onto the recording's clock, once.
  const shifted = caps
    .filter((c) => String(c?.who || "").trim() && String(c?.transcript || "").trim())
    .map((c) => ({
      who: String(c.who).trim(),
      start: (Number(c.start) || 0) + offsetSeconds,
      end: Number.isFinite(Number(c.end)) ? (Number(c.end) as number) + offsetSeconds : undefined,
    }));
  if (!shifted.length) return {};

  const tally: Record<number, Record<string, number>> = {};
  for (const u of dg) {
    const sp = u?.speaker;
    if (typeof sp !== "number") continue;
    for (const c of shifted) {
      const secs = overlap(u, c);
      if (secs <= 0) continue;
      (tally[sp] ||= {});
      tally[sp][c.who] = (tally[sp][c.who] || 0) + secs;
    }
  }

  const out: SpeakerMap = {};
  for (const key of Object.keys(tally)) {
    const sp = Number(key);
    const rows = Object.entries(tally[sp]).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, r) => s + r[1], 0);
    if (!rows.length || total < MIN_OVERLAP_S) continue;
    const [who, secs] = rows[0];
    // A confidently wrong name is worse than an anonymous one.
    if (secs / total >= NAME_CONFIDENCE) out[sp] = who;
  }
  return out;
}

/** The label a speaker gets. The map first, then the ONE case where a number
 *  can be resolved without any alignment at all: a meeting with exactly one
 *  person in it has exactly one possible voice. */
export function speakerLabel(
  speaker: number | undefined,
  map: SpeakerMap,
  roster: string[] = []
): string {
  if (typeof speaker !== "number" || speaker < 0) {
    return roster.length === 1 ? String(roster[0]).trim() : "Someone";
  }
  const mapped = map?.[speaker];
  if (mapped) return mapped;
  const people = (roster || []).map((r) => String(r || "").trim()).filter(Boolean);
  if (people.length === 1) return people[0];
  return `Speaker ${speaker + 1}`;
}

/** Everyone who actually said something, by name where we know it. This is
 *  what a person reads at the top of the notes, and "Speaker 1, Speaker 2" is
 *  the thing they complained about seeing there. */
export function speakerList(dg: DgUtterance[], map: SpeakerMap, roster: string[] = []): string[] {
  const seen = new Set<number>();
  for (const u of dg || []) if (typeof u?.speaker === "number") seen.add(u.speaker);
  const out = Array.from(seen).sort((a, b) => a - b).map((n) => speakerLabel(n, map, roster));
  return Array.from(new Set(out));
}

/** How well did it go? Surfaced in the recording's own step list, because a
 *  person who sees "Speaker 2" deserves to know WHY — captions were off, or
 *  two people talked over each other — rather than assuming the app is broken. */
export function namingNote(s: {
  speakers: number;
  named: number;
  hadCaptions: boolean;
  aligned: boolean;
}): string {
  if (!s.speakers) return "";
  if (s.named >= s.speakers) return `Matched all ${s.speakers} voice(s) to the names people joined with.`;
  if (!s.hadCaptions) {
    return `Heard ${s.speakers} voice(s), shown as Speaker 1, 2… — a recording is one mixed audio track, so the only way to put names to voices is to have captions on during the meeting.`;
  }
  if (!s.aligned) {
    return `Heard ${s.speakers} voice(s) but couldn't line the captions up with the recording, so they're numbered. This happens when captions were switched on well after recording started.`;
  }
  return `Named ${s.named} of ${s.speakers} voice(s) from the captions; the rest are numbered because more than one person was talking at those moments.`;
}
