// Paint whiteboard strokes onto any canvas — shared by the live Board and the
// recording mosaic, so annotations appear in the saved video the same way
// they appear on screen.
//
// Coordinates stay 0..1 of the surface (see lib/draw.ts). This file is the
// only place a pixel is allowed to exist for drawing.

import {
  alphaFor, arrowHead, rectOf, strokePx, widthFor,
  type Pt, type Stroke,
} from "./draw";

const STICKY_FILL = "rgba(255, 249, 196, 0.92)";

function px(p: Pt, W: number, H: number): [number, number] {
  return [p.x * W, p.y * H];
}

function roundRectPath(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** One stroke, in device pixels. */
export function paintStroke(
  g: CanvasRenderingContext2D, s: Stroke, W: number, H: number,
) {
  g.save();
  g.globalAlpha = alphaFor(s.tool);
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = strokePx(widthFor(s.tool, s.width), H);
  g.lineCap = "round";
  g.lineJoin = "round";
  const aspect = W / Math.max(1, H);

  if (s.tool === "text") {
    const [x, y] = px(s.pts[0], W, H);
    const size = Math.max(14, strokePx(s.width, H) * 6);
    g.globalAlpha = 1;
    g.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    g.textBaseline = "middle";
    g.lineWidth = Math.max(2, size / 8);
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.strokeText(s.text || "", x, y);
    g.fillStyle = s.color;
    g.fillText(s.text || "", x, y);
    g.restore();
    return;
  }

  if (s.pts.length >= 2) {
    const r = rectOf(s.pts[0], s.pts[1]);
    const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
    const cx = x + w / 2, cy = y + h / 2;

    if (s.tool === "rect") {
      g.strokeRect(x, y, w, h);
      g.restore();
      return;
    }
    if (s.tool === "roundrect") {
      roundRectPath(g, x, y, w, h, Math.min(w, h) * 0.18);
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "ellipse") {
      g.beginPath();
      g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "diamond") {
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(x + w, cy);
      g.lineTo(cx, y + h);
      g.lineTo(x, cy);
      g.closePath();
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "parallelogram") {
      const skew = Math.min(w * 0.22, w * 0.4);
      g.beginPath();
      g.moveTo(x + skew, y);
      g.lineTo(x + w, y);
      g.lineTo(x + w - skew, y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "triangle") {
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(x + w, y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "cylinder") {
      const ry = Math.min(h * 0.18, w * 0.22);
      g.beginPath();
      g.ellipse(cx, y + ry, w / 2, ry, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(x, y + ry);
      g.lineTo(x, y + h - ry);
      g.ellipse(cx, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
      g.lineTo(x + w, y + ry);
      g.stroke();
      g.restore();
      return;
    }
    if (s.tool === "sticky") {
      g.globalAlpha = 1;
      g.fillStyle = STICKY_FILL;
      roundRectPath(g, x, y, w, h, Math.min(w, h) * 0.08);
      g.fill();
      g.strokeStyle = s.color;
      g.lineWidth = strokePx(widthFor("pen", s.width), H);
      g.stroke();
      const label = String(s.text || "").trim();
      if (label) {
        const size = Math.max(12, Math.min(h * 0.22, strokePx(s.width, H) * 5));
        g.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        g.fillStyle = "#3a4354";
        g.textAlign = "center";
        g.textBaseline = "middle";
        // Wrap roughly within the pad.
        const maxChars = Math.max(8, Math.floor((w * 0.85) / (size * 0.55)));
        const words = label.split(/\s+/);
        const lines: string[] = [];
        let cur = "";
        for (const word of words) {
          const next = cur ? `${cur} ${word}` : word;
          if (next.length > maxChars && cur) { lines.push(cur); cur = word; }
          else cur = next;
        }
        if (cur) lines.push(cur);
        const startY = cy - ((lines.length - 1) * size * 1.15) / 2;
        lines.slice(0, 6).forEach((ln, i) => g.fillText(ln, cx, startY + i * size * 1.15));
      }
      g.restore();
      return;
    }
  }

  g.beginPath();
  const first = px(s.pts[0], W, H);
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < s.pts.length; i++) {
    const [x, y] = px(s.pts[i], W, H);
    g.lineTo(x, y);
  }
  if (s.pts.length === 1) g.lineTo(first[0] + 0.01, first[1]);
  g.stroke();

  if (s.tool === "arrow" && s.pts.length >= 2) {
    const [tip, a, b] = arrowHead(s.pts[0], s.pts[1], aspect);
    g.beginPath();
    const t = px(tip, W, H), pa = px(a, W, H), pb = px(b, W, H);
    g.moveTo(t[0], t[1]);
    g.lineTo(pa[0], pa[1]);
    g.lineTo(pb[0], pb[1]);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export function paintStrokes(
  g: CanvasRenderingContext2D,
  strokes: Stroke[],
  W: number,
  H: number,
  opts?: { solid?: boolean },
) {
  if (opts?.solid) {
    g.fillStyle = "#f6f7fb";
    g.fillRect(0, 0, W, H);
  }
  for (const s of strokes || []) {
    if (s) paintStroke(g, s, W, H);
  }
}

/** Snapshot the board as a JPEG data URL (or null if empty / no canvas). */
export function snapshotBoardDataUrl(
  strokes: Stroke[],
  opts?: { width?: number; height?: number; solid?: boolean; quality?: number },
): string | null {
  if (typeof document === "undefined") return null;
  const list = strokes || [];
  if (!list.length) return null;
  const W = opts?.width || 1280;
  const H = opts?.height || 720;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  paintStrokes(g, list, W, H, { solid: opts?.solid !== false });
  try {
    return c.toDataURL("image/jpeg", opts?.quality ?? 0.82);
  } catch {
    return null;
  }
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

/** Composite live board canvas or stroke replay onto a recording frame. */
export function compositeBoardOnto(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  opts: {
    strokes: Stroke[];
    surface: "screen" | "board" | "none";
    liveCanvas?: HTMLCanvasElement | null;
  },
) {
  const live = opts.liveCanvas;
  const hasLive = !!(live && live.width > 0 && live.height > 0);
  const hasStrokes = (opts.strokes || []).length > 0;
  if (!hasLive && !hasStrokes) return;

  if (opts.surface === "board") {
    g.fillStyle = "#f6f7fb";
    g.fillRect(0, 0, W, H);
  }

  if (hasLive) {
    try {
      g.drawImage(live!, 0, 0, W, H);
      return;
    } catch { /* fall through to stroke replay */ }
  }
  if (hasStrokes) paintStrokes(g, opts.strokes, W, H);
}
