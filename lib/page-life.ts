// What a locked iPhone does to a meeting, and what the page does about it.
//
// FIELD 2026-10-25: "When Quantlys Meeting is launched in phone and the iphone
// is locked the voice is getting disabled till unlocked."
//
// THE PLATFORM LIMIT, which no web page can change: on iOS, WebKit mutes
// microphone capture for any page that is not visible — Safari and Home
// Screen web apps alike. RealtimeMediaSourceCenter::shouldInterruptAudioOn
// PageVisibilityChange() returns true on iOS unless the HOST APP declares the
// `audio` background mode, and only a native app can declare that. Locked =
// muted, for as long as it is locked. WebKit bugs 241400 and 204681 are the
// same report; 204681 adds that after ~30s the track can END instead.
//
// THE PART THAT IS OURS: what comes back on unlock. WebKit also puts every
// AudioContext into "interrupted" (a state we never checked — only
// "suspended"), a WebSocket can die while the page is frozen, and captions
// were reading a clone of the microphone taken once, at start, which a
// restarted microphone leaves behind. So the voice came back and the
// captions, the recording's audio mix and the level meter could stay dead.
//
// Everything in here is pure or nearly so, so it can be tested without a
// phone. The wiring lives in Conference.tsx and MediaGuard.tsx.

// ── is this a device where hiding the page mutes the microphone? ──────────
/** iPhone, iPod, and iPadOS (which reports itself as a Mac with touch). */
export function isAppleMobile(input: { ua?: string; platform?: string; maxTouchPoints?: number }): boolean {
  const ua = input.ua || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ asks for the desktop site and says "Macintosh". A Mac has no
  // touch screen, so touch points are the tell.
  return /Macintosh/i.test(ua) && (input.maxTouchPoints || 0) > 1;
}

export function onAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return isAppleMobile({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
}

/** Phones and tablets, where LiveKit re-acquires the microphone itself when
 *  the page comes back (its isMobile()). Desktop behaviour must not change. */
export function isMobileDevice(input: { ua?: string; maxTouchPoints?: number }): boolean {
  return isAppleMobile(input) || /Android|Mobi/i.test(input.ua || "");
}

export function onMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return isMobileDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
}

// ── AudioContexts ──────────────────────────────────────────────────────────
/** Anything that is not running and not closed needs a resume. "interrupted"
 *  is WebKit's (now spec'd) state for a locked screen or a phone call;
 *  checking only "suspended" is how a context stayed silent after unlock. */
export function needsResume(state: string | undefined | null): boolean {
  return Boolean(state) && state !== "running" && state !== "closed";
}

type Resumable = { state: string; resume: () => Promise<void> };
const contexts = new Set<Resumable>();

/** Register a context the page should bring back on return. Returns the
 *  unregister — call it where the context is closed. */
export function keepAudioAlive(ac: Resumable | null | undefined): () => void {
  if (!ac) return () => {};
  contexts.add(ac);
  return () => { contexts.delete(ac); };
}

/** Resume every registered context that needs it. Returns how many were
 *  asked. A resume can reject while the interruption lasts; the next return
 *  (or the next tick of whoever owns the context) asks again. */
export function resumeAudioContexts(): number {
  let n = 0;
  contexts.forEach((ac) => {
    if (ac.state === "closed") { contexts.delete(ac); return; }
    if (!needsResume(ac.state)) return;
    n++;
    try { ac.resume().catch(() => {}); } catch { /* next return */ }
  });
  return n;
}

// ── "paused, phone locked" — what everyone else sees ──────────────────────
/** A participant attribute, so it lives on the server while the phone is
 *  asleep. A data-channel beat would stop with the page; an attribute set as
 *  the page hides stays until the page comes back and clears it. */
export const AWAY_ATTR = "qm.away";
export const AWAY_LOCKED = "locked";

export function awayLabel(attrs: Record<string, string> | undefined | null): string {
  return attrs && attrs[AWAY_ATTR] === AWAY_LOCKED ? "paused, phone locked" : "";
}

// ── the supervisor's patience after a return ──────────────────────────────
/** LiveKit re-acquires a muted microphone itself on the visibility change
 *  (LocalTrack.handleAppVisibilityChanged, mobile only). Our supervisor
 *  restarting the same microphone in the same instant is two getUserMedia
 *  calls racing for one device. Give LiveKit this long first. */
export const RETURN_HOLD_MS = 2000;

export function holdAfterReturn(visibleSince: number, now: number, hold = RETURN_HOLD_MS): boolean {
  return visibleSince > 0 && now - visibleSince < hold;
}

/** Should the device supervisors keep their hands off right now?
 *  - An iPhone page that is HIDDEN: the microphone and camera are muted by
 *    iOS. A restart from a hidden page cannot get them back (getUserMedia is
 *    refused or muted again), and an `ended` track during a long lock would
 *    otherwise start one.
 *  - Any phone in the first moments after a return: LiveKit is re-acquiring.
 *  Desktop: never — a background tab still captures, so nothing changes. */
export function devicesSettling(i: { apple: boolean; mobile: boolean; hidden: boolean; visibleSince: number; now: number }): boolean {
  if (i.apple && i.hidden) return true;
  return i.mobile && holdAfterReturn(i.visibleSince, i.now);
}

// ── the recording's clock and its holes ───────────────────────────────────
/** Seconds since the take started, from the wall clock. A setInterval that
 *  counts its own ticks stops counting while the phone is locked, and the
 *  take then claims to be shorter than it was. */
export function elapsedSeconds(startedAt: number, now: number): number {
  if (!startedAt || now <= startedAt) return 0;
  return Math.floor((now - startedAt) / 1000);
}

/** A hide shorter than this is an app-switch blink, not a hole worth a line. */
export const GAP_MIN_S = 3;

export type Gap = { from: number; to: number };   // seconds into the take

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A line in the record, shaped like the flagged-moment lines, so the notes
 *  say there is a hole instead of silently skipping one. */
export function gapLine(g: Gap): { start: number; speaker: number; transcript: string } {
  return {
    start: g.from,
    speaker: -1,
    transcript: `⏸ Recording gap ${mmss(g.from)}–${mmss(g.to)}: the recording device's screen was locked or the app was in the background`,
  };
}

export function closeGap(hiddenAtSec: number, nowSec: number): Gap | null {
  if (hiddenAtSec < 0 || nowSec - hiddenAtSec < GAP_MIN_S) return null;
  return { from: hiddenAtSec, to: nowSec };
}

// ── Deepgram after the socket dies ────────────────────────────────────────
/** Reconnect with a fresh token. Fast first (somebody may be mid-sentence),
 *  then slower; after this many attempts in a row without a single message
 *  back, fall back to the browser's recogniser rather than loop for ever. */
export const DG_MAX_RECONNECTS = 4;

/** A socket only counts as healthy again (and the attempts reset) once it
 *  has stayed open this long. Resetting on the first message let a socket
 *  that answers once and then drops loop for ever, one token per loop, into
 *  a rate-limited endpoint. */
export const DG_HEALTHY_MS = 15_000;

export function dgHealthy(openedAt: number, now: number): boolean {
  return openedAt > 0 && now - openedAt >= DG_HEALTHY_MS;
}

export function dgReconnectDelay(attempt: number): number {
  const steps = [250, 1000, 3000, 6000];
  return steps[Math.min(Math.max(0, attempt), steps.length - 1)];
}

// ── the one-time notice ───────────────────────────────────────────────────
export const LOCK_NOTICE =
  "On iPhone and iPad, locking the screen or switching apps mutes your microphone until you come back — that's iOS, not your connection. Where the browser allows it, we keep the screen awake during the call so it doesn't auto-lock.";
export const LOCK_NOTICE_KEY = "qm.iosLockNotice";

// ── the page going away and coming back ───────────────────────────────────
/** visibilitychange is the signal a lock gives (pagehide is for leaving or
 *  the back-forward cache). pageshow with `persisted` is a page restored from
 *  that cache, which is a return too. Returns the unsubscribe. */
export function subscribePageLife(handlers: { onHide?: () => void; onShow?: () => void }): () => void {
  if (typeof document === "undefined") return () => {};
  const vis = () => {
    if (document.visibilityState === "hidden") handlers.onHide?.();
    else handlers.onShow?.();
  };
  const show = (e: PageTransitionEvent) => { if (e.persisted) handlers.onShow?.(); };
  document.addEventListener("visibilitychange", vis);
  window.addEventListener("pageshow", show);
  return () => {
    document.removeEventListener("visibilitychange", vis);
    window.removeEventListener("pageshow", show);
  };
}

// ── the screen wake lock ──────────────────────────────────────────────────
/** Keep the screen from AUTO-locking during the call. It cannot stop the
 *  side button, and the browser drops the lock whenever the page hides, so
 *  it is re-requested on every return. Feature-detected: where it does not
 *  exist (older iOS, Firefox) this does nothing and says nothing. iOS 16.4+
 *  in Safari; Home Screen web apps from iOS 18.4 (WebKit bug 254545). */
export function createWakeLock(nav: { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void>; released?: boolean }> } } | undefined) {
  let sentinel: { release: () => Promise<void>; released?: boolean } | null = null;
  let wanted = false;
  // One request at a time. Two in flight (a mount and a return in the same
  // moment) used to produce two locks, and release() only knew the second:
  // the first kept the screen on after the call ended.
  let inflight: Promise<boolean> | null = null;
  const request = async (): Promise<boolean> => {
    wanted = true;
    if (!nav?.wakeLock?.request) return false;
    if (sentinel && !sentinel.released) return true;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const s = await nav.wakeLock!.request("screen");
        if (!wanted) { try { await s.release(); } catch {} return false; }
        sentinel = s;
        return true;
      } catch {
        sentinel = null;   // not visible, not allowed, low battery: try on the next return
        return false;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  const release = async () => {
    wanted = false;
    const s = sentinel;
    sentinel = null;
    try { await s?.release(); } catch { /* already gone */ }
  };
  return { request, release, supported: () => Boolean(nav?.wakeLock?.request), held: () => Boolean(sentinel && !sentinel.released) };
}
