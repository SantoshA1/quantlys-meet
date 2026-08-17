// Live captions.
//
// FIELD 2026-08-17: every meeting tool worth using has captions and we had
// none. That is not a nice-to-have — it is the difference between a meeting a
// deaf person can take part in and one they cannot, and it is what everyone
// else quietly relies on in a noisy room, on a bad line, or in a language they
// read better than they hear.
//
// THE ARCHITECTURAL DECISION, because everything else follows from it:
// each person captions THEIR OWN microphone and broadcasts the text.
//
// The obvious alternative — mix everyone's audio on a server and transcribe
// the mix — is worse in every way that matters. It has to guess who is
// speaking from voice alone, which is the hard problem and the one that goes
// wrong; it costs per-minute for the whole room; and it adds a network hop to
// something people notice at 200ms. Captioning your own microphone knows who
// you are for free, because it is your microphone. Attribution stops being a
// machine-learning problem and becomes a fact.
//
// Pure functions here. The merge rule below is the part that is quietly wrong
// in most implementations, so it is the part that gets tested.

export type Caption = {
  id: string;        // stable per utterance, per speaker
  who: string;
  text: string;
  final: boolean;
  at: number;        // ms since the meeting's captions started
};

export const CC_TOPIC = "qm-cc";

/** How long an unfinished line may sit there before we stop believing it.
 *  A browser that stops recognising mid-sentence leaves an interim caption
 *  frozen on everyone's screen, which reads as "they are still talking". */
export const INTERIM_TTL_MS = 8000;

/** Merge an arriving caption into the list.
 *
 *  The rule everybody gets wrong: an INTERIM result is a draft of a line that
 *  is still being spoken, and it arrives over and over as the recogniser
 *  changes its mind. It must REPLACE the previous draft of the same utterance,
 *  never append. Append it and one sentence becomes twenty overlapping
 *  fragments scrolling past — which is how captions become unreadable at
 *  exactly the moment somebody needs them.
 *
 *  A FINAL result replaces the draft one last time and then never changes. */
export function mergeCaption(list: Caption[], incoming: Caption, max = 300): Caption[] {
  if (!incoming || !incoming.id || !String(incoming.text || "").trim()) return list;
  const i = list.findIndex((c) => c.id === incoming.id);
  if (i >= 0) {
    // A late interim must never overwrite a line already settled. Packets can
    // arrive out of order, and a final that flips back to a draft is a caption
    // that appears to un-say something.
    if (list[i].final && !incoming.final) return list;
    const next = list.slice();
    next[i] = { ...list[i], ...incoming };
    return next;
  }
  const next = [...list, incoming];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Drop drafts nobody finished. Keeps finals forever (up to the cap). */
export function pruneStale(list: Caption[], now: number, ttl = INTERIM_TTL_MS): Caption[] {
  const kept = list.filter((c) => c.final || now - c.at < ttl);
  return kept.length === list.length ? list : kept;
}

/** The last N lines, oldest first — what the bar at the bottom shows. */
export function visible(list: Caption[], n = 3): Caption[] {
  return list.slice(Math.max(0, list.length - n));
}

/** Only the settled text, in order — the record, with the drafts thrown away. */
export function finals(list: Caption[]): Caption[] {
  return list.filter((c) => c.final && c.text.trim().length > 0);
}

/** mm:ss from the caption clock. */
export function stamp(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** The caption log as a transcript.
 *
 *  FIELD note: a meeting that was captioned live but never transcribed
 *  afterwards still HAS all its words — they went past on the screen. Throwing
 *  them away and reporting "no transcript" because one API key is missing is
 *  the app choosing to know less than it does. Same `[123s] Name: text` shape
 *  the notes and the Ask feature already read, so it drops straight in. */
export function toTranscript(list: Caption[]): string {
  return finals(list)
    .map((c) => `[${Math.round(c.at / 1000)}s] ${c.who}: ${c.text.trim()}`)
    .join("\n");
}

/** Same log, as the timed lines a citation can point at. */
export function toUtterances(
  list: Caption[]
): Array<{ start: number; speaker: number; transcript: string; who: string }> {
  const seen: string[] = [];
  return finals(list).map((c) => {
    let i = seen.indexOf(c.who);
    if (i < 0) { seen.push(c.who); i = seen.length - 1; }
    return { start: Math.round(c.at / 1000), speaker: i, transcript: c.text.trim(), who: c.who };
  });
}

// ── which engine, and saying so ────────────────────────────────────────────
//
// Two paths, because one of them needs a key and the other needs a browser
// that happens to have a recogniser in it. Whichever is running, the person
// gets told — including the bit they would not otherwise know: where their
// voice goes. Captions that quietly ship your microphone somewhere are a
// privacy decision made on somebody's behalf without telling them.

export type Engine = "deepgram" | "browser" | "none";

export function engineNote(engine: Engine): string {
  if (engine === "deepgram") {
    return "Captions are produced by Deepgram, the same service that transcribes your recordings. Your microphone audio is sent there while captions are on.";
  }
  if (engine === "browser") {
    return "Captions are produced by your own browser's speech recogniser. In Chrome and Edge that means your microphone audio is sent to Google while captions are on. Nothing is sent by Quantlys.";
  }
  return "This browser has no speech recogniser and no transcription key is set, so live captions aren't available here. Firefox has none built in — Chrome, Edge and Safari do. The recording is still transcribed afterwards.";
}

/** Which engine to use, given what is actually available. Deepgram first: it
 *  is more accurate, it works in every browser, and it is the same vendor the
 *  recording already uses, so the live text and the saved transcript agree. */
export function pickEngine(hasKey: boolean, hasBrowserRecogniser: boolean): Engine {
  if (hasKey) return "deepgram";
  if (hasBrowserRecogniser) return "browser";
  return "none";
}

/** What the header button says. A control that cannot work must say so before
 *  it is pressed, not after. */
export function toggleLabel(engine: Engine, on: boolean): string {
  if (engine === "none") return "Captions unavailable";
  return on ? "Captions on" : "Captions";
}
