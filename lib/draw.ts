// Drawing on the meeting: annotation over a shared screen, and a whiteboard
// when there is nothing to annotate.
//
// WHY THIS EXISTS AT ALL. A meeting where somebody says "the third box, no,
// the one BELOW that" is a meeting that needed a pen. Every serious meeting
// product has one because pointing is how people explain things — the words
// for spatial relationships are terrible and everybody knows it.
//
// THE DESIGN, and what each choice buys:
//
//   Strokes are DATA, not pixels. Every mark is a small JSON object with
//   normalised coordinates. That means: it survives a resize, it can be
//   undone by its author alone, it can be sent to a person who joined ten
//   seconds ago, and it costs bytes rather than megabytes. A pixel-diff
//   whiteboard cannot do any of those and is the reason most of them feel
//   broken on a second monitor.
//
//   Coordinates are 0..1 OF THE SURFACE, never pixels. My 3440-wide screen
//   and your 1280 laptop must see the arrow pointing at the same word. This
//   is the single decision that makes shared drawing feel correct, and it is
//   the one most implementations get wrong.
//
//   Every stroke carries its AUTHOR. Undo is per-person, because an undo
//   that takes back somebody else's arrow is a fight, not a feature. Clear
//   is a deliberate, named, everybody-sees-it act.
//
//   Live strokes are streamed as they are drawn. A pen that only appears
//   when you lift it is a pen nobody trusts.
//
// ZERO-IMPORT, pure, and every decision below is guarded — the canvas half
// is a thin renderer over these functions.

export type Tool = "pen" | "marker" | "line" | "arrow" | "rect" | "ellipse" | "text" | "eraser";

export type Pt = { x: number; y: number };

export type Stroke = {
  id: string;
  by: string;            // participant identity — undo is per author
  who: string;           // display name, for the "who drew this" tooltip
  tool: Tool;
  color: string;
  width: number;         // 1..12, in surface-relative units (see strokePx)
  pts: Pt[];             // pen/marker: the path. shapes: [start, end]
  text?: string;         // text tool only
  at: number;
};

/** The palette. Eight colours that stay legible on a screenshot of anything:
 *  each was checked against white slides, dark IDEs, and a photo. No pure
 *  blue (invisible on a dark terminal), no pure yellow (invisible on white),
 *  and white and black are both present because the surface underneath is
 *  not knowable in advance. */
export const COLORS = [
  "#ff4d5e", // red — the "this is wrong" colour, first because it is the one
  "#ffb02e", // amber
  "#31d17e", // green
  "#33b1ff", // sky
  "#b98cff", // violet
  "#00d4c4", // Quantlys teal
  "#ffffff", // white
  "#101318", // near-black
];

export const WIDTHS = [2, 4, 8];

/** A stroke's width is stored in surface units and drawn in pixels, so a
 *  4-unit line is the same THICKNESS RELATIVE TO THE PICTURE on a phone and
 *  on a 4K monitor. Scaled off height because that is what a person's sense
 *  of "thick" tracks when a surface is letterboxed. */
export function strokePx(width: number, surfaceHeight: number): number {
  const w = Math.max(1, Math.min(12, Number(width) || 2));
  const h = Number(surfaceHeight) || 720;
  return Math.max(1, (w * h) / 720);
}

/** Marker (highlighter) is translucent so the thing underneath still reads —
 *  that is the whole point of highlighting. Everything else is opaque. */
export function alphaFor(tool: Tool): number {
  return tool === "marker" ? 0.32 : 1;
}

/** The marker is fat by nature: a highlighter that draws a hairline is a pen
 *  with the wrong colour. */
export function widthFor(tool: Tool, width: number): number {
  if (tool === "marker") return Math.max(10, (Number(width) || 2) * 4);
  if (tool === "eraser") return Math.max(12, (Number(width) || 2) * 5);
  return Math.max(1, Number(width) || 2);
}

/** Clamp a pointer to the surface. A drag that leaves the window must stop at
 *  the edge, not record coordinates outside it that then draw off-picture on
 *  somebody else's differently-shaped screen. */
export function toSurface(
  clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Pt {
  const w = rect.width || 1, h = rect.height || 1;
  const x = (Number(clientX) - rect.left) / w;
  const y = (Number(clientY) - rect.top) / h;
  return {
    x: Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)),
    y: Math.max(0, Math.min(1, Number.isFinite(y) ? y : 0)),
  };
}

/** Freehand paths arrive at pointer-event rate — up to 240 points a second
 *  on a good trackpad — and every one of them is broadcast. Dropping points
 *  that are visually redundant cuts the traffic by ~70% with no change an eye
 *  can see: a point closer than half a stroke-width to the last one cannot
 *  move the line. This is the difference between a pen that feels instant to
 *  a room of eight and one that queues. */
export function shouldKeepPoint(last: Pt | null, next: Pt, minDist = 0.004): boolean {
  if (!last) return true;
  const dx = next.x - last.x, dy = next.y - last.y;
  return dx * dx + dy * dy >= minDist * minDist;
}

/** Shapes only ever need two points: where the drag began and where it is
 *  now. Recording the whole drag for a rectangle is how a "shape" ends up
 *  with 400 points in it. */
export function isShape(tool: Tool): boolean {
  return tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse";
}

/** Hold Shift and a line snaps to 15°, a rectangle to a square, an ellipse to
 *  a circle. Every drawing tool ever made does this and people reach for it
 *  without being told. */
export function constrain(from: Pt, to: Pt, tool: Tool, shift: boolean): Pt {
  if (!shift) return to;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (tool === "rect" || tool === "ellipse") {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: from.x + Math.sign(dx || 1) * m, y: from.y + Math.sign(dy || 1) * m };
  }
  const step = Math.PI / 12;                      // 15°
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const r = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
}

/** The arrow head, as three points, in surface units. Sized off the shaft so
 *  a short arrow is not all head and a long one is not a pin. The angle is
 *  computed from the shaft's own direction rather than the bounding box,
 *  which is why it stays correct on a non-square surface. */
export function arrowHead(from: Pt, to: Pt, aspect = 1): [Pt, Pt, Pt] {
  const dx = (to.x - from.x) * aspect, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const size = Math.max(0.018, Math.min(0.06, len * 0.28));
  const a = Math.atan2(dy, dx);
  const wing = Math.PI / 7;
  const p = (ang: number): Pt => ({
    x: to.x - (Math.cos(ang) * size) / (aspect || 1),
    y: to.y - Math.sin(ang) * size,
  });
  return [to, p(a - wing), p(a + wing)];
}

/** A rectangle from any two corners, normalised so a drag up-and-left is the
 *  same rectangle as a drag down-and-right. */
export function rectOf(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
  };
}

/** Erase by whole stroke, not by pixel. Pixel erasing on shared vector marks
 *  means every eraser drag has to be broadcast and replayed by everybody in
 *  order — which is how shared whiteboards desynchronise. Removing whole
 *  strokes is order-independent: two people erasing at once converge. */
export function hitStroke(s: Stroke, p: Pt, tol = 0.02): boolean {
  if (!s || !s.pts?.length) return false;
  if (isShape(s.tool) && s.pts.length >= 2) {
    const [a, b] = s.pts;
    if (s.tool === "rect" || s.tool === "ellipse") {
      const r = rectOf(a, b);
      // the outline, not the fill — an unfilled shape is not a target the
      // size of its area
      const inOuter = p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
      const inInner = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol;
      return inOuter && !inInner;
    }
    return distToSegment(p, a, b) <= tol;
  }
  if (s.tool === "text") {
    const a = s.pts[0];
    return Math.abs(p.x - a.x) <= 0.12 && Math.abs(p.y - a.y) <= 0.04;
  }
  for (let i = 1; i < s.pts.length; i++) {
    if (distToSegment(p, s.pts[i - 1], s.pts[i]) <= tol) return true;
  }
  return s.pts.length === 1 && distToSegment(p, s.pts[0], s.pts[0]) <= tol;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// ── the shared board: what everybody agrees is on the surface ─────────────

export type Board = { strokes: Stroke[]; cleared: number };

export const EMPTY_BOARD: Board = { strokes: [], cleared: 0 };

/** How many strokes a board keeps. Not a memory limit — a MEANING limit: a
 *  surface with a thousand marks on it is a surface nobody can read, and the
 *  oldest are always the least relevant. Late joiners get this whole set, so
 *  it is also the size of the catch-up message. */
export const MAX_STROKES = 400;

/** Apply one event to the board. Pure and TOTAL: every message from the wire
 *  — including a malformed or replayed one — has a defined outcome, because
 *  the alternative is a whiteboard that diverges between two people and no
 *  way to tell which is right.
 *
 *  Idempotent by stroke id, so a re-delivered stroke does not draw twice, and
 *  a live stroke being streamed can update in place. */
export function applyEvent(board: Board, ev: any): Board {
  const b: Board = board || EMPTY_BOARD;
  if (!ev || typeof ev !== "object") return b;

  if (ev.t === "clear") {
    const at = Number(ev.at) || 0;
    if (at <= b.cleared) return b;                 // an old clear cannot re-clear
    return { strokes: [], cleared: at };
  }

  if (ev.t === "undo") {
    const by = String(ev.by || "");
    if (!by) return b;
    // The author's own last stroke, and nobody else's.
    for (let i = b.strokes.length - 1; i >= 0; i--) {
      if (b.strokes[i].by === by) {
        const next = b.strokes.slice();
        next.splice(i, 1);
        return { ...b, strokes: next };
      }
    }
    return b;
  }

  if (ev.t === "erase") {
    const ids = new Set((Array.isArray(ev.ids) ? ev.ids : []).map(String));
    if (!ids.size) return b;
    const next = b.strokes.filter((s) => !ids.has(s.id));
    return next.length === b.strokes.length ? b : { ...b, strokes: next };
  }

  if (ev.t === "stroke") {
    const s = normalizeStroke(ev.s);
    if (!s) return b;
    // Drawn before the last clear? Then it is not coming back. But only a
    // board that HAS been cleared can reject on this — with cleared at 0 the
    // old `s.at <= b.cleared` test silently swallowed any stroke whose
    // timestamp was missing or zero, which is a mark somebody drew that
    // simply never appeared. Found by a teeth probe: a guard was passing for
    // this reason instead of the one it claimed.
    if (b.cleared > 0 && s.at <= b.cleared) return b;
    const i = b.strokes.findIndex((x) => x.id === s.id);
    if (i >= 0) {
      const next = b.strokes.slice();
      next[i] = s;                                  // live update of a stroke in flight
      return { ...b, strokes: next };
    }
    const next = b.strokes.concat(s);
    return { ...b, strokes: next.length > MAX_STROKES ? next.slice(-MAX_STROKES) : next };
  }

  return b;
}

/** Anything off the wire is a stranger. A stroke with a NaN in it renders as
 *  nothing and can never be erased — it is a permanent invisible occupant of
 *  everybody's board — so it does not get in. */
export function normalizeStroke(raw: any): Stroke | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "");
  const tool = String(raw.tool || "") as Tool;
  if (!id) return null;
  if (!["pen", "marker", "line", "arrow", "rect", "ellipse", "text", "eraser"].includes(tool)) return null;
  const pts = (Array.isArray(raw.pts) ? raw.pts : [])
    .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p: Pt) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
  if (!pts.length) return null;
  const color = /^#[0-9a-fA-F]{3,8}$/.test(String(raw.color)) ? String(raw.color) : COLORS[0];
  return {
    id,
    by: String(raw.by || ""),
    who: String(raw.who || "Someone").slice(0, 40),
    tool,
    color,
    width: Math.max(1, Math.min(12, Number(raw.width) || 2)),
    pts: pts.slice(0, 600),
    text: raw.text != null ? String(raw.text).slice(0, 140) : undefined,
    at: Number(raw.at) || 0,
  };
}

/** Can this person undo? Only if they have a mark on the board. A greyed-out
 *  Undo is information; an Undo that does nothing is a bug report. */
export function canUndo(board: Board, by: string): boolean {
  return (board?.strokes || []).some((s) => s.by === by);
}

/** The catch-up a late joiner is sent. Same shape as any other event stream,
 *  so the receiving code has one path, not two. */
export function catchUp(board: Board): any[] {
  const b = board || EMPTY_BOARD;
  const evs: any[] = [];
  if (b.cleared) evs.push({ t: "clear", at: b.cleared });
  for (const s of b.strokes) evs.push({ t: "stroke", s });
  return evs;
}

/** Annotation belongs over a SHARED SCREEN; the whiteboard is what you draw
 *  on when nobody is sharing. Offering "annotate" with nothing to annotate is
 *  a button that does nothing, and offering only a whiteboard while somebody
 *  is presenting hides the pen exactly when it is wanted. */
export function surfaceFor(s: { screenShareOn: boolean; boardOpen: boolean }):
  "screen" | "board" | "none" {
  if (s.boardOpen) return "board";
  if (s.screenShareOn) return "screen";
  return "none";
}

/** The label the pen button wears, which must say which surface it will
 *  actually draw on. */
export function penLabel(s: { screenShareOn: boolean; on: boolean }): string {
  if (s.on) return "Stop drawing";
  return s.screenShareOn ? "Annotate" : "Whiteboard";
}
