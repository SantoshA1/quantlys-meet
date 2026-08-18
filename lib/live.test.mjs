/**
 * MAYA GUARD — the meeting writing itself down, live.
 *
 * Maya asks: "The rail said DECISION CAUGHT while Maya was still talking.
 * Is that the same decision the emailed notes will show tonight — or do I
 * now have two versions of what we agreed?"
 *
 * The rules are shared with the finish route BY IMPORT, and the first guard
 * proves the sharing, because 'same rules' as a comment is worth nothing.
 *
 * Run: node lib/live.test.mjs
 */
import { readFileSync } from "node:fs";
import { COMMIT, DECIDE, NOISE, catchLive, caughtCounts, talked, linkLabel, atLabel, flagAt } from "./live.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── one set of rules, provably ───────────────────────────────────────────
const route = readFileSync(new URL("../app/api/recording/finish/route.ts", import.meta.url), "utf8");
ok(/import \{ COMMIT, DECIDE, NOISE \} from "@\/lib\/live"/.test(route),
  "the finish route IMPORTS these rules — the live rail and the emailed notes cannot drift apart");
ok(!/const (COMMIT|DECIDE|NOISE)\s*=/.test(route),
  "…and keeps no private copy that could quietly diverge");

// ── what gets caught ─────────────────────────────────────────────────────
const F = (who, text, at) => ({ who, text, at, final: true });
const finals = [
  F("Sam", "the five-person test needs guest join open", 60_000),
  F("Maya", "fine but it closes again on friday and i want that written down", 90_000),
  F("You", "we decided the partner tier ships at the revised number", 120_000),
  F("Sam", "i'll send the revised pricing sheet to maya by thursday", 150_000),
  F("Maya", "yeah", 152_000),
  F("Maya", "ok", 153_000),
];
const caught = catchLive(finals);
ok(caught.some((c) => c.kind === "decision" && /partner tier/.test(c.text)),
  "a decision somebody actually said is caught as a DECISION");
ok(caught.some((c) => c.kind === "action" && /pricing sheet/.test(c.text) && c.who === "Sam"),
  "a commitment is caught as an ACTION with the person who made it");
ok(!caught.some((c) => c.text === "yeah" || c.text === "ok"),
  "grunts are never promoted — a rail full of 'yeah' teaches people to stop reading it");

// Idempotent: the whole list in, the whole answer out — twice the calls,
// same cards. The rail re-runs this on every caption; drift here would make
// cards flicker in and out.
ok(JSON.stringify(catchLive(finals)) === JSON.stringify(catchLive(finals)),
  "same finals in, same catches out — every time");

// People repeat the decision back. One decision is not two.
const echoed = catchLive([
  F("You", "we decided the partner tier ships at the revised number", 120_000),
  F("Sam", "we decided the partner tier ships at the revised number", 125_000),
]);
ok(echoed.length === 1, "a decision read back verbatim is ONE card, not two");

// Nothing invented: every caught text is verbatim something somebody said.
ok(caught.every((c) => finals.some((f) => f.text === c.text)),
  "every card quotes a sentence from the captions verbatim — the rail can never invent");

const counts = caughtCounts(caught);
ok(counts.decisions >= 1 && counts.actions >= 1 &&
   counts.decisions + counts.actions === caught.length,
  "the CAUGHT SO FAR line adds up to exactly the cards shown");

// ── talked % ─────────────────────────────────────────────────────────────
const t = talked([
  { who: "Maya", text: "one two three four five six seven" },
  { who: "Sam", text: "one two three" },
]);
ok(t["Maya"] === 70 && t["Sam"] === 30, "talked % is a word share, and the shares add to 100");
ok(Object.keys(talked([])).length === 0, "nobody has spoken → no badges, not NaN%");

// ── the link chip ────────────────────────────────────────────────────────
ok(linkLabel("excellent", 42) === "LINK EXCELLENT · 42 MS", "the chip prints like the design when a latency was measured");
ok(linkLabel("excellent") === "LINK EXCELLENT",
  "…and prints NO number when none was measured — 'LINK EXCELLENT · ?' is worse than no number");
ok(linkLabel("poor", 300) === "LINK POOR · 300 MS", "a bad link says so");
ok(linkLabel("") === "" && linkLabel("weird") === "", "an unknown state renders nothing rather than guessing");

// ── the flag's clock — the field bug of 2026-08-18 ───────────────────────
ok(flagAt({ ccOn: true, lastFinalAt: 84_000, recording: true, recElapsedSec: 300 }) === 84_000,
  "with captions running, a flag rides the transcript's own clock");
ok(flagAt({ ccOn: true, lastFinalAt: null, ccElapsedMs: 5_000, recording: false }) === 5_000,
  "captions on but NOTHING SAID YET still flags — time since captions started — this exact case used to silently do nothing");
ok(flagAt({ ccOn: false, recording: true, recElapsedSec: 258 }) === 258_000,
  "recording without captions flags on the recording clock");
ok(flagAt({ ccOn: false, recording: false }) === -1,
  "no captions, no recording → -1, and the button is DISABLED — a flag nobody can find afterwards is worse than no flag");
ok(flagAt({ ccOn: true, lastFinalAt: NaN, ccElapsedMs: NaN, recording: true, recElapsedSec: 10 }) === 10_000,
  "garbage clocks fall through to the next real one instead of stamping NaN");

ok(atLabel(90_000) === "01:30" && atLabel(0) === "00:00", "caught cards stamp mm:ss from the caption clock");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
