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
