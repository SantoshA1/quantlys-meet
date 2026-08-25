/**
 * MAYA GUARD — the right name on the right voice.
 *
 * Maya asks: "Everyone typed their name to get in. Why do the notes say
 * Speaker 1 and Speaker 2?"
 *
 * FIELD 2026-08-25: "users names are missing, instead shows sometimes Speaker.
 * The speaker names should pick from the name the user entered when joining
 * the meeting and map to while they are talking."
 *
 * The app HAD the names the whole time. The recording is one MIXED audio
 * track, so Deepgram can only say "these stretches are the same voice" —
 * speaker 0, speaker 1. The captions carry the real name on every line. And
 * the captions were used ONLY when Deepgram produced nothing, so the better
 * the transcription worked, the more certainly the names were lost.
 *
 * Run: node lib/speakers.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  estimateOffset, nameSpeakers, speakerLabel, speakerList, namingNote,
  NAME_CONFIDENCE, MIN_OVERLAP_S,
} from "./speakers.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const DG = [
  { start: 100, end: 104, speaker: 0, transcript: "so the finance team uploads a photo of the receipt" },
  { start: 105, end: 109, speaker: 1, transcript: "right and it files itself against the expense code" },
  { start: 110, end: 114, speaker: 0, transcript: "what happens when the photo is unreadable though" },
];
// Captions started 90 seconds AFTER the recording did.
const CAPS = [
  { start: 10, end: 14, who: "Kiran", transcript: "so the finance team uploads a photo of the receipt" },
  { start: 15, end: 19, who: "Raghu", transcript: "right and it files itself against the expense code" },
  { start: 20, end: 24, who: "Kiran", transcript: "what happens when the photo is unreadable though" },
];

// ── 1. the clocks do not share an origin ─────────────────────────────────
ok(estimateOffset(DG, CAPS) === 90,
  "THE TRAP THIS WHOLE IDEA WALKS INTO: a caption's clock starts when CAPTIONS were switched on, a Deepgram utterance's when RECORDING began. Here that is 90 seconds apart, and it is measured from the text rather than assumed");
ok(estimateOffset(DG, []) === null && estimateOffset([], CAPS) === null,
  "no captions, no offset — and a null offset means no names, which is the correct answer");
ok(estimateOffset(DG, [{ start: 1, who: "X", transcript: "totally different words entirely here" }]) === null,
  "NEGATIVE CONTROL: two recordings with nothing in common produce NO offset rather than a confident wrong one");
ok(estimateOffset(
     [{ start: 5, speaker: 0, transcript: "yes" }],
     [{ start: 1, who: "K", transcript: "yes" }]) === null,
  "…and short phrases are ignored, because 'yes' and 'okay' match everything and would anchor the clock to noise");

// ── 2. the map ───────────────────────────────────────────────────────────
const map = nameSpeakers(DG, CAPS, estimateOffset(DG, CAPS));
ok(map[0] === "Kiran" && map[1] === "Raghu",
  "every diarised voice gets the name of the person the captions say was actually talking then");
ok(Object.keys(nameSpeakers(DG, CAPS, null)).length === 0,
  "NEGATIVE CONTROL: without an offset it maps NOTHING. Overlapping two unaligned clocks is how you name every voice after whoever spoke ten minutes earlier");

// Two people talking over each other for the whole utterance.
const crosstalk = nameSpeakers(
  [{ start: 0, end: 10, speaker: 0, transcript: "a long stretch of overlapping conversation here" }],
  [{ start: 0, end: 5, who: "Kiran", transcript: "x" }, { start: 5, end: 10, who: "Raghu", transcript: "y" }],
  0);
ok(crosstalk[0] === undefined,
  `a 50/50 split names nobody — the bar is ${NAME_CONFIDENCE * 100}%. A confidently wrong name puts words in somebody's mouth, which is the one outcome worse than a number`);
const clear = nameSpeakers(
  [{ start: 0, end: 10, speaker: 0, transcript: "a long stretch of mostly one person talking" }],
  [{ start: 0, end: 9, who: "Kiran", transcript: "x" }, { start: 9, end: 10, who: "Raghu", transcript: "y" }],
  0);
ok(clear[0] === "Kiran", "…but a clear majority is named");
ok(nameSpeakers([{ start: 0, end: 1, speaker: 0 }], [{ start: 0, end: 1, who: "K", transcript: "x" }], 0)[0] === undefined,
  `and under ${MIN_OVERLAP_S}s of overlap is coincidence, not evidence`);

// ── 3. the label a person actually reads ─────────────────────────────────
ok(speakerLabel(0, map) === "Kiran" && speakerLabel(1, map) === "Raghu", "the map wins");
ok(speakerLabel(0, {}, ["Kiran", "Raghu"]) === "Speaker 1",
  "NEGATIVE CONTROL, and the bug that fed 'ask this meeting a question': with two people it must NOT pick roster[0]. Deepgram's speaker 0 is whichever voice it clustered first — unrelated to who joined first");
ok(speakerLabel(0, {}, ["Kiran"]) === "Kiran",
  "…but a meeting with exactly one person in it has exactly one possible voice, and that one IS resolved");
ok(speakerLabel(undefined, {}, ["Kiran", "Raghu"]) === "Someone", "an utterance with no voice at all is Someone");
ok(speakerList(DG, map, ["Kiran", "Raghu"]).join(", ") === "Kiran, Raghu",
  "the notes list real people at the top, which is the line they complained about");
ok(speakerList(DG, {}, ["Kiran", "Raghu"]).join(", ") === "Speaker 1, Speaker 2",
  "NEGATIVE CONTROL: unmatched voices stay numbered rather than being dressed up");

// ── 4. and it SAYS why, when it could not ────────────────────────────────
ok(/all 2/.test(namingNote({ speakers: 2, named: 2, hadCaptions: true, aligned: true })), "a clean match says so");
ok(/captions on during the meeting/.test(namingNote({ speakers: 2, named: 0, hadCaptions: false, aligned: false })),
  "no captions explains the ONE thing that would have fixed it — a person seeing 'Speaker 2' deserves to know why rather than assuming the app is broken");
ok(/switched on well after/.test(namingNote({ speakers: 2, named: 0, hadCaptions: true, aligned: false })),
  "…and a failed alignment is a different sentence, because it has a different cause");
ok(/talking at those moments/.test(namingNote({ speakers: 3, named: 2, hadCaptions: true, aligned: true })),
  "…and a partial match names the reason: people talked over each other");
ok(namingNote({ speakers: 0, named: 0, hadCaptions: false, aligned: false }) === "",
  "a recording with nobody in it says nothing");

// ── 5. the wiring ────────────────────────────────────────────────────────
const fin = readFileSync(new URL("../app/api/recording/finish/route.ts", import.meta.url), "utf8");
ok(!/function speakerName/.test(fin) && !/Speaker \$\{u\?\.speaker \+ 1\}/.test(fin),
  "the function that turned every voice into a number is gone");
ok(/nameSpeakers\(utts, capsForNames, offset\)/.test(fin), "the map is built from the captions and the recording together");
ok(/who: speakerLabel\(u\?\.speaker, speakerMap, roster\)/.test(fin),
  "…and the NAME travels on every timed line. Without this the sidecar a person downloads is back to numbers however well the map did");
ok(/who: String\(l\.who \|\| ""\)/.test(fin),
  "the caption-only fallback keeps its names too — it had them in its hand and was dropping them");
ok(/notes\.speakers = speakerList\(/.test(fin), "and the list at the top of the notes is real people");
ok(/say\("names", "Put names to the voices"/.test(fin), "the recording report says how the naming went");

// Comment lines stripped first — the fix is DESCRIBED in a comment right above
// the code it replaced, and a guard that matches its own post-mortem is a
// guard that fails while the code is correct.
const notesSrc = readFileSync(new URL("./notes.ts", import.meta.url), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
ok(!/names\[i\]/.test(notesSrc),
  "THE MISATTRIBUTION IS GONE: timedTranscript indexed the roster by the diarisation number, so it confidently put one person's name on another person's words — in the transcript that answers 'ask this meeting a question' with a named citation");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
