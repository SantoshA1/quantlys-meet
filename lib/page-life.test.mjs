/**
 * A locked iPhone mutes a meeting page's microphone (WebKit, iOS — a platform
 * limit). These are the parts that are ours: what comes back on unlock.
 *
 * Run: node --experimental-strip-types lib/page-life.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  isAppleMobile, needsResume, keepAudioAlive, resumeAudioContexts, awayLabel, AWAY_ATTR, AWAY_LOCKED,
  holdAfterReturn, RETURN_HOLD_MS, elapsedSeconds, closeGap, gapLine, GAP_MIN_S,
  dgReconnectDelay, DG_MAX_RECONNECTS, createWakeLock,
} from "./page-life.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// ── who gets the iPhone behaviour ─────────────────────────────────────────
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
ok(isAppleMobile({ ua: IPHONE, maxTouchPoints: 5 }), "an iPhone is an iPhone");
ok(isAppleMobile({ ua: IPADOS, maxTouchPoints: 5 }), "iPadOS asks for the desktop site and still counts — touch points are the tell");
ok(!isAppleMobile({ ua: IPADOS, maxTouchPoints: 0 }), "NEGATIVE CONTROL: a real Mac is not told its screen lock mutes it");
ok(!isAppleMobile({ ua: CHROME_WIN, maxTouchPoints: 10 }), "a Windows touch laptop is not an iPhone");

// ── AudioContexts come back from every non-running state ──────────────────
ok(needsResume("interrupted"), "THE BUG: 'interrupted' (iOS after a lock) needs a resume — the old checks only knew 'suspended'");
ok(needsResume("suspended"), "'suspended' still does");
ok(!needsResume("running") && !needsResume("closed") && !needsResume(undefined), "running, closed and absent are left alone");

const mk = (state) => { const c = { state, asked: 0, resume() { this.asked++; this.state = "running"; return Promise.resolve(); } }; return c; };
const a = mk("interrupted"), b = mk("running"), c = mk("suspended"), d = mk("closed");
const offs = [a, b, c, d].map((x) => keepAudioAlive(x));
ok(resumeAudioContexts() === 2 && a.asked === 1 && c.asked === 1 && b.asked === 0 && d.asked === 0,
  "on return every registered context that is not running is resumed — the recording mix, the relay and the meter alike");
offs.forEach((f) => f());
const e = mk("interrupted");
keepAudioAlive(e)();
ok(resumeAudioContexts() === 0 && e.asked === 0, "an unregistered (closed by its owner) context is not touched");
ok(typeof keepAudioAlive(null) === "function", "registering nothing is harmless");

// ── what the room sees ────────────────────────────────────────────────────
ok(awayLabel({ [AWAY_ATTR]: AWAY_LOCKED }) === "paused, phone locked", "the attribute reads as words on the stage");
ok(awayLabel({ [AWAY_ATTR]: "" }) === "" && awayLabel({}) === "" && awayLabel(undefined) === "", "cleared, absent or no attributes: no tag");

// ── the supervisor waits for LiveKit's own re-acquire ─────────────────────
ok(RETURN_HOLD_MS >= 1500 && RETURN_HOLD_MS <= 3000, "about two seconds of patience after a return");
ok(holdAfterReturn(10_000, 10_500), "half a second after the page came back: hands off the microphone");
ok(!holdAfterReturn(10_000, 10_000 + RETURN_HOLD_MS), "after the hold the supervisor judges again");
ok(!holdAfterReturn(0, 999_999), "a page that never hid is never held");

// ── the recording's clock and its holes ───────────────────────────────────
ok(elapsedSeconds(1_000, 1_000 + 95_400) === 95, "elapsed is wall-clock seconds since the take started");
ok(elapsedSeconds(1_000, 1_000 + 600_000) === 600,
  "THE BUG: a ten-minute take with nine minutes locked still says ten minutes — tick-counting said one");
ok(elapsedSeconds(0, 5_000) === 0 && elapsedSeconds(5_000, 4_000) === 0, "no start or a clock running backwards is zero, not negative");
ok(closeGap(60, 60 + GAP_MIN_S - 1) === null, "an app-switch blink is not a hole in the record");
const g = closeGap(65, 190);
ok(g && g.from === 65 && g.to === 190, "a locked minute is");
ok(closeGap(-1, 500) === null, "no hide, no gap");
const line = gapLine({ from: 65, to: 190 });
ok(line.start === 65 && line.speaker === -1 && /01:05–03:10/.test(line.transcript) && /locked/.test(line.transcript),
  "the gap is a timed line in the record, shaped like a flagged moment, so the notes name the hole");

// ── Deepgram reconnects instead of giving up for good ─────────────────────
ok(dgReconnectDelay(0) < 500, "the first reconnect is quick — somebody may be mid-sentence");
ok(dgReconnectDelay(1) > dgReconnectDelay(0) && dgReconnectDelay(99) === dgReconnectDelay(DG_MAX_RECONNECTS - 1),
  "then slower, and capped");
ok(DG_MAX_RECONNECTS >= 3 && DG_MAX_RECONNECTS <= 6, "a handful of tries before the browser recogniser takes over");

// ── the wake lock ─────────────────────────────────────────────────────────
{
  const none = createWakeLock({});
  ok(!none.supported() && (await none.request()) === false, "no Wake Lock API: nothing happens, nothing throws");
  await none.release();
  let reqs = 0, released = 0;
  const nav = { wakeLock: { request: async () => { reqs++; const s = { released: false, async release() { released++; s.released = true; } }; return s; } } };
  const wl = createWakeLock(nav);
  ok(wl.supported() && (await wl.request()) === true && wl.held(), "supported: the screen is held awake");
  await wl.request();
  ok(reqs === 1, "asking again while held does not stack locks");
  await wl.release();
  ok(released === 1 && !wl.held(), "leaving releases it");
  const refuse = createWakeLock({ wakeLock: { request: async () => { throw new Error("NotAllowedError"); } } });
  ok((await refuse.request()) === false && !refuse.held(), "a refusal (hidden page, low battery) is swallowed and retried on the next return");
}

// ── the wiring ────────────────────────────────────────────────────────────
const conf = code("../app/room/[room]/Conference.tsx");
const guard = code("../app/room/[room]/MediaGuard.tsx");
const check = code("../app/room/[room]/DeviceCheck.tsx");
ok(/sock\.onclose = \(\) =>/.test(conf) && /reconnect\(\)/.test(conf) && /captionToken\(\)/.test(conf),
  "Deepgram's socket closing reconnects with a FRESH key");
ok(!/ws\.onerror = \(\) => \{[\s\S]{0,400}setEngine\("browser"\)/.test(conf),
  "NEGATIVE CONTROL: one socket error no longer switches engines for the rest of the meeting");
ok(/TrackEvent\.Restarted/.test(conf) && /subscribePageLife\(\{ onShow: again \}\)/.test(conf),
  "captions restart on the live microphone when the page returns or the microphone is restarted");
ok(/needsResume\(m\.ac\.state\)/.test(conf) && /keepAudioAlive\(ac\)/.test(conf),
  "the recording mix resumes its context on every sync");
ok(/needsResume\(ac\.state\)\) \{ ac\.resume\(\)/.test(conf), "the relay resumes its context before measuring");
ok(/elapsedSeconds\(takeStartedAt\.current, Date\.now\(\)\)/.test(conf) && !/setElapsed\(\(s\) => \{\s*const n = s \+ 1/.test(conf),
  "the recording clock is wall-clock; NEGATIVE CONTROL: the tick counter is gone");
ok((conf.match(/recGaps\.current\.map\(gapLine\)/g) || []).length === 2, "gaps go in BOTH the browser copy's notes and the finish body");
ok(/AWAY_ATTR\]: v/.test(conf) && /ParticipantAttributesChanged/.test(conf), "the away attribute is set, and the stage listens for it");
ok(/createWakeLock\(/.test(conf) && /lock\.release\(\)/.test(conf), "the wake lock is taken in the room and released on leave");
ok(/needsResume\(ac\.state\)/.test(guard) && /holdAfterReturn\(visibleSince\.current/.test(guard),
  "MediaGuard resumes an interrupted meter and holds its restart after a return");
ok(!/ac\.state === "suspended"/.test(guard), "NEGATIVE CONTROL: no 'suspended'-only check left in MediaGuard");
ok(/LOCK_NOTICE/.test(check), "the device check tells an iPhone user before they join");
for (const r of ["../app/api/room/token/route.ts", "../app/api/livekit/token/route.ts", "../app/api/room/knock/route.ts", "../app/api/host/admit/route.ts"]) {
  ok(/canUpdateOwnMetadata: true/.test(code(r)), `${r.split("/app/")[1]} lets the page set its own away tag`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
