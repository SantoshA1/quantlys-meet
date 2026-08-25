/**
 * MAYA GUARD — is the meeting connected, and what may the app say about
 * devices while it is not?
 *
 * Maya asks: "It told me my microphone wasn't being sent and my camera
 * couldn't start, so I unplugged my headset and restarted Chrome. Then I
 * looked up and it said the meeting had disconnected. Why did it blame my
 * equipment?"
 *
 * FIELD 2026-08-25. One screenshot, four messages, at the same instant:
 *
 *     Disconnected
 *     LINK EXCELLENT
 *     No microphone is being sent
 *     Your camera isn't being sent
 *     Your camera couldn't be started (Error).
 *
 * Reported as "mic/bluetooth keep getting disconnected, people cannot hear —
 * feels like latency, and others do not have the same problem". That reading
 * was right. The connection dropped; nothing else did. Three of those four
 * messages were the app blaming hardware for a network event, and the fourth
 * was a stale value from before the drop.
 *
 * Run: node lib/link.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  linkVerdict, chipLabel, isConnected, trustDevices, REJOIN_GRACE_MS, STUCK_MS,
} from "./link.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. THE SCREENSHOT. Every row here is one message from that frame ──────
const dropped = linkVerdict({ state: "disconnected", quality: "excellent", rttMs: 42, inStateMs: 3000 });
ok(!/EXCELLENT/.test(chipLabel(dropped, 42)),
  "THE BUG, first half: a disconnected room can never read EXCELLENT. connectionQuality KEEPS its last value when the room goes away — the event that would update it only fires while connected — so the chip reported an excellent link to a meeting the person had already dropped out of");
ok(chipLabel(dropped, 42) === "LINK OFFLINE", "…it says OFFLINE, and drops the round-trip number, which is also stale");
ok(dropped.bars === 0 && dropped.level === "dead", "and it looks wrong, not just reads wrong");

ok(dropped.trustDevices === false,
  "THE BUG, second half: while the room is down the app may not judge a device. Every local publication goes with the connection, so 'no microphone publication' means nothing about the microphone");
ok(/not the problem/i.test(dropped.detail),
  "…and it SAYS the equipment is fine. Somebody unplugged a working headset because of that screenshot — this sentence is the one that stops the next person doing it");
ok(/rejoin/i.test(dropped.detail) && dropped.action === "rejoin", "and offers the thing that actually works");

// ── 2. reconnecting is a different state from gone ───────────────────────
const blip = linkVerdict({ state: "reconnecting", quality: "excellent", rttMs: 42, inStateMs: 2000 });
ok(blip.word === "RECONNECTING" && blip.action === "wait",
  "a two-second blip says reconnecting and asks for nothing — LiveKit gets itself back most of the time");
ok(/don't change them|not the problem/i.test(blip.detail),
  "…and still tells them not to touch their microphone, which is the instinct it has to beat");
ok(blip.trustDevices === false, "…and still no device verdicts");
const stuck = linkVerdict({ state: "reconnecting", inStateMs: STUCK_MS });
ok(stuck.action === "rejoin",
  `a drop lasting ${STUCK_MS / 1000}s has stopped being a blip, and the person is told it might not fix itself`);
ok(linkVerdict({ state: "signalReconnecting", inStateMs: 500 }).trustDevices === false,
  "livekit's signal-only reconnect counts too — the room is not whole");

// ── 3. coming back is not the same as being back ─────────────────────────
ok(isConnected("connected") && !isConnected("reconnecting") && !isConnected(""), "connected means connected");
ok(trustDevices("connected", REJOIN_GRACE_MS - 1) === false,
  `THE REPUBLISH WINDOW: for ${REJOIN_GRACE_MS / 1000}s after the room says it is back, devices are STILL not judged. LiveKit republishes tracks asynchronously, and a watchdog firing into that gap blames the microphone for something the reconnect is already fixing`);
ok(trustDevices("connected", REJOIN_GRACE_MS) === true, "…and after it, they are");
ok(trustDevices("reconnecting", 999999) === false, "NEGATIVE CONTROL: no amount of time makes a reconnecting room trustworthy");

// ── 4. connected: now the quality word means something ───────────────────
const good = linkVerdict({ state: "connected", quality: "excellent", rttMs: 42, sinceConnectedMs: 60000 });
ok(chipLabel(good, 42) === "LINK EXCELLENT · 42 MS", "a healthy meeting reads exactly as it did before");
ok(good.title === "" && good.trustDevices === true, "…with no banner, and the device watchdogs armed");
const poor = linkVerdict({ state: "connected", quality: "poor", rttMs: 310, sinceConnectedMs: 60000 });
ok(poor.level === "warn" && /camera off/i.test(poor.detail),
  "a poor connection names the fix that actually helps: video is what starves the audio");
ok(poor.trustDevices === true,
  "…but a poor connection is still a CONNECTED one, so a genuinely dead microphone is still caught. NEGATIVE CONTROL for over-correcting this fix into silence");
ok(chipLabel(linkVerdict({ state: "connecting" })) === "LINK CHECKING",
  "and before the first connection it says it is checking rather than guessing");

// ── 5. the wiring, which is where the bug actually lived ─────────────────
const guard = readFileSync(new URL("../app/room/[room]/MediaGuard.tsx", import.meta.url), "utf8");
const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");

ok(/const canJudgeDevices = useCallback/.test(guard) && (guard.match(/canJudgeDevices\(\)/g) || []).length >= 2,
  "both supervisors ask permission before saying anything about a device");
ok(/if \(!isConnected\(roomState\.current\)\) return;/.test(guard) &&
   (guard.match(/isConnected\(roomState\.current\)/g) || []).length >= 3,
  "and the recoveries refuse outright — you cannot publish into a room you are not in, so trying throws, renders as a device error, and races the reconnect that was about to fix it");
ok(/RoomEvent\.ConnectionStateChanged/.test(guard),
  "the guard subscribes to the room's own state. NEGATIVE CONTROL for what shipped before: nothing in the entire room consulted it — grep for RoomEvent.Disconnected returned nothing at all");
ok(/linkVerdict\(\{/.test(conf) && !/q === "excellent" \? "EXCELLENT"/.test(conf),
  "the chip is computed from the room's state, not from a quality value that outlives the connection");
ok(/qmr-link/.test(conf) && /Rejoin/.test(conf), "and there is one banner that says what really happened, with the action that works");

// ── 6. the two settings this report was actually about ───────────────────
ok(/dtx: false/.test(conf),
  "DTX OFF: it stops sending during silence, and what that costs is the first syllable of the next word — every time somebody answers a question, which is the exact shape of 'sometimes people cannot hear me'");
ok(/adaptiveStream: true/.test(conf) && /dynacast: true/.test(conf),
  "adaptiveStream and dynacast are on: video nobody is looking at stops being decoded and stops being published. Video decode is what starves the audio thread on a laptop already struggling");
ok(/red: true/.test(conf), "NEGATIVE CONTROL: RED stays on — that one genuinely buys intelligibility on a lossy link");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
