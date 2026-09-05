/**
 * MAYA GUARD — the camera, and the four ways it goes black without saying so.
 *
 * Maya asks: "My teammate on Windows was a black tile all meeting. Did the
 * app know? Did it try to fix it? Did it tell him WHY in words he could act
 * on — or did it blame his microphone?"
 *
 * FIELD 2026-08-19: a live three-person meeting, one Windows participant,
 * black tile. The app watched the microphone track like a hawk and the
 * camera not at all.
 *
 * Run: node lib/camera.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  lumaFrom, camVerdict, blameKind, CAM_BLACK, CAM_DARK_MS,
  EFFECTS, effectById, restoreEffect, effectSupport, processorFor, chromaPaintPaths, defaultChromaPaint,
  camRetryDelay, camShouldKeepTrying, deviceFailText, joinErrorText,
  deviceFailIsStale,
} from "./camera.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── reading the pixels, because no API reports a covered lens ────────────
const px = (r, g, b, n = 16) => Array.from({ length: n * 4 }, (_, i) => [r, g, b, 255][i % 4]);
ok(lumaFrom(px(0, 0, 0)) === 0, "a black frame reads 0 — the covered-shutter signature");
ok(lumaFrom(px(255, 255, 255)) >= 250, "a white frame reads ~255");
ok(lumaFrom([]) === 0 && Number.isFinite(lumaFrom([1])), "no pixels reads 0, never NaN");
ok(lumaFrom(px(0, 255, 0)) > lumaFrom(px(0, 0, 255)), "green weighs more than blue — the eye's weights, not the average's");
ok(CAM_BLACK <= 10 && CAM_DARK_MS >= 5000,
  "the black threshold is strict and the patience is long — a dark room must never trip the shutter alarm");

// ── the verdicts, honest states first ────────────────────────────────────
const S = (over = {}) => ({
  offByUser: false, publishing: true, ended: false, mutedBySystem: false,
  luma: 120, darkMs: 0, attempts: 0, label: "Integrated Webcam", ...over,
});
ok(camVerdict(S({ offByUser: true })).level === "ok",
  "camera off BY CHOICE is never a fault — a wrong alarm teaches people to ignore the right one");
ok(camVerdict(S({ offByUser: true, ended: true, luma: 0, darkMs: 99999 })).action === "none",
  "…and stays quiet even when the dead track would otherwise alarm");

const gone = camVerdict(S({ publishing: false }));
ok(gone.level === "dead" && gone.action === "recover",
  "camera wanted but not being sent → dead, and we try to bring it back ourselves");
ok(/another app/i.test(gone.detail) && /tray/i.test(gone.detail),
  "…and the words name the Windows cause: another app holding it, minimised to the tray");
ok(camVerdict(S({ publishing: false, attempts: 3 })).action === "pick",
  "after three failed recoveries we stop retrying and ask the person to pick a camera");

ok(camVerdict(S({ ended: true })).level === "dead", "a track that ENDED is dead, not 'on'");
const sysmute = camVerdict(S({ mutedBySystem: true }));
ok(sysmute.level === "dead" && /privacy switch|kill switch/i.test(sysmute.detail),
  "a system-muted track names the Windows camera privacy switch — the cause nobody guesses");

const black = camVerdict(S({ luma: 2, darkMs: 12_000 }));
ok(black.level === "warn" && /shutter|lens cover/i.test(black.detail),
  "black frames for 12s name the PHYSICAL SHUTTER — the one cause no API reports");
ok(black.action === "recover" && camVerdict(S({ luma: 2, darkMs: 12_000, attempts: 1 })).action === "pick",
  "black picture: one reconnect attempt, then ask — reopening a track never opens a shutter");
ok(camVerdict(S({ luma: 18, darkMs: 60_000 })).level === "ok",
  "a genuinely dark room (luma 18) is NOT flagged — dark is not black");
ok(camVerdict(S({ luma: 2, darkMs: 3_000 })).level === "ok",
  "black for only three seconds is not yet an alarm — lights get switched off for a moment");
ok(camVerdict(S({ luma: null, darkMs: 999_999 })).level === "ok",
  "no luminance READING is never treated as black — a broken meter must not cry wolf");
ok(camVerdict(S()).level === "ok" && camVerdict(S()).detail === "",
  "a healthy camera says nothing at all");

// ── blaming the right device, or refusing to blame ───────────────────────
ok(blameKind({ wantCam: true, hasCam: false, wantMic: true, hasMic: true }) === "videoinput",
  "camera missing, mic fine → the CAMERA gets blamed — the field bug was this exact misdirection");
ok(blameKind({ wantCam: true, hasCam: true, wantMic: true, hasMic: false }) === "audioinput",
  "mic missing, camera fine → the microphone gets blamed");
ok(blameKind({ wantCam: true, hasCam: false, wantMic: true, hasMic: false }) === null,
  "both missing → no single blame; guessing one sends the person down the wrong path");
ok(blameKind({ wantCam: false, hasCam: false, wantMic: true, hasMic: true }) === null,
  "nothing missing that was wanted → nothing to blame");

// ── the effects shelf ────────────────────────────────────────────────────
ok(EFFECTS[0]?.kind === "none" && EFFECTS[1]?.kind === "blur" && EFFECTS[2]?.kind === "chroma",
  "the shelf starts with None, Blur, then Green screen (chroma)");
ok(EFFECTS[2]?.id === "chroma" && EFFECTS[2]?.badge === "Reliable",
  "Green screen carries the Reliable badge");
const images = EFFECTS.filter((e) => e.kind === "image" && !e.custom);
const videos = EFFECTS.filter((e) => e.kind === "video");
ok(images.length === 1 && images[0].id === "city" && videos.length === 1 && videos[0].id === "citylights",
  "Glass dusk + Loop City — the curated shelf is a choice, not a catalogue");
ok(images.every((e) => String(e.src || "").startsWith("data:image/svg+xml")),
  "every backdrop is a data: URL — a background that needs a CDN is sometimes not there");
ok(images.every((e) => /width%3D%221280%22|width="1280"/.test(e.src) || /width%3D%221280%22/.test(encodeURIComponent(e.src))) ||
   images.every((e) => decodeURIComponent(e.src).includes('width="1280"') && decodeURIComponent(e.src).includes('height="720"')),
  "every backdrop SVG declares its size — createImageBitmap refuses an SVG with no intrinsic size");
ok(new Set(EFFECTS.map((e) => e.id)).size === EFFECTS.length, "effect ids are unique");
ok(effectById("no-such-thing").kind === "none", "an unknown saved effect falls back to None, never crashes");

ok(restoreEffect("", "1").id === "blur",
  "somebody who chose blur BEFORE backgrounds existed still gets blur — an upgrade must not un-blur anyone");
// 2026-08-20: "nebula" was one of the abstract gradients the shelf used to
// carry; it is now a curated room. The guard's INTENT — a remembered
// choice comes back, and anything unrecognised falls to None — is unchanged.
ok(restoreEffect("city", "", ["city"]).id === "city" && restoreEffect("garbage").id === "none" && restoreEffect("").id === "none",
  "the remembered effect comes back — when this deployment actually has its photograph; garbage and nothing come back as None");
ok(restoreEffect("city").id === "none",
  "…and a room whose photograph was never shipped comes back as plain video, not as the drawn cartoon somebody chose it instead of");
ok(restoreEffect("blur").id === "blur" && restoreEffect("custom", "", []).id === "custom" && restoreEffect("chroma").id === "chroma",
  "NEGATIVE CONTROL: blur, green screen, and their own picture are never withheld — none need a photograph from us");
ok(restoreEffect("nebula").id === "none",
  "…and a backdrop that no longer exists falls back to plain video rather than to a blank picture — somebody who chose Nebula last week gets their own room back, not a black rectangle");

ok(effectSupport({ trackGenerator: true, trackProcessor: true, offscreenCanvas: true }).ok === true,
  "Chrome/Edge-shaped browsers are supported");
const no = effectSupport({ trackGenerator: false, trackProcessor: true, offscreenCanvas: true });
ok(!no.ok && /Chrome and Edge/.test(no.why) && !/Safari 1?\d?\+? can/.test(no.why),
  "…and the refusal names who CAN (Chrome, Edge) without promising Safari — Safari can't run these yet");
ok(/plain video still works/i.test(no.why),
  "the refusal reassures: your plain video still works — being seen beats the nicer wall");

ok(processorFor(effectById("blur")).blurRadius === 24, "blur maps to BLUR_PX (24) — the strong privacy blur, never the leftover light radius of 12");
ok(processorFor(effectById("chroma")).kind === "chroma",
  "Green screen maps to chroma processor (no MediaPipe)");
ok(processorFor(effectById("city")).imagePath === effectById("city").src,
  "an image effect maps to its own backdrop");
ok(processorFor(effectById("none")).kind === "none", "None maps to no processor at all");

ok(camRetryDelay(0) < camRetryDelay(2) && !camShouldKeepTrying(3),
  "camera retries back off and then STOP — a retry loop forever burns a machine already struggling");

// ── the words for failures that don't say which device ───────────────────
const inuse = deviceFailText("DeviceInUse");
ok(/camera or microphone/.test(inuse) && /tray/.test(inuse),
  "an in-use failure names BOTH devices and the tray — never guesses which one");
ok(/padlock/.test(deviceFailText("PermissionDenied")), "a permission failure points at the padlock");
ok(deviceFailText("") === "", "no failure, no banner");
ok(/camera or microphone/.test(joinErrorText("NotReadableError", "video source busy")),
  "a getUserMedia error at join gets device words");
const conn = joinErrorText("ConnectionError", "could not establish pc connection");
ok(/connect/i.test(conn) && !/microphone\b(?! couldn)/.test(conn.replace(/camera or microphone/g, "")) && !/Your microphone/.test(conn),
  "a CONNECTION error never blames a device — a websocket failure described as a mic problem is a lie with a fix attached");

// ── the wiring travels with the module ───────────────────────────────────
const guard = readFileSync(new URL("../app/room/[room]/MediaGuard.tsx", import.meta.url), "utf8");
ok(/from "@\/lib\/camera"/.test(guard),
  "MediaGuard IMPORTS this engine — the verdicts above are the ones the room actually shows");
ok(/setCameraEnabled\(false\)/.test(guard) && /setCameraEnabled\(\s*true/.test(guard),
  "camera recovery is off-then-on — the only way to make LiveKit drop a dead track and ask the OS for a live one");
ok(/camVerdict\(/.test(guard), "the room runs camVerdict on the PUBLISHED track, continuously");
ok(/getImageData/.test(guard) && /lumaFrom\(/.test(guard),
  "the room actually samples pixels — the shutter alarm needs eyes, not just track events");
// 2026-08-20: this used to name @livekit/track-processors' BackgroundBlur and
// VirtualBackground directly. That package's transformer republishes its last
// canvas whenever the segmentation mask is late, which is what a live meeting
// saw as "the blur keeps flashing" — so the wiring now goes through our own
// processor (lib/qbg.ts, guarded in lib/effects.test.mjs). The GUARD'S INTENT
// is unchanged and still the thing that matters: both a blur and an image
// background must actually reach a processor, not just a state variable.
ok(/quantlysBackground\(/.test(guard) && /kind: "blur"/.test(guard) && /kind: "image"/.test(guard),
  "both blur AND image backgrounds are wired to a real processor");
ok(/restoreEffect\(/.test(guard) && /qm\.effect/.test(guard),
  "the chosen effect is REMEMBERED and restored on the next join — qm.blur used to be saved and never read back");
ok((guard.match(/stopProcessor\(\)/g) || []).length >= 2,
  "stopProcessor appears in both the None path and the failure path — an effect that fails degrades to plain video, never to no video");
ok(/re-appl/i.test(guard),
  "effects re-apply when the camera track is replaced — recovery and device switches must not silently strip the background");

const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");
ok(/joinErrorText\(/.test(conf) && /deviceFailText\(/.test(conf),
  "the join screen uses these words for failures instead of describing everything as a microphone");
ok(/deviceFailIsStale/.test(conf) && /MediaFailBanner/.test(conf),
  "the room clears a leftover device banner once the wanted tracks are live, and offers Dismiss");
ok(!/describeMediaError\(e\)\.what/.test(conf) && !/describeMediaError\(\{ name: String\(f\) \}\)/.test(conf),
  "…and the old mic-blames-everything handlers are gone");

// ── a leftover device banner is not a browser block ──────────────────────
ok(deviceFailIsStale({
  failureText: deviceFailText("PermissionDenied"),
  camWanted: true, micWanted: true, camLive: true, micLive: true,
}), "PermissionDenied copy + cam+mic wanted and live => stale");
ok(!deviceFailIsStale({
  failureText: deviceFailText("PermissionDenied"),
  camWanted: true, micWanted: true, camLive: true, micLive: false,
}), "PermissionDenied copy + mic wanted but not live => NOT stale");
ok(!deviceFailIsStale({
  failureText: joinErrorText("ConnectionError", "could not establish pc connection"),
  camWanted: true, micWanted: true, camLive: true, micLive: true,
}), "ConnectionError joinErrorText + tracks live => NOT stale");
ok(deviceFailIsStale({
  failureText: "",
  camWanted: true, micWanted: true, camLive: false, micLive: false,
}), "empty text => stale");


// Chroma paints a chosen plate (Glass dusk / Loop / custom), not blur-of-green.
ok(typeof chromaPaintPaths === "function" && typeof defaultChromaPaint === "function",
  "chromaPaintPaths / defaultChromaPaint exported");
ok(Object.keys(chromaPaintPaths(null)).length === 0,
  "no paint → empty paths (processor uses gray studio)");
ok(chromaPaintPaths(effectById("city"), "", true).imagePath === effectById("city").photo,
  "city paint → imagePath to Glass dusk photo when available");
ok(chromaPaintPaths(effectById("citylights")).videoPath === "/backgrounds/citylights.webm",
  "Loop City paint → videoPath");
ok(defaultChromaPaint(["city"], []).id === "city",
  "default chroma paint is Glass dusk when city photo ships");
ok(defaultChromaPaint([], []) === null,
  "no photos/loops → null paint (gray studio, not green blur)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
