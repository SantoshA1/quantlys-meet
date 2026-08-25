// Where this deployment actually lives, and what still leaves the building.
//
// PHASE 0, 2026-08-18. We stood up livekit-server 1.9.12 from one binary and
// one config file — no LiveKit account — and ran this app against it with two
// real browsers. It worked: 24/24, audio energy 1.81 and 198 video frames
// decoded across the self-hosted SFU, with no code change, only environment
// variables. So "run your own meetings server" is a true sentence.
//
// Two things that spike found, which this module exists to say out loud:
//
//  1. The single binary does NOT do recording. Egress is a separate service.
//     Calling it without one does not fail fast — it hangs for TWENTY-THREE
//     SECONDS and then returns 503 "no response from servers". A host who
//     presses Record gets almost half a minute of nothing. Every probe here
//     is therefore on a short leash, and "absent" is a first-class answer
//     rather than an error nobody can read.
//
//  2. Self-hosting the SFU is not the same as self-hosting the meeting.
//     A company that moved its media in-house for security reasons is still
//     shipping audio to Deepgram, or to Google via the browser's speech API,
//     and the transcript to a model vendor. Nobody is lying to them; nobody
//     has told them either. `dataLeaving()` tells them, by name.
//
// Everything above `checkMeeting` is pure so it can be proved offline.

export type Hosting = "cloud" | "self" | "none";

export type Step = {
  // "names" joined 2026-08-25: putting the real name on each voice is its own
  // step, and its own thing to succeed or fail at, because "Speaker 2" has
  // several possible causes and a person deserves to be told which one.
  key: "transcribe" | "names" | "notes" | "email" | "storage" | "items" | "meeting" | "recording";
  label: string;
  ok: boolean;
  detail: string;
};

/** A pre-flight that takes longer than this is not a pre-flight. */
export const PROBE_MS = 4000;

/** Read the realtime URL the same way every route in the app reads it. */
export function realtimeUrl(env: Record<string, string | undefined> = process.env as any): string {
  return (
    env.NEXT_PUBLIC_LIVEKIT_URL ||
    env.LIVEKIT_URL ||
    env.LIVEKIT_WS_URL ||
    ""
  ).trim();
}

/** Cloud, someone's own machine, or nothing configured at all. */
export function hostingKind(url: string): Hosting {
  const u = (url || "").trim();
  if (!u) return "none";
  // Match the host, not the whole string: a self-hosted box could be called
  // "livekit.cloudy-widgets.internal" and must not be read as the vendor.
  let host = "";
  try {
    host = new URL(u.replace(/^ws/, "http")).hostname.toLowerCase();
  } catch {
    return "none";
  }
  if (!host) return "none";
  if (host === "livekit.cloud" || host.endsWith(".livekit.cloud")) return "cloud";
  return "self";
}

/** The HTTP origin of a ws:// or wss:// realtime URL, for probing. */
export function httpOrigin(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  try {
    return new URL(u.replace(/^ws/, "http")).origin;
  } catch {
    return "";
  }
}

export function hostingNote(kind: Hosting, url: string): string {
  if (kind === "none") return "No meeting server is configured, so nobody can join anything.";
  if (kind === "cloud") return `Meetings run on LiveKit Cloud (${httpOrigin(url)}). Media passes through their infrastructure.`;
  return `Meetings run on your own server (${httpOrigin(url)}). Media does not leave your infrastructure.`;
}

/** Can anyone join a meeting at all? Built from a probe result, not from IO. */
export function meetingStep(input: {
  url: string;
  key?: string;
  secret?: string;
  reachable?: boolean | null;   // null = not probed
  status?: number;
}): Step {
  const base: Step = { key: "meeting", label: "Let people into the meeting", ok: false, detail: "" };
  const kind = hostingKind(input.url);

  if (kind === "none") {
    return {
      ...base,
      detail:
        "No LIVEKIT_URL is set, so the join button cannot hand anyone a token. " +
        "Point it at LiveKit Cloud, or at a livekit-server you run yourself — " +
        "the app does not care which, and never has.",
    };
  }
  if (!input.key || !input.secret) {
    return {
      ...base,
      detail:
        "LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing, so tokens cannot be signed " +
        "and every join will be refused. On a self-hosted server these are the values " +
        "in the `keys:` block of your config file — you choose them.",
    };
  }
  if (input.reachable === false) {
    return {
      ...base,
      detail:
        `${httpOrigin(input.url)} did not answer` +
        (input.status ? ` (HTTP ${input.status})` : " within " + PROBE_MS / 1000 + " seconds") +
        ". Nobody can join until it does. If you run it yourself, check the process is up " +
        "and the port is open; the app is fine.",
    };
  }
  if (input.reachable === null || input.reachable === undefined) {
    return { ...base, ok: true, detail: hostingNote(kind, input.url) + " Not checked just now." };
  }
  return { ...base, ok: true, detail: hostingNote(kind, input.url) };
}

/**
 * Recording is the step most likely to be missing on a self-hosted install,
 * because it is a second service nobody mentions until the day it matters.
 */
export function recordingStep(input: {
  url: string;
  egress: "ok" | "absent" | "unreachable" | "unknown";
}): Step {
  const base: Step = { key: "recording", label: "Record the meeting", ok: false, detail: "" };
  const kind = hostingKind(input.url);

  if (kind === "none") {
    return { ...base, detail: "There is no meeting server, so there is nothing to record." };
  }
  if (input.egress === "ok") {
    return { ...base, ok: true, detail: "Recording is available." };
  }
  if (input.egress === "absent") {
    return {
      ...base,
      detail:
        kind === "self"
          ? "Your server is running but the recorder is not. livekit-server does not record on its " +
            "own — recording is a separate `livekit-egress` service (it needs Redis and somewhere " +
            "to put the file). Until it is running, pressing Record waits about twenty seconds and " +
            "then fails. Everything else about the meeting works."
          : "LiveKit accepted the request but no recorder answered. This usually clears by itself; " +
            "if it doesn't, recording is disabled on this project.",
    };
  }
  if (input.egress === "unreachable") {
    return { ...base, detail: `Couldn't reach ${httpOrigin(input.url)} to ask about recording.` };
  }
  return { ...base, ok: true, detail: "Recording was not checked just now." };
}

/**
 * The honest list for anyone who moved their meetings in-house for privacy.
 * Self-hosting the SFU stops the MEDIA leaving. It does not stop the words.
 */
export function dataLeaving(env: Record<string, string | undefined> = process.env as any): string[] {
  const out: string[] = [];
  const kind = hostingKind(realtimeUrl(env));

  if (kind === "cloud") {
    out.push("Live audio and video pass through LiveKit Cloud.");
  }
  if (env.DEEPGRAM_API_KEY) {
    out.push("Meeting audio is uploaded to Deepgram to be transcribed.");
  } else {
    // The fallback is the one people don't know about, and it is the worst of
    // the options for someone whose whole reason for self-hosting is privacy.
    out.push(
      "With no DEEPGRAM_API_KEY, live captions fall back to the browser's speech " +
      "recognition — which in Chrome sends the audio to Google."
    );
  }
  if (env.OPENROUTER_API_KEY) {
    out.push("The transcript is sent to OpenRouter, and on to whichever model writes the notes.");
  } else if (env.OPENAI_API_KEY) {
    out.push("The transcript is sent to OpenAI to write the notes.");
  }
  if (env.RESEND_API_KEY) {
    out.push("Notes are emailed through Resend, so the summary passes through their servers.");
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL && !/localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_SUPABASE_URL)) {
    out.push("Recordings, transcripts and notes are stored in hosted Supabase.");
  }
  return out;
}

/** One line for the top of the page: nothing, or an honest count. */
export function privacyHeadline(leaks: string[], kind: Hosting): string {
  if (kind === "self" && leaks.length === 0) {
    return "Nothing in this meeting leaves your infrastructure.";
  }
  if (leaks.length === 0) return "";
  if (kind === "self") {
    return leaks.length === 1
      ? "Your media stays in-house, but one thing still leaves it."
      : `Your media stays in-house, but ${leaks.length} things still leave it.`;
  }
  return leaks.length === 1 ? "One outside service handles your meeting data." : `${leaks.length} outside services handle your meeting data.`;
}

/**
 * Where to put an environment variable — which is NOT the same sentence
 * everywhere. PHASE 0 caught the app telling a woman running livekit-server
 * on her own hardware to "add it in Vercel → Settings", a product she has
 * never used. Advice that names the wrong building is worse than none: she
 * goes looking for a screen that does not exist and concludes the app is
 * broken.
 */
export function whereToSetEnv(env: Record<string, string | undefined> = process.env as any): string {
  if (env.VERCEL || env.VERCEL_ENV) {
    return "Add it in Vercel → Settings → Environment Variables, then redeploy — " +
           "a new variable only reaches code on the next build.";
  }
  if (env.KUBERNETES_SERVICE_HOST) {
    return "Add it to the deployment's environment (a Secret or ConfigMap) and roll the pods — " +
           "a new variable only reaches code on restart.";
  }
  if (env.DOCKER_CONTAINER || env.container) {
    return "Add it to the container's environment and restart it — " +
           "a new variable only reaches code on restart.";
  }
  return "Set it in this app's environment — a .env file beside the app, or your " +
         "service manager's config — then restart it. A new variable only reaches " +
         "code on restart.";
}

// ── the thin IO layer ────────────────────────────────────────────────────

async function head(url: string, ms = PROBE_MS): Promise<{ ok: boolean; status: number }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    return { ok: r.status < 500, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Is the realtime server there? Answers in PROBE_MS or says it couldn't. */
export async function checkMeeting(): Promise<Step> {
  const url = realtimeUrl();
  const origin = httpOrigin(url);
  if (!origin) return meetingStep({ url });
  const probe = await head(origin + "/");
  return meetingStep({
    url,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
    reachable: probe.ok,
    status: probe.status,
  });
}

/**
 * Ask whether a recorder exists WITHOUT starting a recording. ListEgress is
 * the cheap question; starting one is the twenty-three-second one.
 */
export async function checkRecording(): Promise<Step> {
  const url = realtimeUrl();
  const origin = httpOrigin(url);
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!origin || !key || !secret) return recordingStep({ url, egress: "unknown" });

  try {
    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(key, secret, { identity: "healthcheck", ttl: "1m" });
    at.addGrant({ roomRecord: true });
    const jwt = await at.toJwt();
    const r = await fetch(origin + "/twirp/livekit.Egress/ListEgress", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: "{}",
      signal: AbortSignal.timeout(PROBE_MS),
      cache: "no-store",
    });
    if (r.ok) return recordingStep({ url, egress: "ok" });
    // 500/503 from a healthy livekit-server means nothing answered on the
    // egress bus — the service simply is not deployed.
    if (r.status >= 500) return recordingStep({ url, egress: "absent" });
    return recordingStep({ url, egress: "unreachable" });
  } catch {
    return recordingStep({ url, egress: "unreachable" });
  }
}
