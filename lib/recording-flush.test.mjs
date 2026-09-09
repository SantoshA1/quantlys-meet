/**
 * Recordings must not finalize on tab hide or a second-tab meeting.
 *
 * pagehide used to call MediaRecorder.stop() unconditionally, so switching
 * tabs or opening another room cut a standup at ~55s. Flush only on a real
 * document discard. Stop / Leave / End still flush. Duration rides the summary.
 *
 * Run: node lib/recording-flush.test.mjs
 */
import { readFileSync } from "node:fs";
import { shouldFlushOnPageHide, durationSecondsFromSummary } from "./recording-flush.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(!shouldFlushOnPageHide({ persisted: true, visibilityState: "hidden", unloadStarted: true }),
  "bfcache (persisted) does not flush");
ok(!shouldFlushOnPageHide({ persisted: false, visibilityState: "visible", unloadStarted: true }),
  "visible page does not flush");
ok(!shouldFlushOnPageHide({ persisted: false, visibilityState: "hidden", unloadStarted: false }),
  "pagehide without beforeunload (tab hide / second tab) does not flush");
ok(!shouldFlushOnPageHide({ visibilityState: "hidden" }),
  "hidden alone does not flush");
ok(shouldFlushOnPageHide({ persisted: false, visibilityState: "hidden", unloadStarted: true }),
  "discarding unload (hidden, not persisted, beforeunload ran) flushes");

ok(durationSecondsFromSummary({ duration_s: 55 }) === 55, "reads duration_s");
ok(durationSecondsFromSummary({ duration: 90.8 }) === 90, "reads duration seconds and floors");
ok(durationSecondsFromSummary({ duration_s: 0 }) === 0, "zero is a real length");
ok(durationSecondsFromSummary({}) === null, "missing duration stays null");
ok(durationSecondsFromSummary({ duration_s: -3 }) === null, "negative duration is ignored");
ok(durationSecondsFromSummary(null) === null, "non-object summary is ignored");

const conference = code("../app/room/[room]/Conference.tsx");
const finish = code("../app/api/recording/finish/route.ts");
const history = code("../app/meetings/page.tsx");

ok(/shouldFlushOnPageHide/.test(conference),
  "Conference gates pagehide through shouldFlushOnPageHide");
ok(!/const onHide = \(\) => \{ recStop\(\); \}/.test(conference),
  "bare pagehide no longer stops the recorder");
ok(!/addEventListener\("visibilitychange"/.test(conference),
  "visibilitychange to hidden does not stop recording");
ok(/await flushRecording\(\)/.test(conference),
  "Leave still flushes");
ok(/control\("end"\)/.test(conference),
  "End this session still ends after a flush");
ok(/duration_s:/.test(conference),
  "finish body includes on-screen duration_s");
ok(/duration_s/.test(finish),
  "finish API stores duration_s on the summary");
ok(/durationSecondsFromSummary/.test(history),
  "meeting history reads duration from the summary");

console.log(fail ? `\n${fail} failed` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
