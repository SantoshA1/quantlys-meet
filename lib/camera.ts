// Cameras, and the four ways they go black without saying so.
//
// FIELD 2026-08-19, off a live three-person meeting: a Windows user's tile
// was black while his camera light may well have been on. The app had a
// watchdog on the MICROPHONE track (the Bluetooth fix) and nothing at all on
// the camera. Same disease, other organ:
//
//   1. Another app already holds the camera (Teams or Zoom minimised to the
//      tray is the classic) — getUserMedia throws NotReadableError and the
//      camera never starts. The LED is ON, lit by the OTHER app, which is
//      exactly what convinces the person their camera works and ours doesn't.
//   2. The MediaStreamTrack ENDS mid-call — USB renumber, driver hiccup,
//      another program grabbing the device. WebRTC keeps the publication up
//      and encodes nothing. Black tile, no warning.
//   3. The OS mutes the track under us — Windows' camera privacy switch, a
//      laptop Fn kill-switch. `track.muted` goes true; every control still
//      says ON.
//   4. The camera runs fine and sends LITERALLY BLACK FRAMES — a closed
//      privacy shutter or a lens cover. No API reports this. Only looking at
//      the pixels does, which is why this module has a luminance reader.
//
// This file is the part that can be reasoned about and tested without a
// camera. The rule it enforces is the microphone rule again: a control that
// says ON must be checked against what is actually leaving the machine.
//
// It is deliberately ZERO-IMPORT so it can travel into any Next.js project
// on its own — it is built to be imported, not copied.

import { SLOTS, CUSTOM_ID, CUSTOM_PLACEHOLDER } from "./backgrounds.ts";

export type CamVerdict = {
  level: "ok" | "warn" | "dead";
  title: string;
  detail: string;
  action: "none" | "recover" | "pick";
};

export type CamState = {
  /** the person turned their camera off — this is never a fault */
  offByUser: boolean;
  /** is there a published camera track at all */
  publishing: boolean;
  /** the MediaStreamTrack has ended: the device is gone */
  ended: boolean;
  /** the OS muted the track under us — a privacy switch does this */
  mutedBySystem: boolean;
  /** mean brightness 0..255 of the latest sampled frame, or null when the
   *  sampler could not read one (no reading is NOT the same as black) */
  luma: number | null;
  /** how long the picture has been at or below CAM_BLACK, in ms */
  darkMs: number;
  /** how many times we have already tried to bring it back */
  attempts: number;
  label?: string;
};

/** At or below this mean brightness a frame is indistinguishable from a
 *  covered lens. A face in a genuinely dark room still averages well above
 *  it, because screens light faces. */
export const CAM_BLACK = 6;

/** How long the picture must stay black before we say so. Long enough to
 *  survive a light switched off for a moment; short enough that a closed
 *  shutter is named within one exchange of "can you see me?". */
export const CAM_DARK_MS = 10_000;

/** Mean brightness of an RGBA pixel buffer, 0..255. Pure, so the thing that
 *  decides "your camera is sending black" can be tested without a camera. */
export function lumaFrom(rgba: Uint8ClampedArray | number[]): number {
  const n = rgba?.length || 0;
  if (n < 4) return 0;
  let sum = 0;
  let px = 0;
  for (let i = 0; i + 2 < n; i += 4) {
    // Rec. 601 weights — the eye's, not the arithmetic mean's.
    sum += 0.299 * Number(rgba[i]) + 0.587 * Number(rgba[i + 1]) + 0.114 * Number(rgba[i + 2]);
    px++;
  }
  return px ? sum / px : 0;
}

/** The whole point of this file. Ordered so the honest states come first:
 *  somebody who turned their camera off is not broken, and a wrong alarm
 *  teaches everybody to ignore the right one. */
export function camVerdict(s: CamState): CamVerdict {
  if (s.offByUser) {
    return { level: "ok", title: "Camera off", detail: "Your camera is off. People see your name instead — press the camera button to be seen.", action: "none" };
  }
  if (!s.publishing) {
    return {
      level: "dead",
      title: "Your camera isn't being sent",
      detail:
        "Your camera isn't reaching the meeting — people see a black tile with your name. " +
        "The usual cause on Windows is another app holding the camera (Teams, Zoom or the Camera app, " +
        "including ones minimised to the tray). The camera light being on usually means the OTHER app has it.",
      action: s.attempts >= 3 ? "pick" : "recover",
    };
  }
  if (s.ended || s.mutedBySystem) {
    return {
      level: "dead",
      title: "Your camera stopped",
      detail: s.mutedBySystem
        ? `${s.label || "Your camera"} was cut off by the system — on Windows this is usually the camera privacy switch, a function-key kill switch, or another app taking the device. Reconnecting it now.`
        : `${s.label || "Your camera"} stopped sending — usually a USB or driver hiccup, or another app grabbing it. Reconnecting it now.`,
      action: s.attempts >= 3 ? "pick" : "recover",
    };
  }
  if (s.luma !== null && s.luma <= CAM_BLACK && s.darkMs >= CAM_DARK_MS) {
    return {
      level: "warn",
      title: "Your camera is on but sending black",
      detail:
        "The camera is running, but the picture leaving it is completely black. " +
        "Nine times out of ten that is the physical privacy shutter or a lens cover — check the little slider over the lens. " +
        "If there's no shutter, another app may have blanked it; reconnecting can help, or pick a different camera below.",
      action: s.attempts < 1 ? "recover" : "pick",
    };
  }
  return { level: "ok", title: "Camera working", detail: "", action: "none" };
}

/** When a device error arrives without saying WHICH device failed, blame the
 *  one that is actually missing — never guess. A camera failure described as
 *  a microphone problem sends the person debugging the wrong device, which
 *  is exactly what happened in the field. */
export function blameKind(s: {
  wantCam: boolean; hasCam: boolean;
  wantMic: boolean; hasMic: boolean;
}): "videoinput" | "audioinput" | null {
  const camMissing = s.wantCam && !s.hasCam;
  const micMissing = s.wantMic && !s.hasMic;
  if (camMissing && !micMissing) return "videoinput";
  if (micMissing && !camMissing) return "audioinput";
  return null; // both or neither — no honest single blame exists
}

// ── background effects: none, blur, or another room ────────────────────────
//
// The processors come from @livekit/track-processors: BackgroundBlur runs a
// segmentation model on every frame; VirtualBackground additionally paints an
// image where the background was. Support is Chrome/Edge-shaped: it needs
// MediaStreamTrackGenerator, MediaStreamTrackProcessor and OffscreenCanvas.
// Firefox and Safari don't have them yet, and a control that cannot work must
// say so instead of doing nothing.
//
// THE RULE FOR FAILURES: an effect that cannot start degrades to PLAIN VIDEO,
// never to no video. Being seen matters more than being seen in front of a
// nicer wall.

export type Effect = {
  id: string;
  kind: "none" | "blur" | "image";
  label: string;
  /** data: URL for image effects — self-contained, nothing to host or fetch */
  src?: string;
  /** where a real photograph would live in this deployment, if it ships one */
  photo?: string;
  /** the person's own picture rather than one of ours */
  custom?: boolean;
};

/** The shelf. None and Blur first — plain video is the first-class choice —
 *  then five rooms a person could plausibly be sitting in, then a slot for
 *  their own picture.
 *
 *  FIELD 2026-08-20: the previous five were abstract gradients (Nebula,
 *  Gridline, Dusk…). Pretty, and nobody wants to appear to be sitting inside
 *  a purple haze. A meeting backdrop has exactly one job — look like a room
 *  — so the shelf is rooms now. Each is a SLOT: a real photograph at
 *  /backgrounds/<id>.jpg when a deployment ships one, and a drawn room until
 *  it does. See lib/backgrounds.ts for why photographs are not checked in. */
export const EFFECTS: Effect[] = [
  { id: "none", kind: "none", label: "None" },
  { id: "blur", kind: "blur", label: "Blur" },
  ...SLOTS.map((s): Effect => ({ id: s.id, kind: "image", label: s.label, src: s.drawn, photo: s.photo })),
  { id: CUSTOM_ID, kind: "image", label: "Your photo", src: CUSTOM_PLACEHOLDER, custom: true },
];

/** The picture an effect should actually use. `custom` is whatever the person
 *  added; everything else is its own. Pure, because "which image" turning out
 *  to be the wrong one is exactly the class of bug that shipped four
 *  identical backdrops. */
export function effectSrc(effect: Effect, customDataUrl?: string): string {
  if (!effect) return "";
  if (effect.custom) return String(customDataUrl || "") || String(effect.src || "");
  return String(effect.src || "");
}

/** Has this person actually put a picture in their own slot? An empty slot
 *  must not be applied — it would replace their room with a picture of a
 *  camera icon, which is worse than doing nothing. */
export function customReady(effect: Effect, customDataUrl?: string): boolean {
  if (!effect?.custom) return true;
  return String(customDataUrl || "").startsWith("data:image/");
}

export function effectById(id: string): Effect {
  return EFFECTS.find((e) => e.id === String(id || "")) || EFFECTS[0];
}

/** What to restore on the next join. Reads the new key's value, and honours
 *  the legacy "qm.blur" flag ("1") from before backgrounds existed — an
 *  upgrade must not silently un-blur somebody who chose blur. */
export function restoreEffect(saved: string, legacyBlur?: string): Effect {
  const s = String(saved || "").trim();
  if (s) return effectById(s);
  if (String(legacyBlur || "") === "1") return effectById("blur");
  return EFFECTS[0];
}

/** Can this browser run background effects at all? Pure mirror of the real
 *  checks the processor package makes, so the UI can say WHY before trying —
 *  and the message never promises Safari, because Safari doesn't ship
 *  MediaStreamTrackGenerator. */
export function effectSupport(env: {
  trackGenerator: boolean;
  trackProcessor: boolean;
  offscreenCanvas: boolean;
}): { ok: boolean; why: string } {
  if (env.trackGenerator && env.trackProcessor && env.offscreenCanvas) {
    return { ok: true, why: "" };
  }
  return {
    ok: false,
    why: "This browser can't run background effects. Chrome and Edge can; Safari and Firefox can't yet. Your plain video still works everywhere.",
  };
}

/** The parameters the component hands to the processor package. Pure mapping,
 *  so the choice of blur radius and the none/blur/image decision are guarded. */
export function processorFor(effect: Effect, customDataUrl?: string):
  | { kind: "none" }
  | { kind: "blur"; blurRadius: number }
  | { kind: "image"; imagePath: string; photo?: string } {
  if (effect.kind === "blur") return { kind: "blur", blurRadius: 12 };
  if (effect.kind === "image") {
    const src = effectSrc(effect, customDataUrl);
    // An empty custom slot is NOT an image effect — applying it would put a
    // picture of a camera icon behind somebody.
    if (src && customReady(effect, customDataUrl)) {
      return { kind: "image", imagePath: src, photo: effect.photo };
    }
  }
  return { kind: "none" };
}

/** LiveKit reports pre-join device failures as an enum WITHOUT saying which
 *  device — so these words honestly name both instead of guessing one. The
 *  old handler described every failure as a microphone problem, which sent a
 *  Windows user whose camera was held by Teams off to debug his mic. */
export function deviceFailText(failure?: string | null): string {
  switch (String(failure || "")) {
    case "PermissionDenied":
      return "Your browser is blocking the camera or microphone. Click the padlock in the address bar, set Camera and Microphone to Allow, then reload.";
    case "NotFound":
      return "No camera or microphone was found. Plug one in, or check it isn't disabled in your system settings, then reload.";
    case "DeviceInUse":
      return "Another app is already using your camera or microphone — on Windows, check the tray for Teams, Zoom or the Camera app, quit it, then reload. The device light being on usually means the other app has it.";
    case "":
      return "";
    default:
      return "Your camera or microphone couldn't be started. Reload the page, or pick different devices from the Devices panel.";
  }
}

/** Words for LiveKitRoom's onError, which fires for BOTH connection failures
 *  and device failures. Only name a device when the error is genuinely a
 *  getUserMedia one; a websocket failure described as a microphone problem
 *  is a lie with a fix attached. */
export function joinErrorText(name?: string | null, message?: string | null): string {
  const n = String(name || "");
  const m = String(message || "");
  if (/NotAllowed|NotReadable|NotFound|OverConstrained|TrackStart|DevicesNotFound|PermissionDenied/i.test(n)) {
    return deviceFailText(
      /NotAllowed|PermissionDenied/i.test(n) ? "PermissionDenied"
        : /NotFound|DevicesNotFound/i.test(n) ? "NotFound"
        : /NotReadable|TrackStart/i.test(n) ? "DeviceInUse"
        : "Other"
    );
  }
  return `Couldn't connect to the meeting${m ? ` (${m.slice(0, 80)})` : ""}. Check your connection and reload — nobody can see or hear you until this page reconnects.`;
}

/** Backoff for bringing a dead camera back: fast first, then slower, then
 *  stop and ask — a loop that retries forever burns a machine already having
 *  a bad day. */
export function camRetryDelay(attempt: number): number {
  const steps = [500, 2000, 5000];
  return attempt < steps.length ? steps[attempt] : 0;
}

export function camShouldKeepTrying(attempt: number): boolean {
  return camRetryDelay(attempt) > 0;
}
