// When a live recording may be stopped and saved.
//
// A hidden page is not a page that left. Locking the screen, switching apps
// or switching tabs fire visibilitychange (hidden), NOT pagehide; pagehide is
// for navigating away, closing the tab, or going into the back-forward cache
// (persisted === true), and some mobile browsers also fire it when they
// discard a backgrounded page. None of the hide cases may finalize a standup
// mid-call, and neither may a new tab for another room. (The old wording said
// a lock screen fires pagehide; it does not, and lib/page-life.ts handles the
// lock through visibilitychange.)
//
// Flush only when the document is actually being discarded: pagehide with
// persisted === false, the page hidden, AND beforeunload already ran for this
// navigation. SPA room changes do not come through here; Conference unmount
// flushes that room because the person left it.

export type PageHideFlushInput = {
  persisted?: boolean;
  visibilityState?: string;
  /** True only after beforeunload for this navigation — a real discard, not a hide. */
  unloadStarted?: boolean;
};

export function shouldFlushOnPageHide(event: PageHideFlushInput): boolean {
  // Back-forward cache: the page is frozen and will be restored.
  if (event.persisted) return false;
  // Hidden alone is tab backgrounding. Do not treat that as leaving.
  if (event.visibilityState !== "hidden") return false;
  // pagehide without beforeunload is not a person leaving (a bfcache entry,
  // a discarded background page). Keep recording.
  if (!event.unloadStarted) return false;
  return true;
}

/** On-screen elapsed seconds from a finish body or summary JSON. Null if absent. */
export function durationSecondsFromSummary(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = Number(o.duration_s ?? o.duration);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
