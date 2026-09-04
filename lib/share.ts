// Local screen-share preview: always show the real tile.
//
// FIELD 2026-08-30 / PR #9 covered EVERY local share with "You're sharing this
// window". PR #16 narrowed that to browser surfaces. Hosts still got a blank
// cover and thought sharing was broken — so the cover is gone entirely.
// Hall-of-mirrors prevention stays in the picker: selfBrowserSurface exclude
// where supported. Remotes are unaffected; the published track is never touched.

export type SharePreviewSettings = {
  displaySurface?: string;
};

/**
 * Always false. Host/local sharer must see the real screen-share video tile.
 * Kept as a named helper so callers and tests stay explicit.
 */
export function shouldCoverLocalSharePreview(
  _settings?: SharePreviewSettings | null
): boolean {
  return false;
}

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
