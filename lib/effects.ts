// Background effects that look like a camera, not like a cut-out.
//
// FIELD 2026-08-20, from a live meeting on a Logitech BRIO: "the background
// blur keeps flashing and the blur is not applied, looks very artificial."
// Three separate faults were behind one complaint, and all three are the
// same kind of mistake — a pipeline that is allowed to show something it
// has not actually computed.
//
//   1. THE FLASH (worst offender). @livekit/track-processors' transform()
//      enqueues its canvas EVERY frame, but blurBackground() returns early
//      whenever the segmentation mask is missing — and the mask is written
//      by an async callback, so it is missing often. The canvas then still
//      holds the PREVIOUS frame, which is duly published. Live video with
//      stale frames stitched into it is not a stutter, it is a strobe.
//
//   2. THE ARTIFICIAL EDGE. The mask arrives at the segmenter's own small
//      resolution and is feathered with a fixed blur(3px) — three pixels at
//      720p is a hard edge. And every frame's mask is computed from scratch,
//      so the boundary jitters a pixel or two per frame with no memory of
//      where it was: the crawling shimmer around a head that reads instantly
//      as fake. A real lens has no such edge because a real lens has depth
//      of field, not a decision boundary.
//
//   3. NOT ACTUALLY BLURRY. blurRadius 12 at 720p leaves the room legible —
//      you can still read the whiteboard behind somebody. If a person turns
//      blur on for privacy and their room stays readable, the feature lied.
//
// This module is the part of the fix that can be reasoned about and tested
// without a camera, a GPU, or a browser: cadence, blending, feathering, and
// the warm-up policy. The WebGL/canvas half lives in lib/qbg.ts and is a
// thin shell over these decisions.
//
// ZERO-IMPORT on purpose so it travels into any project on its own.

/** How hard each effect blurs the background, in canvas filter pixels at
 *  720p. Chosen by looking at a real room at each value: at 12 the titles on
 *  a bookshelf are readable, at 18 they are shapes, at 24 the room is colour
 *  and light with no legible detail — which is what somebody means when they
 *  say "blur my background". Above ~32 the halo around hair starts to glow
 *  and it reads as a filter again. */
export const BLUR_PX = 24;

/** A virtual background still blurs the ORIGINAL room slightly before the
 *  image is painted over it, so a mask that misses a sliver of the real room
 *  leaks an out-of-focus smear instead of a readable window. Defence in
 *  depth for the same privacy promise. */
export const IMAGE_UNDERBLUR_PX = 18;

/** Blur applied to the MASK itself, which is what turns a decision boundary
 *  into an edge an eye accepts. Scaled to the output, because a fixed pixel
 *  count is a different softness at every resolution — the bug in the
 *  library. ~1.1% of height: 8px at 720p, 4px at 360p. */
export function featherPx(outputHeight: number): number {
  const h = Number(outputHeight) || 0;
  if (h <= 0) return 3;
  return Math.max(2, Math.min(14, Math.round(h * 0.011)));
}

/** Segmentation is the expensive half; the video is not. Running the model
 *  at every frame of a 30fps stream buys nothing an eye can see and is what
 *  makes a modest laptop drop frames — which is the OTHER way this feature
 *  strobes. 20Hz of mask under 30fps of video is invisible once the mask is
 *  smoothed, and gives back a third of the CPU. */
export const SEGMENT_HZ = 20;

export function shouldSegment(nowMs: number, lastMs: number, hz: number = SEGMENT_HZ): boolean {
  const rate = Number(hz) > 0 ? Number(hz) : SEGMENT_HZ;
  if (!Number.isFinite(nowMs)) return false;
  if (!lastMs) return true;              // never segmented — always go
  return nowMs - lastMs >= 1000 / rate;
}

/** Temporal smoothing: this frame's mask, mixed into the last one.
 *
 *  THE POINT: a per-frame mask is independent of the frame before it, so the
 *  boundary jitters and the eye reads "computer". Mixing a new mask into the
 *  old one with a fixed weight gives the edge memory. Too much memory and a
 *  moving hand smears; too little and the crawl comes back. 0.6 tracks a
 *  gesture within ~3 frames while removing the shimmer of a still head.
 *
 *  Written as a mutation of `prev` and returning it, because this runs on
 *  every frame at 921,600 subpixels and allocation is the enemy. */
export const MASK_SMOOTHING = 0.6;

export function blendMask(
  prev: Uint8ClampedArray | Uint8Array | number[] | null,
  next: Uint8ClampedArray | Uint8Array | number[],
  alpha: number = MASK_SMOOTHING,
): Uint8ClampedArray | Uint8Array | number[] {
  if (!next) return (prev || []) as any;
  if (!prev || prev.length !== next.length) {
    // First mask, or the resolution changed under us: adopt it whole. A
    // half-blended first frame is a ghost of a person who was never there.
    return next;
  }
  const a = Math.min(1, Math.max(0, Number(alpha)));
  const b = 1 - a;
  for (let i = 0; i < next.length; i++) {
    prev[i] = next[i] * a + prev[i] * b;
  }
  return prev;
}

/** What to paint when the mask is not ready. THE RULE: never the previous
 *  frame. A stale frame is the strobe.
 *
 *  - "blur-all": the whole picture blurred, mask or no mask. The person is
 *    live and moving; their room is not readable. This is what a person who
 *    just pressed "Blur" is owed while the model downloads, and it keeps the
 *    privacy promise from the first frame instead of from the fourth second.
 *  - "masked": the normal path, mask in hand.
 *  - "raw": no effect wanted at all.
 *
 *  There is deliberately no "hold" state. */
export function warmupPaint(s: {
  wantsEffect: boolean;
  hasMask: boolean;
}): "raw" | "blur-all" | "masked" {
  if (!s.wantsEffect) return "raw";
  return s.hasMask ? "masked" : "blur-all";
}

/** The mask is computed on a downscaled copy of the frame — the model's own
 *  input is 256×256, so feeding it 1280×720 costs a resize it does anyway.
 *  Segmenting a 384-wide copy is measurably cheaper and pixel-identical
 *  after feathering. Height follows the source aspect so a face is never
 *  squashed into a mask that fits somebody else. */
export const SEGMENT_WIDTH = 384;

export function segmentSize(w: number, h: number): { w: number; h: number } {
  const sw = Number(w) || 0, sh = Number(h) || 0;
  if (sw <= 0 || sh <= 0) return { w: SEGMENT_WIDTH, h: Math.round(SEGMENT_WIDTH * 9 / 16) };
  if (sw <= SEGMENT_WIDTH) return { w: sw, h: sh };
  return { w: SEGMENT_WIDTH, h: Math.max(1, Math.round((sh / sw) * SEGMENT_WIDTH)) };
}

/** A frame that arrives while the previous one is still being processed must
 *  be DROPPED, not queued. A queue on a live stream is latency that never
 *  comes back: the picture drifts further behind the voice every second, and
 *  the person is told they are lagging when they are in fact being buffered
 *  by their own laptop. Dropping is honest — the newest frame is the true
 *  one. */
export function shouldDropFrame(busy: boolean): boolean {
  return Boolean(busy);
}

/** Model + WASM come from a CDN by default, which means the first blur of
 *  the day waits on a download, and an offline desktop build never blurs at
 *  all. We ship them; this names where. Same-origin, versioned by the build,
 *  cached by the browser forever after. */
export const LOCAL_ASSETS = {
  tasksVisionFileSet: "/mediapipe/wasm",
  modelAssetPath: "/mediapipe/selfie_segmenter.tflite",
};

/** Whether the shipped assets are actually present in this deployment. A
 *  missing file must fall back to the CDN, not to a broken effect — the
 *  vendored copy is an optimisation, never a dependency. */
export function assetPaths(local: { wasm: boolean; model: boolean }):
  { tasksVisionFileSet?: string; modelAssetPath?: string } | undefined {
  const out: { tasksVisionFileSet?: string; modelAssetPath?: string } = {};
  if (local?.wasm) out.tasksVisionFileSet = LOCAL_ASSETS.tasksVisionFileSet;
  if (local?.model) out.modelAssetPath = LOCAL_ASSETS.modelAssetPath;
  return Object.keys(out).length ? out : undefined;
}

/** Applying an effect REPLACES the camera's MediaStreamTrack — the processor
 *  publishes a generated track, not the camera's own. That is the trap the
 *  flashing came from: code that re-applies the effect "when the camera
 *  track changes" re-applies it in response to its OWN last application, for
 *  ever, and each application shows a frame of raw camera on the way past.
 *
 *  So the decision is not "did the track change" but "is THIS track already
 *  wearing the effect I want". Pure, because a loop that only reproduces on
 *  real hardware is a loop that ships. */
export function shouldApplyEffect(s: {
  /** the effect the person has chosen */
  wantedId: string;
  /** what the live track is actually wearing, "" when bare */
  liveId: string;
  /** is a camera track published at all */
  hasTrack: boolean;
  /** an application already in flight */
  busy: boolean;
}): boolean {
  if (!s.hasTrack) return false;
  if (s.busy) return false;
  return String(s.wantedId || "none") !== String(s.liveId || "none");
}

/** The name the processor is registered under, which is also how we ask a
 *  live track what it is wearing. LiveKit exposes `track.processor.name`;
 *  encoding the effect id in it turns an unanswerable question ("is this the
 *  blur or the nebula?") into a string comparison. */
export const PROC_PREFIX = "quantlys-bg:";

export function procName(effectId: string): string {
  return PROC_PREFIX + String(effectId || "none");
}

export function effectIdOfProcessor(name?: string | null): string {
  const n = String(name || "");
  return n.startsWith(PROC_PREFIX) ? n.slice(PROC_PREFIX.length) : "";
}

// ── which half of the mask is the person? ─────────────────────────────────
//
// FIELD 2026-08-20, second report, with a screenshot: "blur is applying on
// people instead of background." Dead right — the person was smeared and the
// living room behind them was pin sharp.
//
// The cause is one word. The segmentation mask marks one class opaque and
// the other transparent, and NOTHING IN THE API SAYS WHICH. MediaPipe's
// selfie segmenter marks the BACKGROUND; I composited with `source-in`
// (keep the picture where the mask is opaque), which keeps the background
// sharp and blurs the person. Exactly inverted.
//
// The fix is not to hardcode the other word. A convention that is not
// written down anywhere is a convention that changes between model versions,
// and the failure is silent, ugly, and lands in front of a customer. So the
// pipeline MEASURES the polarity instead of assuming it: on a webcam, the
// person is in the middle of the frame and the room is at the edges. Whichever
// region the mask calls opaque tells us what the mask means.
//
// This is strictly better than knowing the right answer, because it is still
// right when the answer changes.

/** Where a person sits in a webcam frame. Deliberately generous vertically —
 *  heads are high in frame — and narrow horizontally, because the sides are
 *  the most reliably "room" part of any tile. */
export const CENTER_BOX = { x: 0.32, y: 0.15, w: 0.36, h: 0.7 };

/** How much brighter the centre must be than the edges before we believe it.
 *  Below this the frame is ambiguous (an extreme close-up fills everything;
 *  an empty chair fills nothing) and the last confident answer is kept. */
export const POLARITY_MARGIN = 12;

export type Polarity = "person" | "background";

/** Which class the mask paints OPAQUE. `last` is the standing answer, kept
 *  whenever this frame is not clear enough to overrule it — a polarity that
 *  flickers frame to frame would strobe far worse than the bug it fixes. */
export function maskPolarity(s: {
  centerMean: number;
  edgeMean: number;
  last?: Polarity | null;
}): Polarity {
  const c = Number(s.centerMean), e = Number(s.edgeMean);
  const fallback: Polarity = s.last || "background";   // MediaPipe's own convention, today
  if (!Number.isFinite(c) || !Number.isFinite(e)) return fallback;
  if (Math.abs(c - e) < POLARITY_MARGIN) return fallback;
  return c > e ? "person" : "background";
}

/** The composite that KEEPS THE PERSON SHARP, given what the mask means.
 *
 *  · mask opaque on the person  → keep the picture where the mask IS
 *  · mask opaque on the room    → keep the picture where the mask IS NOT
 *
 *  Getting this backwards blurs the person and sharpens their living room,
 *  which is what shipped and what this pair of functions exists to prevent. */
export function keepComposite(p: Polarity): "source-in" | "source-out" {
  return p === "person" ? "source-in" : "source-out";
}

/** Mean mask value inside a box, sampled on a grid rather than per pixel —
 *  this runs on every fresh mask and a full scan of 384×216 would undo the
 *  cost savings the cadence just bought. 24×24 samples is ±2 on a real mask. */
export function boxMean(
  mask: ArrayLike<number>, w: number, h: number,
  box: { x: number; y: number; w: number; h: number },
  samples = 24,
): number {
  const W = Number(w) || 0, H = Number(h) || 0;
  if (!mask || !W || !H) return NaN;
  const x0 = Math.max(0, Math.floor(box.x * W)), y0 = Math.max(0, Math.floor(box.y * H));
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * W)), y1 = Math.min(H, Math.ceil((box.y + box.h) * H));
  if (x1 <= x0 || y1 <= y0) return NaN;
  let sum = 0, n = 0;
  for (let i = 0; i < samples; i++) {
    const y = y0 + Math.floor(((i + 0.5) / samples) * (y1 - y0));
    for (let j = 0; j < samples; j++) {
      const x = x0 + Math.floor(((j + 0.5) / samples) * (x1 - x0));
      const v = mask[y * W + x];
      if (v != null) { sum += v; n++; }
    }
  }
  return n ? sum / n : NaN;
}

/** Mean of the four edge strips — the part of a webcam frame most reliably
 *  NOT the person. Averaged as one number so a person leaning to one side
 *  cannot swing the verdict. */
export function edgeMean(mask: ArrayLike<number>, w: number, h: number): number {
  const strips = [
    { x: 0, y: 0, w: 1, h: 0.12 },        // top
    { x: 0, y: 0.88, w: 1, h: 0.12 },     // bottom
    { x: 0, y: 0, w: 0.1, h: 1 },         // left
    { x: 0.9, y: 0, w: 0.1, h: 1 },       // right
  ].map((b) => boxMean(mask, w, h, b, 16)).filter((v) => Number.isFinite(v));
  if (!strips.length) return NaN;
  return strips.reduce((a, b) => a + b, 0) / strips.length;
}
