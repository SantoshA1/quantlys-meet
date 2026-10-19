// Where the agent's question card goes.
//
// FIELD 2026-10-19 (demo rehearsal): the card was `position:absolute;
// bottom:96px` inside the header's action row, so "bottom" meant "96px above
// the bottom of the header" — it rendered at y ≈ -334 on every screen size.
// The agent asked its question and nobody could see it.
//
// Now it's fixed to the viewport: under the measured header and the gaps
// strip, on the left (the right side is the Live notes panel), and never
// taller than the space above the control bar — it scrolls inside itself
// instead of running under Leave / Mic / Camera.

export const CARD_GAP_STRIP = 60;   // the "N gaps still open" strip under the header
export const CARD_FOOT = 96;        // control bar + breathing room
export const CARD_MIN_H = 160;

export type CardPlacement = {
  top: number;
  left: number;
  right?: number;
  width?: number;
  maxHeight: number;
};

/** `stripBottom` is where the gaps strip actually ends (0 when it isn't shown
 *  or hasn't been measured) — it wraps to two rows on narrower screens. */
export function cardPlacement(headerBottom: number, vw: number, vh: number, stripBottom = 0): CardPlacement {
  const narrow = vw <= 720;
  const edge = narrow ? 8 : 12;
  const top = Math.max(
    Math.max(48, Math.round(headerBottom)) + (narrow ? 52 : CARD_GAP_STRIP),
    Math.round(stripBottom) + 8
  );
  // On a short window the floor wins and the card keeps a usable height; it
  // still sits below the header, so nothing above it is covered.
  const maxHeight = Math.max(CARD_MIN_H, Math.round(vh - top - CARD_FOOT));
  if (narrow) return { top, left: edge, right: edge, maxHeight };
  return { top, left: edge, width: Math.min(380, vw - edge * 2), maxHeight };
}
