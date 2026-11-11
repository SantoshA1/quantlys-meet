// Per-session time limit for the hosted app.
//
// MEETING_MAX_MINUTES caps how long one live session of a meeting can run.
// Unset, blank, 0, negative or not a number means UNLIMITED — that is the
// self-host default, so a copy that never sets the variable behaves exactly
// as it did before this existed. The hosted app sets it to 60.
//
// The clock is the LiveKit room's own creation time (read on the server),
// not a timer in somebody's tab: refreshing the page or rejoining does not
// reset it. A session ends when the limit is reached; the host may start a
// new session on the same link afterwards (see docs/SELF_HOST.md).
//
// Pure functions only — the server half lives in lib/meeting-cap-server.ts.

/** Minutes-left marks at which the room shows a notice, largest first. */
export const CAP_WARN_MINUTES = [10, 5] as const;

/** The server accepts "time is up" this much early, for clock skew. */
export const CAP_END_SKEW_MS = 5_000;

/** Seconds a freshly minted token outlives the session's remaining time. */
export const CAP_TOKEN_GRACE_S = 120;

type Env = Record<string, string | undefined>;

/** Minutes per session, or 0 for unlimited. */
export function meetingCapMinutes(env: Env = process.env as any): number {
  const raw = env?.MEETING_MAX_MINUTES;
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Anything past a day is "unlimited" in practice; keep the arithmetic sane.
  return Math.min(n, 24 * 60);
}

export type CapWindow = {
  /** false = no limit configured; every other field is then 0/false. */
  limited: boolean;
  capMinutes: number;
  /** ms since epoch the session started (0 when it has not started). */
  startedAt: number;
  /** ms since epoch the session must end (0 when unlimited/not started). */
  endsAt: number;
  /** ms left; Infinity when unlimited, the whole cap when not started. */
  remainingMs: number;
  /** true once the limit has been reached. */
  over: boolean;
};

/**
 * Where a session stands against the cap.
 * startedAt null/0 = the session has not started yet (no live room).
 */
export function capWindow(startedAt: number | null | undefined, now: number, capMinutes: number): CapWindow {
  if (!(capMinutes > 0)) {
    return { limited: false, capMinutes: 0, startedAt: startedAt || 0, endsAt: 0, remainingMs: Infinity, over: false };
  }
  const capMs = Math.round(capMinutes * 60_000);
  if (!startedAt || !(startedAt > 0)) {
    return { limited: true, capMinutes, startedAt: 0, endsAt: 0, remainingMs: capMs, over: false };
  }
  const endsAt = startedAt + capMs;
  const remainingMs = Math.max(0, endsAt - now);
  return { limited: true, capMinutes, startedAt, endsAt, remainingMs, over: now >= endsAt };
}

/** May the server end the session now? (Accepts a few seconds early.) */
export function capEndAllowed(w: CapWindow, skewMs = CAP_END_SKEW_MS): boolean {
  return w.limited && w.startedAt > 0 && w.remainingMs <= skewMs;
}

/**
 * Token lifetime in seconds for a limited session: never longer than the
 * normal lifetime, and never much longer than the time the session has left.
 * Unlimited sessions keep the normal lifetime.
 */
export function capTokenTtlSeconds(w: CapWindow, normalSeconds: number): number {
  if (!w.limited) return normalSeconds;
  const left = Math.ceil(w.remainingMs / 1000) + CAP_TOKEN_GRACE_S;
  return Math.max(60, Math.min(normalSeconds, left));
}

/**
 * Which notice should be on screen with this much time left:
 * 10 or 5 (minutes-left marks), 0 = time is up, null = nothing yet.
 * A cap shorter than a mark starts at the next mark down (a 7-minute cap
 * shows the 5-minute notice at 5 minutes, nothing before).
 */
export function capNoticeDue(remainingMs: number, capMinutes: number): 10 | 5 | 0 | null {
  if (!(capMinutes > 0) || !Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return 0;
  for (let i = CAP_WARN_MINUTES.length - 1; i >= 0; i--) {
    const mark = CAP_WARN_MINUTES[i];
    if (remainingMs <= mark * 60_000) {
      // Only warn at a mark the session actually passes through.
      if (capMinutes > mark || i === CAP_WARN_MINUTES.length - 1) return mark;
    }
  }
  return null;
}

function minutesLabel(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r} minute${r === 1 ? "" : "s"}`;
}

/** The notice text for a mark, using the real minutes left (rounded up). */
export function capNoticeText(remainingMs: number, capMinutes: number): string {
  const left = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `This meeting ends in ${minutesLabel(left)}. Sessions on the hosted app are limited to ${minutesLabel(capMinutes)}.`;
}

/** What everyone sees when the limit ends the session (and on a refused rejoin). */
export function capEndedMessage(capMinutes: number): string {
  const r = Math.round(capMinutes * 10) / 10;
  return `This meeting hit the ${r}-minute limit on the hosted app. Start a new meeting or self-host for unlimited.`;
}

export type CapGate =
  | { ok: true; ttlSeconds: number }
  | { ok: false; status: 403; error: string };

/**
 * The token routes' decision: may this person get a token for the session,
 * and for how long? A session past its limit refuses everyone — a refresh or
 * a rejoin does not buy more time.
 */
export function capGate(w: CapWindow, normalSeconds: number): CapGate {
  if (w.limited && w.over) return { ok: false, status: 403, error: capEndedMessage(w.capMinutes) };
  return { ok: true, ttlSeconds: capTokenTtlSeconds(w, normalSeconds) };
}
