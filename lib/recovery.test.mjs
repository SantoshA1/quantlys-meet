/**
 * MAYA GUARD — the supervisor that must not give up, wedge, or wander.
 *
 * Maya asks: "My headset blipped for one second at 10:04. Why was I silent
 * until I left the meeting and came back in?"
 *
 * FIELD 2026-08-24: "user using windows desktop missing live video and people
 * using bluetooth headsets cannot be heard unless users rejoin back — same
 * thing happening when i host a meeting."
 *
 * Every guard below is a sentence the product now has to keep.
 *
 * Run: node lib/recovery.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  nextDelay, dueForRetry, isStuck, shouldReattach, withTimeout,
  PATIENT_MS, RECOVER_TIMEOUT_MS,
} from "./recovery.ts";
import { retryDelay, shouldKeepTrying, micVerdict, QUIET_MS, FLOOR } from "./media.ts";
import { camVerdict, frameSignature, CAM_FREEZE_MS, CAM_BLACK, CAM_DARK_MS } from "./camera.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. it never gives up ─────────────────────────────────────────────────
ok(nextDelay(0, retryDelay) === 400, "the first retry is immediate-ish, because somebody is mid-sentence");
ok(nextDelay(2, retryDelay) === 4000, "the fast ladder still slows down, so a sick machine is not thrashed");
ok(nextDelay(3, retryDelay) === PATIENT_MS,
  "and when the fast ladder is spent it becomes PATIENT — it does not stop");
ok(nextDelay(99, retryDelay) === PATIENT_MS,
  "…at the hundredth attempt too: a meeting that is 40 minutes long gets 40 minutes of trying");
ok(shouldKeepTrying(3) === false && nextDelay(3, retryDelay) > 0,
  "NEGATIVE CONTROL: the old ladder really does stop at three — this is the exact gap that made rejoining the only cure");

// ── 2. it only tries for somebody who wants the device on ────────────────
const due = (o) => dueForRetry({ wantOn: true, inFlight: false, attempts: 0, sinceMs: 999999, fast: retryDelay, ...o });
ok(due({}) === true, "a device the person wants on, and time has passed → try again");
ok(due({ wantOn: false }) === false,
  "somebody who muted themselves is never 'recovered' — restarting a muted mic is an app arguing with its user");
ok(due({ inFlight: true }) === false, "and two recoveries never run at once");
ok(due({ sinceMs: 0 }) === false, "…nor a second one in the same instant");
ok(due({ attempts: 5, sinceMs: PATIENT_MS - 1 }) === false && due({ attempts: 5, sinceMs: PATIENT_MS }) === true,
  "patience is a real wait, not a busy loop");

// ── 3. it cannot wedge ───────────────────────────────────────────────────
ok(isStuck(1000, 1000 + RECOVER_TIMEOUT_MS) === true,
  "a recovery that has not come back inside the deadline is declared stuck — one hung call must not silence somebody for the rest of the meeting");
ok(isStuck(1000, 1000 + RECOVER_TIMEOUT_MS - 1) === false, "…but not one that is merely slow");
ok(isStuck(0, 99999999) === false, "and nothing is 'stuck' when nothing was started");

const t0 = Date.now();
const hung = await withTimeout(new Promise(() => {}), 60);
ok(hung === false && Date.now() - t0 < 1500,
  "a promise that never settles resolves false on its own — this is the deadlock that ate the microphone");
ok((await withTimeout(Promise.resolve("ok"), 500)) === "ok", "…while a call that works is passed straight through");
ok((await withTimeout(Promise.reject(new Error("no device")), 500)) === false,
  "…and a refusal comes back as false rather than throwing at the supervisor");

// ── 4. it goes BACK to the device the person picked ──────────────────────
const present = ["default", "laptop-1", "bt-9"];
ok(shouldReattach({ savedId: "bt-9", activeId: "laptop-1", present }) === true,
  "the headset you chose is back and you are on the laptop mic → move back to the headset");
ok(shouldReattach({ savedId: "bt-9", activeId: "bt-9", present }) === false,
  "…and nothing happens when you are already on it");
ok(shouldReattach({ savedId: "bt-9", activeId: "laptop-1", present: ["default", "laptop-1"] }) === false,
  "…and a headset that is still gone is not chased — that is how you end up with no microphone at all");
ok(shouldReattach({ savedId: "", activeId: "laptop-1", present }) === false,
  "somebody who never picked a device is never moved");
ok(shouldReattach({ savedId: "default", activeId: "laptop-1", present }) === false,
  "'default' is not a choice, so it is not honoured as one");

// ── 5. the microphone heals the commonest Bluetooth failure by itself ────
const base = { mutedByUser: false, ended: false, mutedBySystem: false, quietMs: 0, peak: 0.3, publishing: true, attempts: 0 };
const silent = { ...base, quietMs: QUIET_MS, peak: 0 };
ok(micVerdict(silent).action === "recover",
  "a microphone that has gone silent is RESTARTED, not merely reported — restarting is exactly what rejoining did for them");
ok(micVerdict({ ...silent, quietFixes: 1 }).action === "pick",
  "…once. A restart that succeeds and is still silent stops and asks, instead of blipping the mic every twenty seconds forever");
ok(micVerdict({ ...base, mutedByUser: true, quietMs: 999999, peak: 0 }).action === "none",
  "NEGATIVE CONTROL: somebody who muted themselves is still never restarted");
ok(micVerdict({ ...base, quietMs: QUIET_MS - 1, peak: 0 }).level === "ok",
  "NEGATIVE CONTROL: and a pause shorter than the threshold still says nothing");

// ── 6. the frozen tile: 'missing live video' ─────────────────────────────
const rgbaA = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
const rgbaB = new Uint8ClampedArray([10, 20, 31, 255, 40, 50, 60, 255]);
ok(frameSignature(rgbaA) === frameSignature(new Uint8ClampedArray(rgbaA)),
  "the same picture signs the same");
ok(frameSignature(rgbaA) !== frameSignature(rgbaB),
  "…and one channel of one pixel changing is enough to sign differently — real sensor noise always does");
ok(frameSignature([]) === "", "an unread frame signs as nothing, which is NOT the same as a frozen one");

const cam = { offByUser: false, publishing: true, ended: false, mutedBySystem: false, luma: 120, darkMs: 0, attempts: 0 };
ok(camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS }).action === "recover",
  "a picture that has not changed in twelve seconds is restarted — everyone else was looking at a photograph of them");
ok(/still frame|stopped moving/i.test(camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS }).title + camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS }).detail),
  "…and it SAYS that, in words a person can repeat to the room");
ok(/background effect/i.test(camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS }).detail),
  "…and names the background effect, which is what stalls on Windows");
ok(camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS, freezeFixes: 1 }).action === "pick",
  "…once. Then it stops and asks, rather than restarting the camera every twelve seconds");
ok(camVerdict({ ...cam, frozenMs: CAM_FREEZE_MS - 1 }).level === "ok",
  "NEGATIVE CONTROL: sitting still for eleven seconds is not a fault");
ok(camVerdict({ ...cam, offByUser: true, frozenMs: 999999 }).level === "ok",
  "NEGATIVE CONTROL: a camera the person turned off is never 'frozen'");
ok(camVerdict({ ...cam, luma: CAM_BLACK, darkMs: CAM_DARK_MS, frozenMs: 999999 }).title === "Your camera is on but sending black",
  "a frozen BLACK picture is reported as black — the privacy-shutter advice is the more useful of the two");
ok(camVerdict({ ...cam, ended: true, frozenMs: 999999 }).title === "Your camera stopped",
  "…and a track that has ended outranks both, because that one has a real cause");

// ── 7. the wiring, which is where all three of these bugs actually lived ─
// Pure functions cannot see a dependency array. These read the components.
const guard = readFileSync(new URL("../app/room/[room]/MediaGuard.tsx", import.meta.url), "utf8");
const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");

ok(/const v = micVerdict\(\{[\s\S]*?\n  \}, \[room, micWanted, recover\]\);/.test(guard),
  "THE BUG: the microphone verdict runs on its own clock, NOT inside an effect keyed on the live track — 'no microphone is being sent' was unreachable code precisely when it was true");
ok(!/if \(!mst\) return;/.test(guard),
  "…and the early-return that made it unreachable is gone");
ok(/restartTrack/.test(guard),
  "recovery asks the operating system for a FRESH microphone — livekit's own unmute() only re-acquires when the track has ENDED, so off-and-on unmuted the same silent track");
ok(/withTimeout\(\s*localParticipant\.setMicrophoneEnabled/.test(guard) &&
   /withTimeout\(\s*localParticipant\.setCameraEnabled/.test(guard),
  "every call that talks to a device has a deadline — one hung call must not wedge the guard for the rest of the meeting");
ok(!/recovering\.current = false; recover\(\);/.test(guard) && !/camRecovering\.current = false; recoverCam\(\);/.test(guard),
  "recovery no longer schedules its own last retry and then stops for ever");
ok((guard.match(/dueForRetry\(\{/g) || []).length >= 2,
  "…both organs ask the patient ladder when to try again, so neither gives up while somebody still wants the device on");
ok(/shouldReattach\(\{/.test(guard) && /switchActiveDevice/.test(guard),
  "a headset that comes BACK is switched back to — falling back to the laptop mic is right, staying there is not");
ok(/frameSignature\(px\)/.test(guard) && /frozenMs:/.test(guard),
  "the camera samples whether the picture MOVED, not only whether it is bright — a frozen tile is what 'missing live video' looks like");
ok(/stopProcessor\(\)[\s\S]{0,1200}restartTrack/.test(guard),
  "…and a freeze takes the background effect off before it restarts the camera, because the effect is the thing that stalls");

ok(/<PlaybackGate \/>/.test(conf) && /function PlaybackGate\(/.test(conf),
  "the room has a way to unblock playback — @livekit/components-react's VideoConference renders RoomAudioRenderer but NOT StartAudio, so a browser that blocked the sound left nothing on the page that could start it");
ok(/room\.startAudio\(\)/.test(conf) && /room\.startVideo\(\)/.test(conf),
  "…and one click starts both, because a browser that blocked one has usually blocked the other");
ok(/AudioPlaybackStatusChanged/.test(conf) && /VideoPlaybackStatusChanged/.test(conf),
  "…and it appears from the room's own events rather than a guess about which browsers do this");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
