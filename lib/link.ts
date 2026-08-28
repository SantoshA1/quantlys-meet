// Whether the meeting is actually connected — and what the app is allowed to
// say about devices while it is not.
//
// FIELD 2026-08-25, from a screenshot that settled it in one frame:
//
//     Disconnected                          ← LiveKit's own toast
//     LINK EXCELLENT                        ← our chip, at the same moment
//     No microphone is being sent           ← our watchdog
//     Your camera isn't being sent          ← our watchdog
//     Your camera couldn't be started (Error).
//
// Reported as "mic/bluetooth keep getting disconnected, people cannot hear —
// feels like latency, and others do not have the same problem". That reading
// was RIGHT and the app's was wrong. The connection dropped. Nothing else did.
//
// WHAT ACTUALLY HAPPENS, in order:
//   1. the network blips — a wifi roam, a VPN re-key, a laptop sleeping a NIC;
//   2. LiveKit loses the room, and every local publication goes with it;
//   3. our device supervisor sees no microphone publication and concludes the
//      MICROPHONE is broken. It says "Nobody can hear you", which is true, and
//      blames the wrong thing, which is not;
//   4. it calls setMicrophoneEnabled on a room that is not connected. That
//      cannot work — you cannot publish into a room you are not in — so it
//      throws, and the throw renders as "Your camera couldn't be started
//      (Error)";
//   5. it tries again every fifteen seconds, for ever, RACING LiveKit's own
//      reconnect-and-republish, which is the one thing that was going to fix
//      this on its own.
//
// And "LINK EXCELLENT" sat there through all of it, because connectionQuality
// keeps its last value when the room goes away — the event that would have
// updated it only fires while connected.
//
// THE RULE THIS FILE EXISTS TO ENFORCE, which this codebase already wrote down
// once and I broke by making the device supervisor always-on:
//
//     a websocket failure described as a microphone problem is a lie with a
//     fix attached.
//
// So: while the room is not connected, the app says exactly one thing — the
// connection is down and nobody can hear you until it is back — and it does
// not touch a device. Devices become trustworthy again a moment AFTER the room
// says it is back, because LiveKit republishes asynchronously and a watchdog
// that fires into that window blames the microphone for the gap.
//
// ZERO-IMPORT, so every rule here is decided without a browser or a network.

/** livekit-client's ConnectionState values, plus the ones its events imply. */
export type RoomState =
  | "disconnected" | "connecting" | "connected" | "reconnecting" | "signalReconnecting";

export type LinkVerdict = {
  /** the chip in the header */
  word: string;
  bars: number;
  level: "ok" | "warn" | "dead";
  /** the banner, when one is warranted */
  title: string;
  detail: string;
  action: "none" | "wait" | "rejoin";
  /** THE GATE. False means the app may not say anything about a microphone or
   *  a camera, and may not try to restart one. */
  trustDevices: boolean;
};

/** How long after the room says it is back before device verdicts are believed
 *  again. LiveKit republishes tracks asynchronously once the signal connection
 *  returns; during that window there genuinely is no microphone publication,
 *  and a watchdog reading that as "your microphone is broken" is the same bug
 *  one layer down. Long enough for a republish on a slow link, short enough
 *  that a headset which really did die is still caught inside a sentence. */
export const REJOIN_GRACE_MS = 4000;

/** A drop this long has stopped being a blip. Below it the honest thing is
 *  "reconnecting" and no action; above it the person deserves to be told this
 *  might not come back on its own. */
export const STUCK_MS = 15000;

export function isConnected(state: string): boolean {
  return String(state || "") === "connected";
}

/** Devices can only be judged when the room is connected AND has been for
 *  longer than the republish window. */
export function trustDevices(state: string, sinceConnectedMs: number): boolean {
  return isConnected(state) && Number(sinceConnectedMs) >= REJOIN_GRACE_MS;
}

export function linkVerdict(s: {
  state: string;
  /** LiveKit's connectionQuality for the local participant */
  quality?: string;
  rttMs?: number | null;
  /** how long the room has been in its current state */
  inStateMs?: number;
  /** how long since the room last reported itself connected */
  sinceConnectedMs?: number;
}): LinkVerdict {
  const state = String(s.state || "");
  const inState = Number(s.inStateMs) || 0;

  if (state === "reconnecting" || state === "signalReconnecting") {
    const stuck = inState >= STUCK_MS;
    return {
      word: "RECONNECTING", bars: 1, level: "warn",
      title: "Reconnecting",
      detail: stuck
        ? "Still trying to get back into the meeting. Nobody can hear or see you until it does — if this does not clear, rejoin."
        : "Your connection dropped for a moment. Nobody can hear or see you until it comes back. Your microphone and camera are fine — don't change them.",
      action: stuck ? "rejoin" : "wait",
      trustDevices: false,
    };
  }

  if (state === "disconnected") {
    return {
      word: "OFFLINE", bars: 0, level: "dead",
      title: "You've left the meeting",
      detail: "You are no longer connected. Nobody can hear or see you. Rejoin to come back — your microphone and camera are not the problem.",
      action: "rejoin",
      trustDevices: false,
    };
  }

  if (state === "connecting" || !state) {
    return {
      word: "CHECKING", bars: 2, level: "ok",
      title: "", detail: "Connecting to the meeting…", action: "none",
      trustDevices: false,
    };
  }

  // Connected. NOW the quality word means something.
  const q = String(s.quality || "unknown").toLowerCase();
  const word = q === "excellent" ? "EXCELLENT" : q === "good" ? "GOOD"
    : q === "poor" ? "POOR" : q === "lost" ? "LOST" : "CHECKING";
  const bars = q === "excellent" ? 4 : q === "good" ? 3 : q === "poor" ? 1 : q === "lost" ? 0 : 2;
  const ms = Number(s.rttMs);
  const rtt = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;

  if (q === "poor" || q === "lost") {
    return {
      word, bars, level: "warn",
      title: "Your connection is struggling",
      detail: q === "lost"
        ? "The meeting has stopped hearing from you. Turning your camera off is the fastest way to get your voice back."
        : `Others may hear you break up${rtt ? ` — round trip is ${rtt}ms` : ""}. Turning your camera off usually fixes the audio.`,
      action: "none",
      trustDevices: trustDevices(state, Number(s.sinceConnectedMs) || 0),
    };
  }

  return {
    word, bars, level: "ok",
    title: "", detail: rtt ? `Round trip to the meeting server is ${rtt}ms.` : "Connection looks healthy.",
    action: "none",
    trustDevices: trustDevices(state, Number(s.sinceConnectedMs) || 0),
  };
}

// ── why the server refused ────────────────────────────────────────────────
//
// FIELD 2026-08-26, from a screenshot:
//
//   "Couldn't connect to the meeting (could not establish signal connection:
//    connection minutes limit exceeded. please). Check your connection and
//    reload — nobody can see or hear you until this page reconnects."
//
// The first half is LiveKit Cloud saying the ACCOUNT has run out of connection
// minutes. The second half is us telling the person to check their wifi.
//
// Their wifi is fine. Reloading will fail identically, for ever, until
// somebody adds minutes to the plan — so "check your connection and reload" is
// not merely unhelpful, it is a loop with no exit that the person will run
// several times before giving up on the product.
//
// This is the same mistake as blaming a microphone for a dropped socket, one
// layer further out: a failure is being described by the code path it arrived
// through rather than by what actually happened. A server that refuses because
// the bill is unpaid, because the token is wrong, and because the network is
// down are three different events with three different answers, and only one
// of them is the person's own connection.

export type JoinFault = "quota" | "auth" | "unreachable" | "unknown";

export type JoinVerdict = {
  fault: JoinFault;
  title: string;
  detail: string;
  /** is there any point pressing Rejoin? */
  retryable: boolean;
};

/** ORDER MATTERS, and the field message is why: it contains BOTH "could not
 *  establish signal connection" AND "connection minutes limit exceeded". Match
 *  the specific cause before the generic transport wrapper it arrived in, or
 *  every quota failure is misread as a network failure. */
export function joinFailure(name?: string | null, message?: string | null): JoinVerdict {
  const text = `${String(name || "")} ${String(message || "")}`.toLowerCase();

  if (/\b(minutes|quota|limit)\b[^.]*\bexceed/.test(text) || /\bexceed[^.]*\b(minutes|quota|limit)\b/.test(text)) {
    return {
      fault: "quota",
      title: "The meeting server is out of capacity",
      detail:
        "This is the meeting service's own limit, not your connection — reloading will not clear it. " +
        "Whoever runs this Quantlys deployment needs to top up the plan (or point it at a self-hosted server). " +
        "Everything you recorded before now is safe.",
      retryable: false,
    };
  }

  if (/\b(invalid|expired|unauthor|forbidden|permission denied|bad token)\b/.test(text)) {
    return {
      fault: "auth",
      title: "This meeting link isn't valid any more",
      detail:
        "The pass this page uses to join has expired or was refused. Reload to get a fresh one — " +
        "if that keeps happening, ask the host for a new link.",
      retryable: true,
    };
  }

  if (/\b(network|timeout|timed out|econnrefused|enotfound|dns|offline|unreachable|failed to fetch|signal connection)\b/.test(text)) {
    return {
      fault: "unreachable",
      title: "Couldn't reach the meeting",
      detail:
        "The meeting server didn't answer. Check your connection and reload — nobody can see or hear you until this page reconnects.",
      retryable: true,
    };
  }

  return {
    fault: "unknown",
    title: "Couldn't connect to the meeting",
    detail:
      `${String(message || "").slice(0, 120) || "The server refused the connection."} ` +
      "Reload to try again — nobody can see or hear you until this page reconnects.",
    retryable: true,
  };
}

/** The chip's text. Never says EXCELLENT for a room that is not connected —
 *  which is exactly what the screenshot caught it doing. */
export function chipLabel(v: LinkVerdict, rttMs?: number | null): string {
  const ms = Number(rttMs);
  const showMs = v.level === "ok" && v.word !== "CHECKING" && Number.isFinite(ms) && ms > 0;
  return showMs ? `LINK ${v.word} · ${Math.round(ms)} MS` : `LINK ${v.word}`;
}
