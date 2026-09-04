// Local screen-share preview: when to cover it so the meeting does not nest.
//
// FIELD 2026-08-30 / PR #9 covered EVERY local share with "You're sharing this
// window". That was meant only for capturing this meeting's own browser
// surface (a hall of mirrors). Chromium can exclude the current tab from the
// picker (`selfBrowserSurface: "exclude"`), so most shares are a window, a
// monitor, or another tab — and blanking those hides a legitimate preview.
// Remotes are unaffected either way: the class is local-only and the published
// track is never touched.

export type SharePreviewSettings = {
  displaySurface?: string;
};

/**
 * Cover the local preview only when the shared surface would recurse into a
 * browser tab/surface. Window and monitor shares show the real video.
 * Unknown / missing displaySurface → show the preview (selfBrowserSurface
 * exclude already keeps this tab out of the picker where supported).
 */
export function shouldCoverLocalSharePreview(
  settings: SharePreviewSettings | null | undefined
): boolean {
  const surface = String(settings?.displaySurface || "").toLowerCase();
  return surface === "browser";
}

/** Soft cover copy — "tab", not "window", because browser surfaces are tabs. */
export const LOCAL_SHARE_COVER_COPY =
  "You're sharing this tab — others still see it";

/**
 * Chromium accepts selfBrowserSurface on getDisplayMedia; other browsers
 * ignore unknown dictionary members. Always prefer exclude where the call
 * exists — never UA-sniff to deny it.
 */
export function screenShareCaptureDefaults():
  | { selfBrowserSurface: "exclude" }
  | undefined {
  if (typeof navigator === "undefined") return undefined;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    return undefined;
  }
  return { selfBrowserSurface: "exclude" };
}
