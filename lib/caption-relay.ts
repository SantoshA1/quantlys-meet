// Deepgram captions through our own server, for keys that can't mint browser keys.
//
// FIELD 2026-10-19: the hosted site's DEEPGRAM_API_KEY can transcribe but has
// neither `keys:write` (to mint a short-lived browser key) nor the member scope
// /v1/auth/grant needs. Every meeting fell back to the browser's recogniser,
// and the caption glossary — which only Deepgram reads — did nothing.
//
// The relay keeps the key on the server. The browser cuts its own microphone
// into short utterances (cut at a pause, so words aren't split) and posts each
// one to /api/captions/relay, which sends it to Deepgram and returns the text.
// Each person still captions only their own microphone, so attribution stays
// a fact. The cost is latency: a line appears when its speaker pauses, not
// word by word, and the UI says so.

export const RELAY_MODEL = "nova-3";
/** Largest utterance the relay accepts. 15s of 32 kbps Opus is ~60 KB. */
export const RELAY_MAX_BYTES = 400_000;
export const RELAY_MIN_BYTES = 800;

export type SegmenterOpts = {
  /** Quiet this long after speech ends the utterance. */
  endSilenceMs: number;
  /** Cut anyway after this long so one monologue doesn't wait forever. */
  maxMs: number;
  /** Speech shorter than this in total is a cough, not a caption. */
  minSpeechMs: number;
  /** Throw away a segment that has had no speech for this long. */
  idleResetMs: number;
  /** Floor for the speech threshold (RMS, 0..1). */
  minThreshold: number;
};

export const SEGMENTER_DEFAULTS: SegmenterOpts = {
  endSilenceMs: 650,
  maxMs: 12_000,
  minSpeechMs: 250,
  idleResetMs: 4_000,
  minThreshold: 0.012,
};

export type SegState = {
  startedAt: number;     // when the current recorder segment began
  speechMs: number;      // speech heard in this segment
  lastSpeechAt: number;  // 0 = no speech yet in this segment
  lastAt: number;
  noise: number;         // running noise floor
};

export type SegAction = "none" | "send" | "discard";

export function newSegment(now: number, noise = 0.004): SegState {
  return { startedAt: now, speechMs: 0, lastSpeechAt: 0, lastAt: now, noise };
}

/** Feed one level reading. Returns what to do with the segment recorded so far:
 *  "send" (an utterance ended), "discard" (nothing said — start over quietly)
 *  or "none". The caller starts a new segment after send/discard. */
export function feedLevel(
  s: SegState,
  rms: number,
  now: number,
  o: SegmenterOpts = SEGMENTER_DEFAULTS
): { state: SegState; action: SegAction } {
  const dt = Math.max(0, Math.min(500, now - s.lastAt));
  const threshold = Math.max(o.minThreshold, s.noise * 3);
  const speaking = rms >= threshold;
  // Track the room's noise floor only while nobody is talking.
  const noise = speaking ? s.noise : s.noise * 0.95 + Math.min(rms, 0.05) * 0.05;
  const st: SegState = {
    ...s,
    lastAt: now,
    noise,
    speechMs: s.speechMs + (speaking ? dt : 0),
    lastSpeechAt: speaking ? now : s.lastSpeechAt,
  };
  const age = now - st.startedAt;
  if (st.lastSpeechAt === 0 || st.speechMs < o.minSpeechMs) {
    // Nothing worth sending yet. A long quiet segment is dropped so the next
    // utterance doesn't carry seconds of silence (and cost) with it.
    if (!speaking && now - (st.lastSpeechAt || st.startedAt) >= o.idleResetMs) return { state: st, action: "discard" };
    if (age >= o.maxMs) return { state: st, action: "discard" };
    return { state: st, action: "none" };
  }
  if (!speaking && now - st.lastSpeechAt >= o.endSilenceMs) return { state: st, action: "send" };
  if (age >= o.maxMs) return { state: st, action: "send" };
  return { state: st, action: "none" };
}

/** RMS of a time-domain buffer (Uint8 0..255 centred on 128, or floats -1..1). */
export function rmsOf(buf: ArrayLike<number>, bytes = false): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = bytes ? (buf[i] - 128) / 128 : buf[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/** The Deepgram URL the relay calls. Terms come from the client and are
 *  re-sanitised here; nothing else from the client reaches the query string. */
export function relayQuery(terms: string[]): URLSearchParams {
  return new URLSearchParams([
    ["model", RELAY_MODEL],
    ["smart_format", "true"],
    ["punctuate", "true"],
    ...terms.map((t) => ["keyterm", t] as [string, string]),
  ]);
}

/** Audio types the relay forwards. Anything else is refused before Deepgram sees it. */
export function relayContentType(ct: string | null): string | null {
  const base = String(ct || "").split(";")[0].trim().toLowerCase();
  return ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"].includes(base) ? base : null;
}

/** Deepgram pre-recorded response → caption text. */
export function relayText(j: any): string {
  return String(j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "").trim();
}
