/**
 * MAYA GUARD — captions out of the room (.vtt / .srt).
 *
 * Run: node lib/caption-export.test.mjs
 */
import { readFileSync } from "node:fs";
import { toVtt, toSrt, captionCues, acceptCaptionFormat, captionsFile } from "./caption-export.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const lines = [
  { start: 65.25, speaker: 1, who: "Maya", transcript: "Keep the dial where it is." },
  { start: 2, speaker: 0, who: "Speaker 1", transcript: "  We stood in the kitchen. " },
  { speaker: 0, transcript: "no time — skipped" },
  { start: 3600, end: 3603.5, transcript: "An hour in." },
];
const vtt = toVtt(lines);
ok(vtt.startsWith("WEBVTT\n\n"), "VTT header");
ok(/00:00:02\.000 --> 00:00:09\.000\nWe stood in the kitchen\./.test(vtt), "sorted, trimmed, end capped at 7s before next");
ok(/00:01:05\.250 --> /.test(vtt) && /Maya: Keep the dial/.test(vtt), "named voice prefixes the line");
ok(!/Speaker 1:/.test(vtt), "'Speaker N' labels are not printed as names");
ok(!/skipped/.test(vtt), "lines without a time are skipped, never invented");
ok(/01:00:00\.000 --> 01:00:03\.500/.test(vtt), "explicit end kept; hours render");
const srt = toSrt(lines);
ok(/^1\n00:00:02,000 --> /.test(srt) && /,250 --> /.test(srt), "SRT uses comma millis and 1-based cues");
ok(captionCues([]).length === 0 && toVtt([]) === "WEBVTT\n\n", "empty transcript → empty file, no fake cues");
ok(acceptCaptionFormat("SRT") === "srt" && acceptCaptionFormat("x") === "vtt", "format folds to vtt|srt");
ok(captionsFile(lines, "srt") === srt, "captionsFile dispatches");

const route = code("../app/api/memory/media/route.ts");
ok(/kind !== "video" && kind !== "captions"/.test(route) && /loadProjectEpisodes/.test(route),
  "Memory media API serves video + captions only for episodes the user may read");
ok(/episodeVideoCandidates/.test(route) && /createSignedUrl/.test(route), "full video is a signed link to the stored file");
const host = code("../app/host/Memory.tsx");
ok(/Full video/.test(host) && /Captions \.vtt/.test(host) && /\.srt/.test(host), "host Memory panel offers Full video + captions per chapter");
const recs = code("../app/host/Recordings.tsx");
ok(/Captions \.vtt/.test(recs) && /videoQualityLabel/.test(recs), "Recordings offers captions and shows the take's quality");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
