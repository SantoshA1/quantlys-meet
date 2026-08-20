"use client";

// The pen: annotation over a shared screen, and a whiteboard when there is
// nothing being shared.
//
// FIELD 2026-08-20: "give users option to annotate on the screen with a good
// experience… an option of whiteboard with shapes to select to draw with
// different colours and different shapes."
//
// Every judgement in here — coordinates, hit-testing, undo ownership, the
// board's convergence rules — lives in lib/draw.ts where it is pure and
// guarded. This file is the canvas and the pointer, nothing more, because a
// whiteboard whose correctness lives in a React component is a whiteboard
// that can only be tested by two people in a meeting.
//
// The load-bearing decisions, restated where they are implemented:
//   · marks are DATA in 0..1 surface coordinates, so my ultrawide and your
//     laptop see the arrow pointing at the same word;
//   · a stroke streams AS IT IS DRAWN, so the pen feels live to the room;
//   · undo takes back YOUR last mark, never somebody else's;
//   · a late joiner is sent the board, so walking in mid-explanation shows
//     the diagram rather than an empty screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDataChannel, useLocalParticipant } from "@livekit/components-react";
import {
  COLORS, WIDTHS, EMPTY_BOARD, applyEvent, catchUp, canUndo,
  toSurface, shouldKeepPoint, isShape, constrain, arrowHead, rectOf, hitStroke,
  strokePx, alphaFor, widthFor,
  type Board as BoardState, type Stroke, type Tool, type Pt,
} from "@/lib/draw";

const DRAW_TOPIC = "qm-draw";

const TOOLS: Array<{ id: Tool; glyph: string; label: string }> = [
  { id: "pen", glyph: "✏️", label: "Pen" },
  { id: "marker", glyph: "🖍️", label: "Highlighter" },
  { id: "arrow", glyph: "↗", label: "Arrow" },
  { id: "line", glyph: "╱", label: "Line" },
  { id: "rect", glyph: "▭", label: "Rectangle" },
  { id: "ellipse", glyph: "◯", label: "Ellipse" },
  { id: "text", glyph: "T", label: "Text" },
  { id: "eraser", glyph: "🩹", label: "Eraser" },
];

export default function Board({
  open, surface, onClose,
}: {
  open: boolean;
  /** "screen" annotates over whatever is being shared; "board" is a blank
   *  whiteboard. The label on the button already told the person which. */
  surface: "screen" | "board";
  onClose: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity || "me";
  const myName = localParticipant?.name || me.split("-")[0] || "Someone";

  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [typing, setTyping] = useState<{ at: Pt; value: string } | null>(null);

  const cvs = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const live = useRef<Stroke | null>(null);
  const drawing = useRef(false);
  const shift = useRef(false);
  const lastSent = useRef(0);
  const boardRef = useRef<BoardState>(EMPTY_BOARD);
  boardRef.current = board;

  const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

  const { send } = useDataChannel(DRAW_TOPIC, (msg) => {
    try {
      const ev = JSON.parse(new TextDecoder().decode(msg.payload));
      // "who is on this board" — a joiner asks, whoever has marks answers.
      // Anyone may answer; applyEvent is idempotent by id, so three answers
      // and one answer leave the board in the same state.
      if (ev?.t === "ask") {
        const mine = boardRef.current.strokes.length || boardRef.current.cleared;
        if (mine) for (const e of catchUp(boardRef.current)) push(e, false);
        return;
      }
      setBoard((b) => applyEvent(b, ev));
    } catch {
      /* a malformed mark is not worth a broken meeting */
    }
  });

  const push = useCallback((ev: any, local = true) => {
    if (local) setBoard((b) => applyEvent(b, ev));
    try { send(bytes(ev), { topic: DRAW_TOPIC }); } catch { /* the mark stays on my own board */ }
  }, [send]);

  // Ask the room what is already drawn, once, on the way in.
  useEffect(() => {
    const t = setTimeout(() => { try { send(bytes({ t: "ask" }), { topic: DRAW_TOPIC }); } catch {} }, 400);
    return () => clearTimeout(t);
  }, [send]);

  // A person who leaves takes nothing with them — their marks are part of the
  // explanation the room is still looking at. Deliberate, not an oversight.

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shift.current = true;
      if (!open) return;
      if (e.key === "Escape") { if (typing) setTyping(null); else onClose(); }
      // The two shortcuts every drawing surface has. Meta+Z is per-person by
      // construction: it sends an undo stamped with my identity.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        push({ t: "undo", by: me });
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shift.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [open, typing, onClose, push, me]);

  // ── render ──────────────────────────────────────────────────────────────
  const paint = useCallback(() => {
    const c = cvs.current, w = wrap.current;
    if (!c || !w) return;
    const rect = w.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, W, H);
    g.lineCap = "round";
    g.lineJoin = "round";

    const all = live.current ? board.strokes.concat(live.current) : board.strokes;
    for (const s of all) drawStroke(g, s, W, H);
  }, [board]);

  useEffect(() => { paint(); }, [paint]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    if (wrap.current) ro.observe(wrap.current);
    return () => { window.removeEventListener("resize", onResize); ro.disconnect(); };
  }, [open, paint]);

  // ── the pointer ─────────────────────────────────────────────────────────
  const at = (e: React.PointerEvent): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    return toSurface(e.clientX, e.clientY, r);
  };

  function onDown(e: React.PointerEvent) {
    if (typing) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = at(e);

    if (tool === "eraser") {
      drawing.current = true;
      eraseAt(p);
      return;
    }
    if (tool === "text") {
      setTyping({ at: p, value: "" });
      return;
    }
    drawing.current = true;
    live.current = {
      id: `${me}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      by: me, who: myName, tool, color, width,
      pts: [p], at: Date.now(),
    };
    paint();
  }

  function onMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    const p = at(e);
    if (tool === "eraser") { eraseAt(p); return; }
    const s = live.current;
    if (!s) return;

    if (isShape(s.tool)) {
      s.pts = [s.pts[0], constrain(s.pts[0], p, s.tool, shift.current)];
    } else if (shouldKeepPoint(s.pts[s.pts.length - 1], p)) {
      s.pts.push(p);
    } else return;

    paint();
    // Stream it while it is being drawn — throttled, because a pen at 240Hz
    // does not need 240 messages a second to look instant.
    const now = Date.now();
    if (now - lastSent.current > 60) {
      lastSent.current = now;
      try { send(bytes({ t: "stroke", s }), { topic: DRAW_TOPIC }); } catch {}
    }
  }

  function onUp() {
    if (!drawing.current) return;
    drawing.current = false;
    const s = live.current;
    live.current = null;
    if (!s) { paint(); return; }
    // A tap with a shape tool is not a shape — it is a misclick, and a
    // zero-size rectangle is an invisible undoable nuisance.
    if (isShape(s.tool) && s.pts.length >= 2) {
      const d = Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].y - s.pts[0].y);
      if (d < 0.006) { paint(); return; }
    }
    push({ t: "stroke", s });
  }

  function eraseAt(p: Pt) {
    const hit = boardRef.current.strokes.filter((s) => hitStroke(s, p));
    if (hit.length) push({ t: "erase", ids: hit.map((s) => s.id) });
  }

  function commitText() {
    const t = typing;
    setTyping(null);
    if (!t || !t.value.trim()) return;
    push({
      t: "stroke",
      s: {
        id: `${me}-${Date.now()}-t`,
        by: me, who: myName, tool: "text", color, width,
        pts: [t.at], text: t.value.trim(), at: Date.now(),
      },
    });
  }

  const undoable = useMemo(() => canUndo(board, me), [board, me]);
  if (!open) return null;

  return (
    <div className={`qmb-wrap${surface === "board" ? " qmb-solid" : ""}`} ref={wrap}>
      <canvas
        ref={cvs}
        className="qmb-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair" }}
      />

      {typing ? (
        <input
          className="qmb-text"
          autoFocus
          value={typing.value}
          placeholder="Type, then Enter"
          style={{
            left: `${typing.at.x * 100}%`, top: `${typing.at.y * 100}%`,
            color, borderColor: color,
          }}
          onChange={(e) => setTyping({ ...typing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText();
            if (e.key === "Escape") setTyping(null);
          }}
          onBlur={commitText}
        />
      ) : null}

      <div className="qmb-tools" role="toolbar" aria-label="Drawing tools">
        <div className="qmb-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`qmb-tool${tool === t.id ? " qmb-toolon" : ""}`}
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              title={t.label}
              aria-label={t.label}
            >
              {t.glyph}
            </button>
          ))}
        </div>

        <div className="qmb-group">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`qmb-color${color === c ? " qmb-coloron" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              title={c}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>

        <div className="qmb-group">
          {WIDTHS.map((w) => (
            <button
              key={w}
              className={`qmb-w${width === w ? " qmb-won" : ""}`}
              onClick={() => setWidth(w)}
              aria-pressed={width === w}
              title={`${w === 2 ? "Thin" : w === 4 ? "Medium" : "Thick"} line`}
              aria-label={`${w === 2 ? "Thin" : w === 4 ? "Medium" : "Thick"} line`}
            >
              <i style={{ height: Math.max(2, w) }} />
            </button>
          ))}
        </div>

        <div className="qmb-group">
          <button className="qmb-act" onClick={() => push({ t: "undo", by: me })} disabled={!undoable} title="Undo your last mark (⌘Z)">
            Undo
          </button>
          <button
            className="qmb-act"
            onClick={() => push({ t: "clear", at: Date.now() })}
            title="Clear the surface for everyone"
          >
            Clear all
          </button>
          <button className="qmb-act qmb-done" onClick={onClose} title="Stop drawing (Esc)">Done</button>
        </div>
      </div>

      {board.strokes.length === 0 ? (
        <p className="qmb-hint">
          {surface === "board"
            ? "A shared whiteboard — everyone in the meeting draws on the same one, and sees it as you draw."
            : "Draw over the shared screen. Everyone sees your marks live; Clear all wipes the surface for the room."}
        </p>
      ) : null}
    </div>
  );
}

/** One stroke, in device pixels. Surface coordinates in, canvas out — the
 *  only place in the drawing code where a pixel is allowed to exist. */
function drawStroke(g: CanvasRenderingContext2D, s: Stroke, W: number, H: number) {
  const px = (p: Pt) => [p.x * W, p.y * H] as const;
  g.save();
  g.globalAlpha = alphaFor(s.tool);
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = strokePx(widthFor(s.tool, s.width), H);
  const aspect = W / Math.max(1, H);

  if (s.tool === "text") {
    const [x, y] = px(s.pts[0]);
    const size = Math.max(14, strokePx(s.width, H) * 6);
    g.globalAlpha = 1;
    g.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    g.textBaseline = "middle";
    // A dark halo so text stays readable over a bright slide and a photo
    // alike — the surface underneath is never knowable in advance.
    g.lineWidth = Math.max(2, size / 8);
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.strokeText(s.text || "", x, y);
    g.fillText(s.text || "", x, y);
    g.restore();
    return;
  }

  if (s.tool === "rect" && s.pts.length >= 2) {
    const r = rectOf(s.pts[0], s.pts[1]);
    g.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    g.restore();
    return;
  }

  if (s.tool === "ellipse" && s.pts.length >= 2) {
    const r = rectOf(s.pts[0], s.pts[1]);
    g.beginPath();
    g.ellipse((r.x + r.w / 2) * W, (r.y + r.h / 2) * H, (r.w / 2) * W, (r.h / 2) * H, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    return;
  }

  g.beginPath();
  const first = px(s.pts[0]);
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < s.pts.length; i++) {
    const [x, y] = px(s.pts[i]);
    g.lineTo(x, y);
  }
  if (s.pts.length === 1) g.lineTo(first[0] + 0.01, first[1]);   // a dot is a mark
  g.stroke();

  if (s.tool === "arrow" && s.pts.length >= 2) {
    const [tip, a, b] = arrowHead(s.pts[0], s.pts[1], aspect);
    g.beginPath();
    const t = px(tip), pa = px(a), pb = px(b);
    g.moveTo(t[0], t[1]);
    g.lineTo(pa[0], pa[1]);
    g.lineTo(pb[0], pb[1]);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export const BOARD_CSS = `
/* The drawing surface sits over the video area. Pointer events land on the
   canvas ONLY while drawing is open — an annotation layer that swallows
   clicks when nobody is drawing is a meeting where the mute button stops
   working. */
.qmb-wrap { position: absolute; inset: 0; z-index: 28; }
.qmb-solid { background: #f6f7fb; }
.qmb-canvas { position: absolute; inset: 0; width: 100%; height: 100%;
  touch-action: none; }
.qmb-tools { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: 16px; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px;
  align-items: center; justify-content: center;
  max-width: calc(100% - 24px);
  background: rgba(14,17,23,.95); border: 1px solid #2b3240; border-radius: 14px;
  padding: 8px 10px; backdrop-filter: blur(10px);
  box-shadow: 0 14px 40px rgba(0,0,0,.55); }
.qmb-group { display: flex; gap: 4px; align-items: center; padding-right: 10px;
  border-right: 1px solid #262b36; }
.qmb-group:last-child { border-right: 0; padding-right: 0; }
.qmb-tool { width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid transparent; color: #cfd6e4;
  font-size: 16px; line-height: 1; display: inline-flex; align-items: center;
  justify-content: center; }
.qmb-tool:hover { background: #1a1f2a; }
.qmb-toolon { background: #0d3d39; border-color: #00a99d; color: #7fe0d6; }
.qmb-color { width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
.qmb-coloron { border-color: #ffffff; transform: scale(1.14); }
.qmb-w { width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid transparent;
  display: inline-flex; align-items: center; justify-content: center; }
.qmb-w:hover { background: #1a1f2a; }
.qmb-w i { display: block; width: 18px; background: #cfd6e4; border-radius: 4px; }
.qmb-won { background: #0d3d39; border-color: #00a99d; }
.qmb-won i { background: #7fe0d6; }
.qmb-act { font: inherit; font-size: 13px; cursor: pointer; color: #cfd6e4;
  background: #1a1f2a; border: 1px solid #2b3240; border-radius: 8px;
  padding: 7px 12px; }
.qmb-act:hover:not(:disabled) { background: #222835; }
.qmb-act:disabled { opacity: .45; cursor: default; }
.qmb-done { background: #0d3d39; color: #7fe0d6; border-color: #00a99d; }
.qmb-text { position: absolute; transform: translateY(-50%); z-index: 3;
  min-width: 180px; font: 600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: rgba(10,12,17,.9); border: 2px solid; border-radius: 8px;
  padding: 6px 10px; outline: none; }
.qmb-hint { position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
  margin: 0; z-index: 2; font-size: 13px; color: #cfd6e4;
  background: rgba(14,17,23,.9); border: 1px solid #2b3240; border-radius: 999px;
  padding: 7px 16px; max-width: calc(100% - 32px); text-align: center; }
.qmb-solid .qmb-hint { color: #3a4354; background: rgba(255,255,255,.92);
  border-color: #d5d9e2; }
@media (max-width: 720px) {
  .qmb-tools { gap: 6px; padding: 6px; bottom: 10px; }
  .qmb-group { padding-right: 6px; }
  .qmb-tool { width: 30px; height: 30px; font-size: 14px; }
  .qmb-color { width: 18px; height: 18px; }
}
`;
