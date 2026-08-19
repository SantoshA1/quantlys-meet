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
};

/** The built-in backdrops are inline SVGs. Small, sharp at any size, and a
 *  data: URL loads without a network — a background that needs a CDN is a
 *  background that sometimes isn't there. Each SVG declares width/height
 *  because createImageBitmap refuses an SVG with no intrinsic size. */
function svgUrl(body: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${body}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const GRID =
  `<path d="M0 600 L1280 600 M0 640 L1280 640 M0 680 L1280 680 ` +
  `M160 560 L80 720 M320 560 L280 720 M480 560 L470 720 M640 560 L640 720 ` +
  `M800 560 L810 720 M960 560 L1000 720 M1120 560 L1200 720" ` +
  `stroke="#00a99d" stroke-opacity="0.35" stroke-width="2" fill="none"/>`;

export const EFFECTS: Effect[] = [
  { id: "none", kind: "none", label: "None" },
  { id: "blur", kind: "blur", label: "Blur" },
  {
    id: "nebula", kind: "image", label: "Nebula",
    src: svgUrl(
      `<defs><radialGradient id="g" cx="30%" cy="25%" r="90%">` +
      `<stop offset="0%" stop-color="#1b2a4a"/><stop offset="55%" stop-color="#101726"/>` +
      `<stop offset="100%" stop-color="#05070c"/></radialGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#g)"/>` +
      `<circle cx="980" cy="150" r="2.5" fill="#7fe0d6"/><circle cx="1120" cy="330" r="1.8" fill="#8fb7ff"/>` +
      `<circle cx="220" cy="120" r="1.6" fill="#cfd6e4"/><circle cx="420" cy="80" r="2.2" fill="#8fb7ff"/>` +
      `<circle cx="760" cy="60" r="1.5" fill="#cfd6e4"/><circle cx="120" cy="420" r="2" fill="#7fe0d6"/>` +
      `<circle cx="1210" cy="520" r="1.7" fill="#cfd6e4"/><circle cx="640" cy="260" r="1.4" fill="#8fb7ff"/>`
    ),
  },
  {
    id: "gridline", kind: "image", label: "Gridline",
    src: svgUrl(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#0c1220"/><stop offset="100%" stop-color="#04060a"/>` +
      `</linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>` +
      GRID +
      `<circle cx="640" cy="580" r="180" fill="#00a99d" fill-opacity="0.06"/>`
    ),
  },
  {
    id: "dusk", kind: "image", label: "Dusk",
    src: svgUrl(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#241b3a"/><stop offset="60%" stop-color="#3a1f33"/>` +
      `<stop offset="100%" stop-color="#120a14"/></linearGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#g)"/>` +
      `<circle cx="640" cy="470" r="130" fill="#f0b354" fill-opacity="0.5"/>` +
      `<rect y="500" width="1280" height="220" fill="#0c0810"/>`
    ),
  },
  {
    id: "boardroom", kind: "image", label: "Boardroom",
    src: svgUrl(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#1a1f28"/><stop offset="100%" stop-color="#0b0e14"/>` +
      `</linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>` +
      `<rect x="90" y="120" width="300" height="200" rx="6" fill="#232a36"/>` +
      `<rect x="890" y="120" width="300" height="200" rx="6" fill="#232a36"/>` +
      `<rect x="470" y="90" width="340" height="260" rx="6" fill="#141a24" stroke="#2c3342"/>` +
      `<rect y="560" width="1280" height="160" fill="#080a0f"/>`
    ),
  },
];

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
export function processorFor(effect: Effect):
  | { kind: "none" }
  | { kind: "blur"; blurRadius: number }
  | { kind: "image"; imagePath: string } {
  if (effect.kind === "blur") return { kind: "blur", blurRadius: 12 };
  if (effect.kind === "image" && effect.src) return { kind: "image", imagePath: effect.src };
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
