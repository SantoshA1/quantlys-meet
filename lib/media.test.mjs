/**
 * MAYA GUARD — microphones and cameras that fail quietly.
 *
 * Maya asks: "I was talking for ten minutes and nobody heard a word. The mic
 * button was lit the whole time. Why did nothing tell me?"
 *
 * FIELD 2026-08-18 — this one cost a real meeting. He abandoned Quantlys
 * mid-call and moved his team to Google Meet:
 *   "webcam is on but the preview was not visible to a team member"
 *   "I could hear them, they were not able to hear me"
 *
 * Both from `<LiveKitRoom connect video audio />` — the hello-world mount that
 * grabs whatever is default, publishes it, and never looks at it again.
 *
 * The guards below are about the difference between a fault and a report of a
 * fault. Every one of them describes something the app must SAY.
 *
 * Run: node lib/media.test.mjs
 */
import {
  describeMediaError, audioConstraints, videoConstraints, deviceLabel, pickDevice,
  isBluetooth, levelFrom, micVerdict, bars, retryDelay, shouldKeepTrying,
  connectionAdvice, speakerPickerWorks, speakerNote, FLOOR, QUIET_MS,
} from "./media.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const err = (name, message = "") => ({ name, message });

// ── the Windows camera failure, which is the one he actually hit ──────────
const inuse = describeMediaError(err("NotReadableError"), "videoinput");
ok(inuse.code === "inuse", "NotReadableError is recognised as 'another app has it'");
ok(/another app/i.test(inuse.what),
  "…and SAYS another app has it — this is the whole twenty-minute mystery on Windows");
ok(/Zoom|Teams/.test(inuse.fix),
  "…and names the actual culprits, because 'close other applications' is not an instruction");
ok(/light being on/i.test(inuse.fix),
  "…and explains the webcam light, which is the thing that convinces people their camera is fine");
ok(describeMediaError(err("TrackStartError")).code === "inuse",
  "Chrome's other name for the same failure lands in the same place");
ok(describeMediaError({ message: "Could not start video source" }).code === "inuse",
  "…and so does the bare message, for browsers that don't set a name");

ok(describeMediaError(err("NotAllowedError")).code === "denied", "a blocked permission is named");
ok(/padlock|address bar/i.test(describeMediaError(err("NotAllowedError")).fix),
  "…and says WHERE to click, since nobody knows where browser permissions live");
ok(describeMediaError(err("NotFoundError")).code === "missing", "no device at all is its own case");
ok(describeMediaError(err("OverconstrainedError")).code === "constraints",
  "the remembered device having vanished is its own case, not a mystery");
ok(describeMediaError(err("AbortError")).code === "hardware", "a driver hiccup is named");
ok(describeMediaError(null).code === "unknown" && describeMediaError(null).fix.length > 10,
  "and something we have never seen still produces a sentence with a next step in it");
ok(describeMediaError(err("NotReadableError"), "audioinput").what.includes("microphone"),
  "the words change with the device — 'your camera' when it's the camera, 'your microphone' when it's the mic");

// ── the one word that decides how long the outage lasts ──────────────────
const ac = audioConstraints("mic-123");
ok(ac.deviceId?.ideal === "mic-123" && ac.deviceId?.exact === undefined,
  "the device is IDEAL, never EXACT — with exact, a headset going to sleep throws OverconstrainedError and you get silence for the rest of the call instead of the next-best microphone");
ok(ac.echoCancellation === true && ac.noiseSuppression === true,
  "echo cancellation and noise suppression are on");
ok(ac.autoGainControl === true,
  "…and auto gain, which is the fix for 'you're very quiet' — the second most common thing said on a call");
ok(audioConstraints().deviceId === undefined,
  "with nothing remembered we ask for no particular device rather than for a device called 'undefined'");
ok(videoConstraints("cam-1").deviceId?.ideal === "cam-1" && !videoConstraints("cam-1").deviceId?.exact,
  "the camera gets the same treatment");
ok(audioConstraints("default").deviceId === undefined,
  "and 'default' is not pinned as an id — it means different hardware from one minute to the next");

// ── a device list a person can read ──────────────────────────────────────
ok(deviceLabel({ label: "Default - Microphone (Realtek(R) Audio) (10ec:0289)", deviceId: "a", kind: "audioinput" })
  === "Microphone (Realtek(R) Audio)",
  "the hardware ids and the 'Default -' prefix come off, because nobody is choosing by USB vendor id");
ok(deviceLabel({ label: "", deviceId: "a", kind: "audioinput" }, 2) === "Microphone 3",
  "a device with no label yet — which is every device before permission is granted — is numbered, not blank");
ok(deviceLabel({ label: "", deviceId: "a", kind: "videoinput" }, 0, "videoinput") === "Camera 1",
  "…and named for what it is");

const devices = [
  { deviceId: "default", label: "Default - Realtek", kind: "audioinput" },
  { deviceId: "bt-9", label: "Jabra Elite 75t Hands-Free", kind: "audioinput" },
];
ok(pickDevice(devices, "bt-9").id === "bt-9", "the device you chose last time is the one you get");
ok(pickDevice(devices, "gone-1").id === "default", "…and if it's gone you still get a working microphone");
ok(pickDevice(devices, "gone-1").savedIsGone === true,
  "…but the app KNOWS it switched, so it can say so — silently using a different microphone from the one somebody picked is how you broadcast your laptop lid");
ok(pickDevice(devices, "bt-9").savedIsGone === false, "and a device that is still there raises nothing");
ok(pickDevice([], "x").id === "" && pickDevice([]).savedIsGone === false,
  "no devices at all is handled without throwing");

ok(isBluetooth("Jabra Elite 75t Hands-Free") && isBluetooth("AirPods Pro"),
  "Bluetooth is recognised from the label — it changes what the advice should be");
ok(!isBluetooth("Microphone (Realtek(R) Audio)"), "and a built-in mic is not called Bluetooth");

// ── the level meter that the watchdog reads ──────────────────────────────
ok(levelFrom(new Array(128).fill(128)) === 0, "a flat 128 is silence, which is what a dead microphone reads");
ok(levelFrom(new Array(128).fill(0).map((_, i) => (i % 2 ? 200 : 56))) > 0.5, "a loud signal reads loud");
ok(levelFrom([]) === 0 && levelFrom(null) === 0, "and an empty buffer never throws mid-call");
ok(bars(0, 12).every((b) => !b) && bars(1, 12).every((b) => b), "the meter is empty at zero and full at one");
ok(bars(0.05, 12).filter(Boolean).length === 1,
  "a small REAL signal lights a segment — a continuous bar at 3% looks identical to one at 0%, which is the exact distinction somebody is trying to make");

// ── the verdict: what the app says, and when it stays quiet ──────────────
const base = { mutedByUser: false, ended: false, mutedBySystem: false, quietMs: 0, peak: 0.3, publishing: true, attempts: 0 };

ok(micVerdict({ ...base }).level === "ok", "a working microphone says nothing");
ok(micVerdict({ ...base, mutedByUser: true, peak: 0, quietMs: 999999 }).level === "ok",
  "somebody who muted THEMSELVES is never told their microphone is broken — that is the alarm that teaches people to ignore alarms");

const dead = micVerdict({ ...base, ended: true, label: "Jabra Elite 75t Hands-Free" });
ok(dead.level === "dead" && dead.action === "recover", "a track that ended is dead, and we go and get it back");
ok(/Bluetooth/i.test(dead.detail),
  "…and when it's a Bluetooth device it says so, because that is the cause and it has its own fix");
ok(/audio profiles/i.test(dead.detail),
  "…naming the actual mechanism: the headset switches profile and the mic dies while the sound keeps playing");

const osmute = micVerdict({ ...base, mutedBySystem: true });
ok(osmute.level === "dead",
  "a track the OS muted under us counts as dead too — WebRTC keeps publishing an empty stream and everyone still sees you un-muted");

const quiet = micVerdict({ ...base, quietMs: QUIET_MS, peak: 0 });
ok(quiet.level === "warn" && /nobody heard you/i.test(quiet.detail),
  "a live microphone that has produced nothing for twenty seconds is reported, in the words that matter: if you were talking, nobody heard you");
ok(micVerdict({ ...base, quietMs: QUIET_MS - 1, peak: 0 }).level === "ok",
  "…but not before that, or sitting quietly in someone else's meeting sets off an alarm");
ok(micVerdict({ ...base, quietMs: 999999, peak: FLOOR + 0.01 }).level === "ok",
  "and a microphone that IS picking up a quiet room is left alone — room noise is proof of life");

ok(micVerdict({ ...base, publishing: false }).level === "dead",
  "no published microphone at all is the loudest case of them all");
ok(micVerdict({ ...base, ended: true, attempts: 3 }).action === "pick",
  "after three failed reconnections we stop retrying and ask the person to choose — a loop that retries for ever burns a machine already having a bad day");

// ── recovery ────────────────────────────────────────────────────────────
ok(retryDelay(0) < 1000, "the first reconnection is immediate, because somebody is mid-sentence");
ok(retryDelay(1) > retryDelay(0) && retryDelay(2) > retryDelay(1), "then it backs off");
ok(!shouldKeepTrying(3) && shouldKeepTrying(0), "and it stops instead of spinning");

// ── the connection, and the speaker picker that might not work ──────────
ok(/camera off/i.test(connectionAdvice("poor")),
  "a struggling connection is given the fix that actually works: turn the camera off and the audio recovers");
ok(connectionAdvice("excellent") === "", "and a good connection is not narrated");
ok(/can't choose/i.test(speakerNote(false)) && /Firefox/.test(speakerNote(false)),
  "a browser that cannot switch speakers SAYS so and names which ones can — a picker that silently does nothing is worse than no picker");
ok(typeof speakerPickerWorks({ setSinkId: () => {} }) === "boolean" && speakerPickerWorks({ setSinkId: () => {} }),
  "and support is detected from the element rather than sniffed from the user agent");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
