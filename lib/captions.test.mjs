/**
 * MAYA GUARD — live captions.
 *
 * Maya asks: "I can't hear well. Can I follow this meeting by reading it —
 * and does it say who said what, or is it a wall of text?"
 *
 * FIELD 2026-08-17: the app had no captions at all. Every competitor has them,
 * and for a deaf participant they are not a feature, they are whether the
 * meeting is attendable.
 *
 * The guards below concentrate on the two things that make captions unreadable
 * rather than merely imperfect: interim results appended instead of replaced,
 * and a draft nobody finished sitting frozen on screen as if somebody were
 * still talking.
 *
 * Run: node lib/captions.test.mjs
 */
import {
  mergeCaption, pruneStale, visible, finals, stamp, toTranscript, toUtterances,
  engineNote, pickEngine, toggleLabel, INTERIM_TTL_MS, CC_TOPIC,
} from "./captions.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const cap = (o) => ({ id: "a1", who: "Santosh", text: "hello", final: false, at: 1000, ...o });

// ── the merge rule, which is the whole readability of the feature ─────────
//
// An interim result is a DRAFT of a line still being spoken. It arrives over
// and over as the recogniser changes its mind. Append it and one sentence
// becomes twenty overlapping fragments.
let L = [];
L = mergeCaption(L, cap({ text: "we should" }));
L = mergeCaption(L, cap({ text: "we should move to" }));
L = mergeCaption(L, cap({ text: "we should move to Stripe" }));
ok(L.length === 1, "three drafts of one sentence are ONE line, not three");
ok(L[0].text === "we should move to Stripe", "…and it is the newest draft");

L = mergeCaption(L, cap({ text: "We should move to Stripe.", final: true }));
ok(L.length === 1 && L[0].final, "the final replaces the draft one last time");

L = mergeCaption(L, cap({ id: "a2", text: "agreed", final: true }));
ok(L.length === 2, "a new utterance is a new line");

// Packets arrive out of order. A late draft must never un-say a settled line.
const settled = mergeCaption([], cap({ text: "Final text", final: true }));
const clobbered = mergeCaption(settled, cap({ text: "fina", final: false }));
ok(clobbered[0].text === "Final text",
  "a late draft never overwrites a line already settled — a caption that un-says itself is worse than a wrong one");

ok(mergeCaption([], cap({ text: "   " })).length === 0, "whitespace is not a caption");
ok(mergeCaption([], cap({ text: "x", id: "" })).length === 0, "a caption with no id is dropped, not appended forever");
ok(mergeCaption([], null).length === 0, "and a malformed packet never throws in the middle of a meeting");

// The list is bounded. A three-hour meeting must not become a memory leak on
// the laptop of the person who needed the captions most.
let big = [];
for (let i = 0; i < 500; i++) big = mergeCaption(big, cap({ id: `x${i}`, text: `line ${i}`, final: true }), 300);
ok(big.length === 300, "the log is capped");
ok(big[big.length - 1].text === "line 499", "…keeping the NEWEST, which is the part being read");

// ── a draft nobody finished ───────────────────────────────────────────────
// A browser that stops recognising mid-sentence leaves a half-line frozen on
// everyone's screen, which reads as "they are still talking".
const mixed = [
  cap({ id: "old", text: "half a sen", final: false, at: 0 }),
  cap({ id: "keep", text: "A finished line.", final: true, at: 0 }),
];
const pruned = pruneStale(mixed, INTERIM_TTL_MS + 1);
ok(pruned.length === 1 && pruned[0].id === "keep",
  "an unfinished draft ages out; a finished line never does");
ok(pruneStale(mixed, 100).length === 2, "…but not before it has had a chance to finish");
ok(pruneStale(mixed, 100) === mixed,
  "and with nothing to prune the same array comes back — no needless re-render mid-sentence");

// ── what is on screen ─────────────────────────────────────────────────────
const many = Array.from({ length: 10 }, (_, i) => cap({ id: `n${i}`, text: `line ${i}`, final: true }));
ok(visible(many, 3).map((c) => c.text).join("|") === "line 7|line 8|line 9",
  "the bar shows the last three, oldest first — reading order, not newest-first");
ok(visible([], 3).length === 0, "an empty meeting shows an empty bar, not a crash");

ok(stamp(0) === "00:00" && stamp(62000) === "01:02" && stamp(3723000) === "1:02:03",
  "the caption clock reads the way a person reads a clock");

// ── the log is a transcript ───────────────────────────────────────────────
// A meeting captioned live but never transcribed still HAS all its words.
const log = [
  cap({ id: "1", who: "Santosh", text: "We should move to Stripe.", final: true, at: 52000 }),
  cap({ id: "2", who: "Kiran", text: "I'll do the integration.", final: true, at: 61000 }),
  cap({ id: "3", who: "Santosh", text: "still typ", final: false, at: 70000 }),
];
const tr = toTranscript(log);
ok(tr.includes("[52s] Santosh: We should move to Stripe."),
  "the caption log becomes a transcript in the shape the notes already read");
ok(!tr.includes("still typ"),
  "…with the unfinished drafts left out — a half-word is not something anybody said");
ok(finals(log).length === 2, "only settled lines count as the record");

const utts = toUtterances(log);
ok(utts.length === 2 && utts[0].start === 52, "and as timed lines a citation can point at");
ok(utts[0].speaker === 0 && utts[1].speaker === 1,
  "each distinct person gets their own speaker index");
ok(toUtterances([...log, cap({ id: "4", who: "Santosh", text: "Back to me.", final: true, at: 80000 })])[2].speaker === 0,
  "…and the same person keeps theirs — attribution is a fact here, not a guess");
ok(toTranscript([]) === "", "a meeting nobody captioned yields nothing, not an empty header");

// ── which engine, and telling the truth about it ──────────────────────────
ok(pickEngine(true, true) === "deepgram",
  "with a key we use the accurate path — it works in every browser and agrees with the saved transcript");
ok(pickEngine(false, true) === "browser", "without one, the browser's own recogniser still gives captions");
ok(pickEngine(false, false) === "none", "and with neither, we say so rather than pretending");

ok(/sent to Google/.test(engineNote("browser")),
  "the browser path SAYS the audio goes to Google — captions that quietly ship your microphone somewhere are a decision made on your behalf");
ok(/Nothing is sent by Quantlys/.test(engineNote("browser")),
  "…and is equally clear about what we do not do");
ok(/Deepgram/.test(engineNote("deepgram")), "the Deepgram path names Deepgram");
ok(/sent there/.test(engineNote("deepgram")), "…and is just as plain about where the audio goes");
ok(/Firefox/.test(engineNote("none")),
  "and the unavailable case names the actual reason instead of shrugging");
ok(/still transcribed afterwards/.test(engineNote("none")),
  "…and points at what DOES still work, so it doesn't read as total failure");

ok(toggleLabel("none", false) === "Captions unavailable",
  "a control that cannot work says so BEFORE it is pressed");
ok(toggleLabel("browser", true) === "Captions on", "and reflects its own state when it can");

ok(CC_TOPIC === "qm-cc", "the data-channel topic is pinned — changing it silently splits a meeting in two");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
