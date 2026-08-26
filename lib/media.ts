// Microphones, cameras, and the ways they fail quietly.
//
// FIELD 2026-08-18, and it cost a real meeting: he had to abandon Quantlys
// mid-call and move his team to Google Meet. Two symptoms:
//
//   1. "webcam is on but the preview was not visible to a team member"
//   2. "people had trouble listening to me — I could hear them, they could
//      not hear me"
//
// Both trace to the same line of code. The room was mounted as
//
//     <LiveKitRoom connect video audio />
//
// which is LiveKit's hello-world. It takes whatever the browser calls
// "default" at the moment you join, publishes it, and then never looks at it
// again. There is no device memory, no error handler, and — the expensive one
// — nothing watching whether the track it is publishing is still alive.
//
// THE BLUETOOTH MECHANISM, precisely, because the fix follows from it:
// a Bluetooth headset on Windows is TWO devices. A2DP is the good-sounding,
// output-only profile. HFP/HSP is the low-bandwidth one that has a microphone
// in it. Windows switches between them when an application opens the mic —
// and when that switch happens, or the headset drops for a second, or another
// app grabs it, the MediaStreamTrack the browser handed us ENDS.
//
// WebRTC does not care. The publication stays up. Opus keeps encoding an empty
// signal. Everyone in the room still sees you un-muted, with no warning icon,
// and you carry on talking. You can still hear them, because receiving is
// completely unaffected — which is exactly the asymmetry he described.
//
// So: this module is the part that can be reasoned about and tested without a
// browser. The rule it exists to enforce is that a control which says ON must
// be checked against what is actually leaving the machine.

// ── what went wrong, in words a person can act on ──────────────────────────

export type MediaKind = "audioinput" | "videoinput" | "audiooutput";

export type Explained = {
  /** machine-readable, so the UI can decide whether to offer a retry */
  code: "denied" | "inuse" | "missing" | "constraints" | "insecure" | "hardware" | "unknown";
  what: string;
  fix: string;
};

/** Every getUserMedia rejection, named.
 *
 *  The one that mattered here is NotReadableError. On Windows it means another
 *  application already holds the camera — Teams left running, Zoom in the
 *  background, the Camera app, a virtual-camera driver. The webcam LED comes
 *  ON, because the other program lit it, and the person reasonably concludes
 *  their camera is working and ours is broken. Nobody sees them. Saying the
 *  words "another app is using it" turns a twenty-minute mystery into a
 *  five-second fix, and no meeting app can afford to leave that unsaid. */
export function describeMediaError(err: any, kind: MediaKind = "audioinput"): Explained {
  const thing = kind === "videoinput" ? "camera" : kind === "audiooutput" ? "speaker" : "microphone";
  const name = String(err?.name || err?.constructor?.name || "").trim();
  const msg = String(err?.message || err || "");

  if (/NotAllowed|PermissionDenied|SecurityError.*permission/i.test(name)) {
    return {
      code: "denied",
      what: `Your browser is blocking access to your ${thing}.`,
      fix: `Click the padlock (or camera icon) in the address bar, set ${thing === "camera" ? "Camera" : "Microphone"} to Allow, then rejoin.`,
    };
  }
  if (/NotReadable|TrackStart/i.test(name) || /in use|could not start/i.test(msg)) {
    return {
      code: "inuse",
      what: `Another app is already using your ${thing}, so this meeting can't.`,
      fix:
        thing === "camera"
          ? "Quit Zoom, Teams, the Camera app or any other video app — including ones minimised to the system tray — then press Retry. The camera light being on usually means the other app has it, not that you're on screen here."
          : "Quit any other app that might be holding the microphone, then press Retry. On Windows, check the system tray for apps still running in the background.",
    };
  }
  if (/NotFound|DevicesNotFound/i.test(name)) {
    return {
      code: "missing",
      what: `No ${thing} was found on this computer.`,
      fix: `Plug one in, or check Settings → Sound${thing === "camera" ? " / Camera" : ""} to see whether it's disabled.`,
    };
  }
  if (/OverConstrained|ConstraintNotSatisfied/i.test(name)) {
    return {
      code: "constraints",
      what: `The ${thing} you used last time isn't here any more.`,
      fix: `Pick a different ${thing} from the list and it will be remembered.`,
    };
  }
  if (/SecurityError/i.test(name) || /https/i.test(msg)) {
    return {
      code: "insecure",
      what: "Browsers only allow camera and microphone access over a secure connection.",
      fix: "Open this meeting on its https:// address.",
    };
  }
  if (/Abort|Invalid/i.test(name)) {
    return {
      code: "hardware",
      what: `Your ${thing} stopped responding — usually a driver or a Bluetooth hiccup.`,
      fix: "Press Retry. If it keeps happening, unpair and re-pair the device, or switch to a wired one for this call.",
    };
  }
  // FIELD 2026-08-25: this rendered as "Your camera couldn't be started
  // (Error)." — because the thrown thing's constructor is literally named
  // Error. Naming a class "Error" tells a person nothing at all; it just looks
  // like the app knows something it will not say. A generic name is dropped,
  // and the MESSAGE is shown instead when there is one worth reading.
  //
  // AND THE SECOND HALF, which the first attempt at this fix walked straight
  // into: `msg` falls back to String(err), and String(new Error("")) is the
  // string "Error". So dropping the generic NAME and showing the message
  // instead put the same useless word back. Both are filtered.
  const isGeneric = (v: string) => /^(Error|TypeError|RangeError|DOMException|Object|String|Number|Boolean|Function|undefined|null|\[object \w*\]|)$/i.test(String(v || "").trim());
  const detail = !isGeneric(name) ? name : (isGeneric(msg) ? "" : msg.trim().slice(0, 90));
  return {
    code: "unknown",
    what: `Your ${thing} couldn't be started${detail ? ` — ${detail}` : ""}.`,
    fix: "Press Retry, or pick a different device from the list.",
  };
}

// ── the constraints, and the one word that decides whether a dropout is a
//    blip or the rest of the meeting ───────────────────────────────────────

/** THE IMPORTANT DETAIL: `deviceId: { ideal }`, never `{ exact }`.
 *
 *  With `exact`, the moment the remembered device disappears — the headset
 *  goes to sleep, the dock is unplugged, Windows renumbers a USB port —
 *  getUserMedia throws OverconstrainedError and you get NOTHING. Silence for
 *  the rest of the call, with the mic button still lit.
 *
 *  With `ideal`, the browser takes the next best microphone and you stay in
 *  the meeting. That is the whole difference between "you cut out for a
 *  second" and "nobody heard you after 10:04". */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,   // the reason people say "you're very quiet"
  };
  if (deviceId && deviceId !== "default") (c as any).deviceId = { ideal: deviceId };
  return c;
}

export function videoConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId && deviceId !== "default") (c as any).deviceId = { ideal: deviceId };
  return c;
}

// ── reading a device list a human can use ─────────────────────────────────

export type Device = { deviceId: string; label: string; kind: string };

/** Chrome hands back `"Default - Microphone (Realtek(R) Audio) (10ec:0289)"`.
 *  Nobody needs the hardware ids, and before permission is granted the label
 *  is an empty string — which renders as a blank row that looks broken. */
export function deviceLabel(d: Device | undefined, index = 0, kind: MediaKind = "audioinput"): string {
  const thing = kind === "videoinput" ? "Camera" : kind === "audiooutput" ? "Speaker" : "Microphone";
  let s = String(d?.label || "").trim();
  if (!s) return `${thing} ${index + 1}`;
  s = s.replace(/^(Default|Communications)\s+-\s+/i, "");
  s = s.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "");
  return s.trim() || `${thing} ${index + 1}`;
}

/** Which device to use. Returns the choice AND whether the remembered one
 *  vanished, because silently using a different microphone from the one
 *  somebody picked is how you end up broadcasting your laptop lid. */
export function pickDevice(
  devices: Device[],
  savedId?: string
): { id: string; device?: Device; savedIsGone: boolean } {
  const list = (devices || []).filter((d) => d && d.deviceId);
  if (!list.length) return { id: "", savedIsGone: Boolean(savedId) };
  if (savedId) {
    const found = list.find((d) => d.deviceId === savedId);
    if (found) return { id: found.deviceId, device: found, savedIsGone: false };
  }
  const dflt = list.find((d) => d.deviceId === "default") || list[0];
  return { id: dflt.deviceId, device: dflt, savedIsGone: Boolean(savedId) };
}

/** Bluetooth changes the advice, so it is worth knowing. A Bluetooth mic that
 *  goes quiet is almost always the HFP profile switch, and the reliable fix is
 *  different from the fix for a USB mic. */
export function isBluetooth(label: string): boolean {
  return /bluetooth|airpod|wireless|headset|buds|beats|jabra|bose|sony wh|galaxy bud/i.test(
    String(label || "")
  );
}

// ── the level meter, and the watchdog it feeds ────────────────────────────

/** RMS from getByteTimeDomainData, where 128 is silence. Returned 0..1.
 *  Pure, so the thing that decides "your microphone is dead" can be tested
 *  without a microphone. */
export function levelFrom(bytes: Uint8Array | number[]): number {
  const n = bytes?.length || 0;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = (Number(bytes[i]) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / n) * 2.2);
}

/** Anything under this is indistinguishable from a disconnected microphone.
 *  A live mic in a silent room still shows electrical noise above it. */
export const FLOOR = 0.012;

/** RETIRED AS A FAULT THRESHOLD, 2026-08-25, and kept named so the mistake is
 *  not repeated.
 *
 *  FIELD, with a screenshot: "We can't hear anything from your microphone.
 *  Nothing has come from Logitech BRIO for 838 seconds." Fourteen minutes.
 *  And in the SAME screenshot, the live notes panel is full of that person
 *  talking — 30:32, 30:35, 30:48, 31:11, 31:33, 31:52, 32:07. Everyone could
 *  hear him. The captions were transcribing him. The app told him nobody
 *  could hear him, every thirty seconds, for a quarter of an hour.
 *
 *  TWO SEPARATE ERRORS, and the first is the serious one:
 *
 *  1. THE METER WASN'T MEASURING. The level comes from an AudioContext
 *     analyser built in a try/catch that swallows its own failure — and when
 *     it fails, `analyser` is null, the tick loop never updates `lastSound`,
 *     and the "quiet for N seconds" counter climbs for ever while the person
 *     talks. No evidence about the level was being treated as evidence of
 *     silence. That is the same shape of bug as blaming a microphone for a
 *     dropped connection: absence of a signal is not a negative signal.
 *
 *  2. TWENTY SECONDS OF QUIET IS NOT A FAULT. It is what LISTENING sounds
 *     like. In a three-person meeting each person is quiet for most of it, by
 *     definition. Only a microphone that has NEVER produced a sound is worth
 *     mentioning, and even then only after long enough that the person has
 *     plainly had a turn.
 *
 *  Kept as the export name because other code imports it; it is now the
 *  "never heard anything at all" window, not the "you stopped talking" one. */
export const QUIET_MS = 120000;

/** Below this a reading is indistinguishable from DIGITAL ZERO. A live
 *  microphone in a silent room still has a noise floor — the room, the
 *  preamp, the person breathing. A muted-in-hardware or dead one reads
 *  nothing at all. That difference, not "how loud", is what separates a
 *  broken microphone from a quiet one. */
export const DEAD_FLOOR = 0.0008;

export type MicState = {
  /** the person pressed mute — this is never a fault */
  mutedByUser: boolean;
  /** the MediaStreamTrack has ended: the device is gone */
  ended: boolean;
  /** the OS muted the track under us — a Bluetooth profile switch does this */
  mutedBySystem: boolean;
  /** ms since we last saw any sound at all */
  quietMs: number;
  /** loudest level seen recently, 0..1 */
  peak: number;
  /** is there a published microphone at all */
  publishing: boolean;
  /** IS THE METER ACTUALLY RUNNING? False means we have no idea how loud this
   *  microphone is, and "no idea" must never render as "silent" — see the
   *  post-mortem above QUIET_MS. */
  metering?: boolean;
  /** has this microphone produced ANY sound since it was published? Once it
   *  has, going quiet is a person listening, and never a fault. */
  everHeard?: boolean;
  /** how many times we have already tried to bring it back */
  attempts: number;
  /** how many times we have already RESTARTED the microphone because it went
   *  quiet — deliberately separate from `attempts`, which counts failures.
   *  A restart that succeeds and still produces silence must not be tried
   *  again every twenty seconds for the rest of the meeting; one attempt,
   *  then we stop and ask. */
  quietFixes?: number;
  label?: string;
};

export type Verdict = {
  level: "ok" | "warn" | "dead";
  title: string;
  detail: string;
  action: "none" | "recover" | "pick";
};

/** The whole point of this file.
 *
 *  Ordered so that the honest states come first: a person who muted
 *  themselves is not broken, and telling them "nobody can hear you" is the
 *  alarm that teaches everybody to ignore alarms. */
export function micVerdict(s: MicState): Verdict {
  if (s.mutedByUser) {
    return { level: "ok", title: "Muted", detail: "You're muted. Nobody can hear you — press the microphone button to talk.", action: "none" };
  }
  if (!s.publishing) {
    return {
      level: "dead",
      title: "No microphone is being sent",
      detail: "Your microphone isn't being sent to the meeting. Nobody can hear you.",
      action: s.attempts >= 3 ? "pick" : "recover",
    };
  }
  if (s.ended || s.mutedBySystem) {
    const bt = isBluetooth(s.label || "");
    return {
      level: "dead",
      title: "Your microphone stopped",
      detail: bt
        ? `${s.label || "Your Bluetooth headset"} dropped out of the call. This is the usual Bluetooth one — the headset switches audio profiles and the microphone goes dead while the sound still plays. Reconnecting it now.`
        : `${s.label || "Your microphone"} stopped sending. Reconnecting it now — if this keeps happening, pick a different microphone below.`,
      action: s.attempts >= 3 ? "pick" : "recover",
    };
  }
  // THE THREE CONDITIONS, all of which have to hold before this app tells
  // somebody in a live meeting that nobody can hear them. Getting any one of
  // them wrong produces the 838-second screenshot.
  //
  //   · the meter is genuinely running, so "silent" is a measurement rather
  //     than the absence of one;
  //   · this microphone has never produced a sound at all — if it has, the
  //     person is listening, which is what people do in meetings;
  //   · the reading is DIGITAL ZERO, not merely quiet. A live mic in a silent
  //     room has a noise floor; a dead one does not.
  const meterWorking = s.metering !== false;
  const neverHeard = s.everHeard !== true;
  const trulySilent = s.peak <= DEAD_FLOOR;
  if (meterWorking && neverHeard && trulySilent && s.quietMs >= QUIET_MS) {
    return {
      level: "warn",
      title: "We haven't heard anything from your microphone yet",
      detail: isBluetooth(s.label || "")
        ? `${s.label || "Your microphone"} hasn't picked up a sound since you joined. If you've tried to speak, nobody heard you. Bluetooth headsets often need picking again from the list below.`
        : `${s.label || "Your microphone"} hasn't picked up a sound since you joined. If you've tried to speak, nobody heard you — check it isn't muted in hardware, or pick a different one below.`,
      // FIELD 2026-08-24: one automatic restart before asking, because the
      // commonest Bluetooth failure leaves a track that is neither ended nor
      // muted and simply produces nothing.
      action: (s.quietFixes || 0) < 1 ? "recover" : "pick",
    };
  }
  return { level: "ok", title: "Microphone working", detail: "", action: "none" };
}

/** A meter that reads as a meter. Discrete segments, so a small real signal is
 *  visibly different from nothing at all — a continuous bar at 3% looks the
 *  same as a continuous bar at 0%, which is the exact distinction the person
 *  is trying to make. */
export function bars(level: number, n = 12): boolean[] {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * n);
  return Array.from({ length: n }, (_, i) => i < lit);
}

/** Backoff for bringing a dead microphone back. Fast on the first try because
 *  somebody is mid-sentence; then slower, then stop and ask — a loop that
 *  retries for ever burns the CPU of a machine already having a bad day. */
export function retryDelay(attempt: number): number {
  const steps = [400, 1500, 4000];
  return attempt < steps.length ? steps[attempt] : 0;
}

export function shouldKeepTrying(attempt: number): boolean {
  return retryDelay(attempt) > 0;
}

// ── the connection, in plain words ────────────────────────────────────────

export function connectionAdvice(quality: string): string {
  switch (String(quality || "").toLowerCase()) {
    case "poor":
      return "Your connection is struggling. Others may hear you break up — turning your camera off usually fixes the audio.";
    case "lost":
      return "Your connection dropped. Trying to get back in — nobody can hear or see you until it returns.";
    default:
      return "";
  }
}

/** setSinkId — choosing which speaker plays the meeting — exists in Chrome
 *  and Edge and not in Firefox or Safari. A picker that silently does nothing
 *  is worse than no picker, so the UI asks first. */
export function speakerPickerWorks(el?: any): boolean {
  if (typeof el?.setSinkId === "function") return true;
  if (typeof HTMLMediaElement === "undefined") return false;
  return typeof (HTMLMediaElement.prototype as any)?.setSinkId === "function";
}

export function speakerNote(works: boolean): string {
  return works
    ? "Choose which speaker or headset plays the meeting."
    : "This browser can't choose an output device — the meeting plays through whatever your computer's sound settings say. Chrome and Edge can choose; Firefox and Safari can't.";
}
