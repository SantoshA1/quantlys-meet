/**
 * MAYA GUARD — Memory episodes / chapters + audio clip plan for writers & podcasters.
 *
 * Run: node lib/memory-chapters.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  parseClock, formatClock, acceptChapterOrder, memoryChaptersPath,
  episodesFromSummaries, applyEpisodeOrder, preferMemoryEpisodes,
  chapterBoundaryClips, quoteClips, episodeAudioClip, buildClipPlan,
  encodeWavPCM, slicePcm, slugClipLabel, MEMORY_CLIP_FORMAT_NOTE,
} from "./memory-chapters.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(parseClock("02:10") === 130 && parseClock("1:02:03") === 3723, "mm:ss and h:mm:ss parse");
ok(parseClock("90s") === 90 && parseClock(90) === 90 && parseClock("90") === 90, "seconds forms parse");
ok(parseClock("") === null && parseClock("nope") === null && parseClock("99:99") === null,
  "bad clocks are null — never invent a cut");
ok(formatClock(130) === "02:10", "formatClock round-trips mm:ss");

ok(acceptChapterOrder(["a/b/c.json", "a/b/c.json", "../x", "/abs", ""]).length === 1,
  "order accepts unique relative paths only");
ok(memoryChaptersPath("u1", "Dad Stories") === "u1/memory/dad-stories.chapters.json",
  "chapter order lives beside the Memory package");

const raw = [
  { path: "u/r2/b.summary.json", title: "Later", room: "r2", at: "2026-09-02", sessionMode: "memory", audioPath: "u/r2/b.m4a", durationSec: 200 },
  { path: "u/r1/a.summary.json", title: "Earlier", room: "r1", at: "2026-09-01", sessionMode: "memory", audioPath: "u/r1/a.m4a", durationSec: 100 },
  { path: "u/r3/c.summary.json", title: "Meeting leftover", room: "r3", at: "2026-09-03", sessionMode: "meeting", audioPath: null },
];
const eps = episodesFromSummaries(raw);
ok(eps[0].title === "Earlier" && eps[1].title === "Later", "default order is chronological");
ok(eps.every((e, i) => e.order === i), "order indices are dense");

const reordered = applyEpisodeOrder(eps, ["u/r2/b.summary.json", "u/r1/a.summary.json"]);
ok(reordered[0].id.endsWith("b.summary.json") && reordered[1].id.endsWith("a.summary.json"),
  "saved order wins over chronology");

const pref = preferMemoryEpisodes(eps);
ok(pref.episodes.length === 2 && !pref.usedFallback, "prefer Memory-tagged episodes");
const pref2 = preferMemoryEpisodes(eps.filter((e) => e.sessionMode === "meeting"));
ok(pref2.usedFallback && pref2.episodes.length === 1, "fallback when nothing tagged Memory");

const ch = chapterBoundaryClips({
  chapters: [
    { heading: "Cold open", at: "00:00", body: "hook" },
    { heading: "Act two", at: "01:30", body: "middle" },
    { heading: "No clock", body: "orphan" },
  ],
  audioPath: "u/r1/a.m4a",
  sourcePath: "u/r1/a.summary.json",
  durationSec: 200,
});
ok(ch[0].ready && ch[0].startSec === 0 && ch[0].endSec === 90, "chapter clip ends at next cue");
ok(ch[1].ready && ch[1].startSec === 90 && ch[1].endSec === 200, "last timed chapter uses duration");
ok(!ch[2].ready && /timestamp|mm:ss/i.test(ch[2].limit || ""), "untimed chapter is listed, not cut");

const quotes = quoteClips({
  quotes: ["Keep the dial where it is.", "Never said this exact line anywhere"],
  utterances: [
    { start: 10, transcript: "She said keep the dial where it is and walked out." },
    { start: 40, transcript: "We moved the next spring." },
  ],
  audioPath: "u/r1/a.m4a",
  durationSec: 100,
});
ok(quotes[0].ready && quotes[0].startSec < 10 && quotes[0].endSec > 10,
  "quote match pads around the utterance");
ok(!quotes[1].ready && /could not find|transcript/i.test(quotes[1].limit || ""),
  "unmatched quote stays honest");

const noUtt = quoteClips({
  quotes: ["Something memorable someone said aloud"],
  utterances: [],
  audioPath: "u/r1/a.m4a",
});
ok(!noUtt[0].ready && /timed transcript|timestamps/i.test(noUtt[0].limit || ""),
  "missing utterances document the V1 limit");

const epClip = episodeAudioClip(eps[0]);
ok(epClip.ready && epClip.kind === "episode" && epClip.audioPath, "full episode audio is a ready clip");

const plan = buildClipPlan({
  episodes: preferMemoryEpisodes(eps).episodes,
  packageChapters: [{ heading: "Cold open", at: "00:05", body: "x" }],
  packageQuotes: ["Keep the dial where it is."],
  utterancesByPath: {
    "u/r2/b.summary.json": [{ start: 12, transcript: "Keep the dial where it is." }],
  },
  focusEpisodeId: "u/r2/b.summary.json",
});
ok(plan.clips.filter((c) => c.kind === "episode").length === 2, "plan includes each episode audio");
ok(plan.clips.some((c) => c.kind === "chapter" && c.ready), "focused episode gets chapter cuts");
ok(plan.clips.some((c) => c.kind === "quote" && c.ready), "focused episode gets quote cuts");

const pcm = [new Float32Array([0, 0.5, -0.5, 1, 0])];
const sliced = slicePcm(pcm, 10, 0.1, 0.3);
ok(sliced[0].length === 2, "slicePcm cuts by sample rate");
const wav = encodeWavPCM(sliced, 10);
ok(wav.byteLength === 44 + 2 * 2 && String.fromCharCode(...new Uint8Array(wav.slice(0, 4))) === "RIFF",
  "encodeWavPCM writes a RIFF header + 16-bit samples");
ok(/WAV|m4a|webm/i.test(MEMORY_CLIP_FORMAT_NOTE), "format note names stack formats");
ok(slugClipLabel("Act Two!!!") === "act-two", "clip filenames are slug-safe");

const routeCh = code("../app/api/memory/chapters/route.ts");
ok(/export async function GET/.test(routeCh) && /export async function POST/.test(routeCh),
  "chapters API lists + saves order");
ok(/memoryChaptersPath|episodesFromSummaries|acceptChapterOrder/.test(routeCh),
  "chapters API uses the helpers");

const routeCl = code("../app/api/memory/clips/route.ts");
ok(/export async function POST/.test(routeCl) && /buildClipPlan|createSignedUrl/.test(routeCl),
  "clips API returns a plan with signed audio URLs");

const memRoute = code("../app/api/memory/route.ts");
ok(/chapterPath|episodeId|focus/.test(memRoute),
  "Memory build accepts a single-chapter / episode target");

const host = code("../app/host/Memory.tsx");
ok(/Download clips|chapter|episode|reorder|Move up|Move down/i.test(host),
  "host Memory panel lists chapters and offers clip download");
ok(/encodeWavPCM|slicePcm|AudioContext|decodeAudioData/i.test(host),
  "host cuts clips in the browser to WAV");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
