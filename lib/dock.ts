// Where a control belongs — and, just as importantly, where it does not.
//
// FIELD 2026-08-20, from a screenshot of a live meeting: "Raise hand / Be
// right back / React is obstructing the view." They were floating in a pill
// across the middle-bottom of the video, over the speaker's chest, on every
// screen, all meeting, whether or not anybody ever pressed them. Three
// buttons nobody had asked for were sitting on the one thing the product is
// for — the picture of the person talking.
//
// The rule this module encodes: a control that is not in use does not get to
// stand in front of the meeting. Controls live in the control bar with the
// other controls; only STATE — a hand actually up, a reaction actually
// flying — is allowed over the video, and only while it is true.
//
// ZERO-IMPORT so it travels.

/** The LiveKit control bar, and the button we want to stand next to. Both
 *  are stable public DOM contracts of @livekit/components-react: the bar is
 *  `.lk-control-bar`, and every TrackToggle carries `data-lk-source`. */
export const BAR = ".lk-control-bar";
export const SCREEN_SHARE = '[data-lk-source="screen_share"]';

/** Where to splice our controls into the bar. Returns the node to insert
 *  BEFORE (insertBefore's second argument), which is null for "append" —
 *  exactly the shape the DOM API wants, so the caller has no branching to
 *  get wrong.
 *
 *  Order in the stock bar is: microphone, camera, screen share, chat,
 *  settings, leave. We want to land immediately AFTER screen share, so we
 *  insert before whatever follows it. When screen sharing is unsupported
 *  (Safari on iOS) the button is absent and we fall back to the front of the
 *  bar rather than after Leave — a control past the Leave button is a
 *  control nobody finds, and one people press by accident on their way to
 *  leaving. */
export function dockAnchor(bar: {
  querySelector: (s: string) => any;
  firstChild: any;
} | null): { ok: boolean; before: any } {
  if (!bar) return { ok: false, before: null };
  const share = bar.querySelector(SCREEN_SHARE);
  if (share) {
    // TrackToggle may be wrapped in .lk-button-group; step up to whichever
    // node is the bar's own child so we sit between siblings, not inside
    // somebody else's group.
    let node: any = share;
    while (node && node.parentNode && node.parentNode !== bar) node = node.parentNode;
    return { ok: true, before: node?.nextSibling ?? null };
  }
  return { ok: true, before: bar.firstChild ?? null };
}

/** Is there anything worth drawing OVER the video right now? The floating
 *  layer earns its place per-frame or not at all. */
export function overlayWanted(s: {
  hands: number;
  away: number;
  floaters: number;
}): boolean {
  return (Number(s.hands) || 0) + (Number(s.away) || 0) + (Number(s.floaters) || 0) > 0;
}

/** The controls, in the order they belong in the bar. Compact labels,
 *  because the bar is shared with LiveKit's own buttons and a bar that
 *  overflows is a bar with a hidden Leave button — the exact failure this
 *  product already fixed once (FIELD 2026-08-17). */
export type DockControl = { key: "hand" | "brb" | "react"; glyph: string; on: string; off: string };

export const DOCK_CONTROLS: DockControl[] = [
  { key: "hand", glyph: "✋", off: "Raise hand", on: "Hand up" },
  { key: "brb", glyph: "☕", off: "Be right back", on: "Away" },
  { key: "react", glyph: "🙂", off: "React", on: "React" },
];

/** Below this width the bar shows glyphs only. Measured against the stock
 *  LiveKit bar with mic + camera + share + chat + leave: six labelled
 *  buttons need ~640px before they start wrapping, and a wrapped control bar
 *  pushes the video up and out of the window. */
export const LABELS_MIN_PX = 760;

export function showLabels(width: number): boolean {
  return (Number(width) || 0) >= LABELS_MIN_PX;
}
