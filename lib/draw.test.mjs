/**
 * MAYA GUARD — the pen: annotation over a shared screen, and the whiteboard.
 *
 * Maya asks: "I drew an arrow at the third row of the spreadsheet. Did the
 * person on the ultrawide see it pointing at the third row — or somewhere
 * else entirely? When I pressed undo, did it take back MY mark or the one
 * my colleague just drew? And when someone joined late, did they see the
 * diagram we had been talking about for five minutes, or a blank screen?"
 *
 * Run: node lib/draw.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  COLORS, WIDTHS, strokePx, alphaFor, widthFor, toSurface, shouldKeepPoint,
  isShape, constrain, arrowHead, rectOf, hitStroke, distToSegment,
  EMPTY_BOARD, MAX_STROKES, applyEvent, normalizeStroke, canUndo, catchUp,
  surfaceFor, penLabel,
} from "./draw.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── the one decision that makes shared drawing feel correct ──────────────
const rect = { left: 100, top: 50, width: 800, height: 400 };
{
  const p = toSurface(500, 250, rect);
  ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9,
    "the middle of MY window is the middle of YOURS — coordinates are 0..1 of the surface, never pixels");
}
{
  const wide = { left: 0, top: 0, width: 3440, height: 1440 };
  const small = { left: 0, top: 0, width: 1280, height: 536 };
  const a = toSurface(3440 * 0.25, 1440 * 0.75, wide);
  const b = toSurface(1280 * 0.25, 536 * 0.75, small);
  ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6,
    "an ultrawide and a laptop agree on where the arrow points — the whole reason coordinates are normalised");
}
ok(toSurface(-500, -500, rect).x === 0 && toSurface(99999, 99999, rect).y === 1,
  "a drag that leaves the window stops at the edge — coordinates outside the surface draw off-picture on somebody else's screen");
ok(Number.isFinite(toSurface(0, 0, { left: 0, top: 0, width: 0, height: 0 }).x),
  "a zero-sized surface yields a number, never NaN — a NaN mark is invisible AND unerasable, a permanent occupant of everybody's board");

// ── the pen must feel instant to a room, not just to me ──────────────────
ok(shouldKeepPoint(null, { x: 0.1, y: 0.1 }) === true, "the first point of a stroke is always kept");
ok(shouldKeepPoint({ x: 0.1, y: 0.1 }, { x: 0.1005, y: 0.1 }) === false,
  "a point that cannot move the line is dropped — a trackpad emits 240 a second and every one of them is broadcast");
ok(shouldKeepPoint({ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }) === true, "a real movement is kept");

// ── shapes ───────────────────────────────────────────────────────────────
ok(isShape("rect") && isShape("ellipse") && isShape("line") && isShape("arrow"),
  "the four shape tools are shapes");
ok(!isShape("pen") && !isShape("marker") && !isShape("text") && !isShape("eraser"),
  "…and freehand, text and the eraser are not — a rectangle recorded as 400 drag points is not a rectangle");
{
  const from = { x: 0.2, y: 0.2 };
  const sq = constrain(from, { x: 0.6, y: 0.3 }, "rect", true);
  ok(Math.abs((sq.x - from.x) - (sq.y - from.y)) < 1e-9,
    "Shift makes a rectangle a square — every drawing tool ever made does this and people reach for it untold");
  const free = constrain(from, { x: 0.6, y: 0.3 }, "rect", false);
  ok(free.x === 0.6 && free.y === 0.3, "…and without Shift the drag is obeyed exactly");
  const line = constrain({ x: 0, y: 0 }, { x: 1, y: 0.04 }, "line", true);
  ok(Math.abs(line.y) < 1e-9, "Shift snaps a nearly-horizontal line to horizontal");
}
{
  const [tip, a, b] = arrowHead({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 1);
  ok(tip.x === 0.8 && tip.y === 0.5, "the arrow head sits at the point, not past it");
  ok(a.x < tip.x && b.x < tip.x, "…and its wings trail behind the tip");
  ok(Math.abs((tip.y - a.y) + (tip.y - b.y)) < 1e-9, "…symmetrically about the shaft");
  const short = arrowHead({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }, 1);
  const long = arrowHead({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 1);
  ok(Math.hypot(long[0].x - long[1].x, 0) > Math.hypot(short[0].x - short[1].x, 0),
    "the head is sized off the shaft — a short arrow is not all head and a long one is not a pin");
}
{
  const r = rectOf({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 });
  ok(r.x === 0.2 && r.y === 0.1 && Math.abs(r.w - 0.6) < 1e-9,
    "a drag up-and-left is the same rectangle as a drag down-and-right");
}

// ── ink weight ───────────────────────────────────────────────────────────
ok(alphaFor("marker") < 1 && alphaFor("pen") === 1,
  "the highlighter is translucent — a highlighter you cannot see through is a pen with the wrong colour");
ok(widthFor("marker", 2) > widthFor("pen", 2), "…and fat, by nature");
ok(widthFor("eraser", 2) > widthFor("pen", 2), "the eraser is fat too — a hairline eraser is a game of darts");
ok(strokePx(4, 1440) > strokePx(4, 720),
  "a 4-unit line is the same thickness RELATIVE TO THE PICTURE on a phone and a 4K monitor");
ok(strokePx(4, 0) >= 1, "a surface with no height still draws a visible line");
ok(COLORS.length >= 6 && COLORS.includes("#ffffff") && COLORS.some((c) => c === "#101318"),
  "the palette carries both white and near-black — the surface underneath is never knowable in advance");
ok(WIDTHS.length === 3, "three weights: thin, medium, thick");

// ── erasing by stroke, so two people erasing at once converge ────────────
const S = (o = {}) => ({ id: "s1", by: "me", who: "Me", tool: "pen", color: COLORS[0], width: 2,
  pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }], at: 10, ...o });
ok(hitStroke(S(), { x: 0.5, y: 0.205 }) === true, "the eraser finds a line it is over");
ok(hitStroke(S(), { x: 0.5, y: 0.6 }) === false, "…and not one it is nowhere near");
ok(hitStroke(S({ tool: "rect" }), { x: 0.2, y: 0.2 }) === true, "a rectangle is hit on its OUTLINE");
ok(hitStroke(S({ tool: "rect", pts: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] }), { x: 0.5, y: 0.5 }) === false,
  "…and not in its empty middle — an unfilled shape is not a target the size of its area");
ok(hitStroke(S({ pts: [] }), { x: 0.5, y: 0.5 }) === false, "a stroke with no points is never a hit");
ok(distToSegment({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }) === 1, "point-to-segment distance is honest");

// ── the board converges, whatever the wire delivers ──────────────────────
let b = EMPTY_BOARD;
b = applyEvent(b, { t: "stroke", s: S({ id: "a", at: 100 }) });
ok(b.strokes.length === 1, "a stroke lands");
b = applyEvent(b, { t: "stroke", s: S({ id: "a", at: 100, pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }) });
ok(b.strokes.length === 1 && b.strokes[0].pts[1].x === 1,
  "the same id UPDATES in place — this is how a stroke streams while it is being drawn, and how a re-delivered message does not draw twice");
b = applyEvent(b, { t: "stroke", s: S({ id: "b", by: "you", who: "You", at: 101 }) });
ok(b.strokes.length === 2, "somebody else's stroke lands beside mine");

b = applyEvent(b, { t: "undo", by: "me" });
ok(b.strokes.length === 1 && b.strokes[0].by === "you",
  "undo takes back MY last mark and leaves yours alone — an undo that takes back somebody else's arrow is a fight, not a feature");
ok(applyEvent(b, { t: "undo", by: "nobody" }) === b, "an undo from somebody with no marks changes nothing");
ok(canUndo(b, "you") === true && canUndo(b, "me") === false,
  "Undo is greyed out for a person with nothing to take back — an Undo that does nothing is a bug report");

{
  const withBoth = applyEvent(b, { t: "stroke", s: S({ id: "c", at: 102 }) });
  const erased = applyEvent(withBoth, { t: "erase", ids: ["c"] });
  ok(erased.strokes.length === withBoth.strokes.length - 1, "erase removes whole strokes by id");
  ok(applyEvent(erased, { t: "erase", ids: ["c"] }) === erased,
    "…and erasing it again is a no-op — two people erasing at once converge instead of desynchronising");
}
{
  const cleared = applyEvent(b, { t: "clear", at: 500 });
  ok(cleared.strokes.length === 0, "Clear all wipes the surface");
  const late = applyEvent(cleared, { t: "stroke", s: S({ id: "z", at: 400 }) });
  ok(late.strokes.length === 0,
    "a stroke drawn BEFORE the clear cannot arrive late and un-clear the board — the clock decides, not the network");
  const after = applyEvent(cleared, { t: "stroke", s: S({ id: "z2", at: 600 }) });
  ok(after.strokes.length === 1, "…and a stroke drawn after it lands normally");
  ok(applyEvent(cleared, { t: "clear", at: 400 }) === cleared, "an old clear cannot re-clear");
}
{
  let big = EMPTY_BOARD;
  for (let i = 0; i < MAX_STROKES + 40; i++) big = applyEvent(big, { t: "stroke", s: S({ id: `k${i}`, at: 1000 + i }) });
  ok(big.strokes.length === MAX_STROKES,
    "the board keeps a readable number of marks — a surface with a thousand on it is a surface nobody can read");
  ok(big.strokes[big.strokes.length - 1].id === `k${MAX_STROKES + 39}`, "…keeping the newest, which are the relevant ones");
}

// ── nothing off the wire is trusted ──────────────────────────────────────
ok(applyEvent(EMPTY_BOARD, null) === EMPTY_BOARD, "a null event is survivable");
ok(applyEvent(EMPTY_BOARD, { t: "nonsense" }) === EMPTY_BOARD, "an unknown event type is ignored, not crashed on");
ok(normalizeStroke({ id: "x", tool: "pen", pts: [{ x: NaN, y: 0 }] }) === null,
  "a stroke with a NaN in it is refused AT THE DOOR — it would be invisible AND unerasable for everyone, for ever");
ok(applyEvent(EMPTY_BOARD, { t: "stroke", s: { id: "x", tool: "pen", pts: [{ x: NaN, y: 0 }] } }).strokes.length === 0,
  "…and so never reaches the board");
ok(applyEvent(EMPTY_BOARD, { t: "stroke", s: S({ id: "t0", at: 0 }) }).strokes.length === 1,
  "a stroke with no timestamp on a never-cleared board still lands — the old `at <= cleared` test swallowed it silently, which is a mark somebody drew that simply never appeared (found by a teeth probe, not by a user)");
ok(normalizeStroke({ id: "x", tool: "rm -rf", pts: [{ x: 0, y: 0 }] }) === null, "an unknown tool is refused");
ok(normalizeStroke({ id: "x", tool: "pen", color: "javascript:alert(1)", pts: [{ x: 0, y: 0 }] }).color === COLORS[0],
  "a colour that is not a colour falls back to one — a stroke is data, and data off the wire is a stranger");
ok(normalizeStroke({ id: "x", tool: "pen", pts: [{ x: 5, y: -3 }] }).pts[0].x === 1,
  "coordinates from the wire are clamped to the surface too");
ok(normalizeStroke({ id: "x", tool: "text", text: "z".repeat(9999), pts: [{ x: 0, y: 0 }] }).text.length <= 140,
  "a novel pasted into the text tool is trimmed, not rendered");
ok(normalizeStroke({ id: "", tool: "pen", pts: [{ x: 0, y: 0 }] }) === null, "a stroke with no id has no identity and cannot be undone or erased");

// ── walking in late ──────────────────────────────────────────────────────
{
  let live = EMPTY_BOARD;
  live = applyEvent(live, { t: "clear", at: 50 });
  live = applyEvent(live, { t: "stroke", s: S({ id: "p", at: 60 }) });
  live = applyEvent(live, { t: "stroke", s: S({ id: "q", by: "you", at: 70 }) });
  let joiner = EMPTY_BOARD;
  for (const e of catchUp(live)) joiner = applyEvent(joiner, e);
  ok(JSON.stringify(joiner.strokes) === JSON.stringify(live.strokes) && joiner.cleared === live.cleared,
    "a late joiner is handed the board and arrives at the SAME board — walking in mid-explanation shows the diagram, not a blank screen");
  let twice = joiner;
  for (const e of catchUp(live)) twice = applyEvent(twice, e);
  ok(twice.strokes.length === live.strokes.length,
    "…and two people answering the catch-up request does not double every mark");
}

// ── which surface the pen draws on ───────────────────────────────────────
ok(surfaceFor({ screenShareOn: true, boardOpen: false }) === "screen",
  "with a screen being shared, the pen annotates it");
ok(surfaceFor({ screenShareOn: false, boardOpen: true }) === "board",
  "with nothing shared, the pen opens a whiteboard");
ok(surfaceFor({ screenShareOn: false, boardOpen: false }) === "none", "and otherwise there is nothing to draw on");
ok(penLabel({ screenShareOn: true, on: false }) === "Annotate" &&
   penLabel({ screenShareOn: false, on: false }) === "Whiteboard",
  "the button says which surface it will actually draw on — 'Annotate' with nothing to annotate is a button that does nothing");
ok(penLabel({ screenShareOn: true, on: true }) === "Stop drawing", "…and says how to stop once it is on");

// ── the component actually uses all of this ──────────────────────────────
const board = readFileSync(new URL("../app/room/[room]/Board.tsx", import.meta.url), "utf8");
ok(/toSurface\(/.test(board) && !/e\.clientX -[^)]*\/ *rect\.width/.test(board),
  "the component converts pointers through the guarded function, not with arithmetic of its own");
ok(/applyEvent\(/.test(board) && /catchUp\(/.test(board), "the board state and the catch-up are the guarded ones");
ok(/t: "undo", by: me/.test(board), "undo is stamped with the person who pressed it");
ok(/hitStroke\(/.test(board), "the eraser uses the guarded hit test");
ok(/constrain\(/.test(board) && /shift\.current/.test(board), "Shift-constrain is wired to the real Shift key");
ok(/touch-action: none/.test(board), "a finger drawing on a tablet draws instead of scrolling the page");
ok(/setPointerCapture/.test(board), "a stroke that leaves the canvas mid-drag still finishes — pointer capture, not luck");
ok(/lineCap = "round"/.test(board), "round caps: the difference between ink and a bar chart");
ok(/if \(!open\) return null/.test(board),
  "the drawing layer does not exist when nobody is drawing — an annotation layer that swallows clicks is a meeting where the mute button stops working");
ok(/strokeText\(/.test(board),
  "text carries a dark halo so it stays readable over a bright slide and a photo alike");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
