// When a live recording may be stopped and saved.
//
// Tab hide, app switch, lock screen, and bfcache all fire pagehide (and
// sometimes visibilitychange) without the person leaving the meeting. Those
// must not finalize a standup mid-call. A new tab for another room must not
// either — pagehide on the first tab is not "I left".
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
  // pagehide without beforeunload is Safari/Chrome tab hide or app switch,
  // including opening another meeting in a second tab. Keep recording.
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
