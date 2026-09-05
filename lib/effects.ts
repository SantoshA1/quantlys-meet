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

/** Soft depth-of-field applied to a STILL or LOOP backdrop so it sits
 *  behind the person instead of reading as a sticker glued to their
 *  shoulders. Small on purpose — a few pixels of lens falloff, not a
 *  second privacy blur. */
export const BACKDROP_DOF_PX = 3;

/** RETIRED 2026-08-20, and kept named so the mistake is not repeated.
 *
 *  This was "a virtual background blurs the ORIGINAL room slightly before the
 *  image is painted over it, so a missed sliver leaks a smear rather than a
 *  window." It sounded like defence in depth. What it actually did was fill
 *  every transparent pixel with the blurred room, leaving the `destination-over`
 *  that painted the chosen backdrop with nothing to paint — so the backdrop
 *  was discarded and every image effect rendered as plain blur. Four
 *  backdrops that "showed the same without any change".
 *
 *  A backdrop that covers the whole background IS the privacy measure. There
 *  is nothing for a second layer to add, and it cost the feature. */
export const IMAGE_UNDERBLUR_PX = 0;

/** Blur applied to the MASK itself, which is what turns a decision boundary
 *  into an edge an eye accepts. Scaled to the output, because a fixed pixel
 *  count is a different softness at every resolution — the bug in the
 *  library. ~1.1% of height: 8px at 720p, 4px at 360p. */
export function featherPx(outputHeight: number): number {
  const h = Number(outputHeight) || 0;
  if (h <= 0) return 1;
  // FIELD 2026-09-04 v6: soft matte dissolved the WHOLE silhouette into the
  // blur (waxy face, not just an edge halo). Feather is AA only — 1px at
  // every meeting resolution. Zoom/Meet keep the subject pin-sharp; we match.
  return 1;
}

/** Segmentation cadence. After #22, full-res pixel readback is gone so 30Hz
 *  has CPU headroom again. Paint keeps the last hard matte when briefly
 *  stale (warmupPaint haveMask) — never Gaussian the face. */
export const SEGMENT_HZ = 30;

export function shouldSegment(nowMs: number, lastMs: number, hz: number = SEGMENT_HZ): boolean {
  const rate = Number(hz) > 0 ? Number(hz) : SEGMENT_HZ;
  if (!Number.isFinite(nowMs)) return false;
  if (!lastMs) return true;              // never segmented — always go
  return nowMs - lastMs >= 1000 / rate;
}

/** How old a mask may be (ms) before paintMasked is unsafe — painting a
 *  live VideoFrame with a silhouette from two poses ago is the ghost trail
 *  beside a turning head. Past this, prefer blur-all over a wrong matte. */
export const MASK_MAX_AGE_MS = 50;

export function maskIsFresh(nowMs: number, maskAtMs: number, maxAgeMs: number = MASK_MAX_AGE_MS): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maskAtMs) || maskAtMs <= 0) return false;
  return nowMs - maskAtMs <= Math.max(0, Number(maxAgeMs) || 0);
}

/** Fraction of output height used to dilate the person silhouette before
 *  scrubbing them from the blur plate. Dilate so soft matte edges do not
 *  leave a rim of person color that the blur then smears as a ghost/halo. */
/** Dilate fraction used by the temporal hist update path - keep person
 *  fringes out of hist so they cannot smear into a self-ghost. */
export const HIST_DILATE = 0.028;

export const PLATE_DILATE_FRAC = HIST_DILATE;

export function plateDilatePx(outputHeight: number): number {
  const h = Number(outputHeight) || 0;
  if (h <= 0) return 6;
  // Generous exclusion so dark clothing / cap never writes into hist near
  // the edge (that fringe was the dark self-ghost after blur).
  return Math.max(6, Math.min(20, Math.round(h * PLATE_DILATE_FRAC)));
}

/** Tiny sample size for the person-fill mush: downscale the full frame,
 *  then upscale back under the dilated silhouette so the blur plate has
 *  room-colored pixels where the person was, not a smeared double. */
export function plateFillSize(W: number, H: number): { w: number; h: number } {
  const w = Number(W) || 0, h = Number(H) || 0;
  if (w <= 0 || h <= 0) return { w: 16, h: 16 };
  const tw = Math.max(12, Math.min(48, Math.round(w / 28)));
  const th = Math.max(12, Math.round(tw * (h / w)));
  return { w: tw, h: th };
}

/** Mean luma (0.299R + 0.587G + 0.114B) inside a pixel box of an RGBA buffer.
 *  Returns NaN if the box is empty or inputs are unusable. */
export function boxMeanLuma(
  rgba: ArrayLike<number> | null | undefined,
  W: number,
  H: number,
  box: { x: number; y: number; w: number; h: number },
): number {
  const width = Number(W) || 0, height = Number(H) || 0;
  if (!rgba || width <= 0 || height <= 0) return NaN;
  const x0 = Math.max(0, Math.floor(Number(box?.x) || 0));
  const y0 = Math.max(0, Math.floor(Number(box?.y) || 0));
  const x1 = Math.min(width, Math.ceil(x0 + (Number(box?.w) || 0)));
  const y1 = Math.min(height, Math.ceil(y0 + (Number(box?.h) || 0)));
  if (x1 <= x0 || y1 <= y0) return NaN;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (r == null || g == null || b == null) continue;
      sum += 0.299 * (r as number) + 0.587 * (g as number) + 0.114 * (b as number);
      n++;
    }
  }
  return n ? sum / n : NaN;
}


/** Temporal smoothing: this frame's mask, mixed into the last one.
 *
 *  THE POINT: a per-frame mask is independent of the frame before it, so the
 *  boundary jitters and the eye reads "computer". Mixing a new mask into the
 *  old one with a fixed weight gives the edge memory. Too much memory and a
 *  moving hand smears; too little and the crawl comes back.
 *
 *  FIELD 2026-09-04 (post-#18 screenshots): even 0.90 / 0.95 left a
 *  translucent ghost of the head beside a turn. Any retained fraction of the
 *  previous pose is a trail the eye cannot miss. Default is now SNAP (1.0):
 *  adopt the new mask whole. adaptiveSmoothAlpha only mixes when the mask is
 *  nearly still (anti-crawl), and on any real motion returns 1.0.
 *  Hair softness stays with confidence alpha + a thin feather, never lag.
 *
 *  Written as a mutation of `prev` and returning it, because this runs on
 *  every frame at 921,600 subpixels and allocation is the enemy. */
export const MASK_SMOOTHING = 1.0;

/** Mild mix used ONLY when the mask is nearly still (anti-crawl). Never used
 *  on a head turn — that path snaps. */
export const MASK_SMOOTHING_STILL = 0.82;

/** @deprecated alias kept so older call sites reading FAST still compile;
 *  motion always snaps to 1.0 now. */
export const MASK_SMOOTHING_FAST = 1.0;

/** Mean |Δ| above which we treat the mask as moving and SNAP (no EMA). */
export const MASK_DELTA_FAST = 12;

/** Mean absolute per-pixel difference between two masks. Pure helper. */
export function maskMeanAbsDelta(
  prev: ArrayLike<number> | null | undefined,
  next: ArrayLike<number> | null | undefined,
): number {
  if (!next || !next.length) return 0;
  if (!prev || prev.length !== next.length) return 255;
  let sum = 0;
  const n = next.length;
  for (let i = 0; i < n; i++) sum += Math.abs((next[i] as number) - (prev[i] as number));
  return sum / n;
}

/** Which EMA weight to use this frame.
 *  Moving mask → 1.0 (snap, no ghost). Nearly still → mild still-mix. */
export function adaptiveSmoothAlpha(
  prev: ArrayLike<number> | null | undefined,
  next: ArrayLike<number> | null | undefined,
  base: number = MASK_SMOOTHING,
  still: number = MASK_SMOOTHING_STILL,
  threshold: number = MASK_DELTA_FAST,
): number {
  if (!prev || !next || prev.length !== next.length) return 1;
  const d = maskMeanAbsDelta(prev, next);
  const snap = Math.min(1, Math.max(0, Number(base)));
  const s = Math.min(1, Math.max(0, Number(still)));
  const t = Math.max(0, Number(threshold) || 0);
  // Any real motion snaps. Only a nearly-still mask gets a gentle mix.
  return d >= t ? Math.max(snap, 1) : Math.min(snap, s);
}

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
  /** fresh mask this frame */
  hasMask: boolean;
  /** any silhouette has landed (may be one pose old) */
  haveMask?: boolean;
  /** temporal room plate is seeded */
  histReady?: boolean;
}): "raw" | "blur-all" | "masked" {
  if (!s.wantsEffect) return "raw";
  // FIELD 2026-09-04 v6: paintBlurAll when the mask was briefly stale waxed
  // the ENTIRE face (Gaussian over the subject). Zoom/Meet never publish a
  // blurred person. Prefer last matte; if we only have hist, passthrough
  // sharp camera rather than smear the subject. blur-all only on cold start.
  if (s.hasMask || s.haveMask) return "masked";
  if (s.histReady) return "raw";
  return "blur-all";
}

/** The mask is computed on a downscaled copy of the frame — the model's own
 *  input is 256×256, so feeding it 1280×720 costs a resize it does anyway.
 *  Segmenting a 384-wide copy is measurably cheaper and pixel-identical
 *  after feathering. Height follows the source aspect so a face is never
 *  squashed into a mask that fits somebody else. */
export const SEGMENT_WIDTH = 640;
// 2026-08-24: was 384 then 512. 2026-09-03: 512 to 640. At 720p a 640-wide mask
// is about 2px per source pixel after upscale — enough for hair strands once
// confidence alpha is in play, still cheap at 20Hz.

export function segmentSize(w: number, h: number): { w: number; h: number } {
  const sw = Number(w) || 0, sh = Number(h) || 0;
  if (sw <= 0 || sh <= 0) return { w: SEGMENT_WIDTH, h: Math.round(SEGMENT_WIDTH * 9 / 16) };
  if (sw <= SEGMENT_WIDTH) return { w: sw, h: sh };
  return { w: SEGMENT_WIDTH, h: Math.max(1, Math.round((sh / sw) * SEGMENT_WIDTH)) };
}

// ── the mask itself: soft numbers instead of a yes/no ─────────────────────
//
// FIELD 2026-08-24. `outputCategoryMask: true` returns a per-pixel CLASS —
// 0 or 255, no in-between — at the segmenter's own small resolution. Hair,
// which is the one place an eye actually checks whether a background is
// fake, has no gradient to be drawn with: every strand is either wholly
// person or wholly room. @livekit/track-processors makes the same request,
// so this was the ecosystem default rather than an invention, but it is the
// wrong one for anything that has to look real.
//
// `outputConfidenceMasks` returns a Float32 per pixel, 0..1. That is the
// gradient. Both are requested now and confidence is preferred, because a
// fallback is behaviour: a model or a build that returns only a category
// mask must still blur, just less beautifully.

/** How hard to push the confidence values apart before they become alpha.
 *
 *  Raw confidence is mushy in the middle — a lot of pixels sit near 0.5 and
 *  a linear map turns them into a wide grey band, which is the same smear
 *  the old feather produced, just earlier in the pipeline. An S-curve leaves
 *  the confident pixels alone and pulls the uncertain ones toward whichever
 *  side they were already leaning.
 *
 *  Retuned 2026-09-04 from 6 to 11: city window lights were visible ON the
 *  baseball cap / forehead / cheeks because mid-confidence became a grey
 *  veil and destination-over showed the backdrop through the face. Steeper
 *  contrast + hardenMaskAlpha (below) make the person core fully opaque. */
export const MASK_CONTRAST = 11;

/** Float32 confidence (0..1) -> alpha byte (0..255), through the S-curve.
 *  Pure, because "the edge is mushy" is a claim about a curve. */
export function confidenceToAlpha(c: number, contrast: number = MASK_CONTRAST): number {
  const raw = Number(c);
  if (!Number.isFinite(raw)) return 0;
  const x = Math.max(0, Math.min(1, raw));
  const k = Math.max(1, Number(contrast) || 1);
  // Logistic around 0.5, normalised so 0 -> 0 and 1 -> 1 exactly. Without the
  // normalisation a "fully background" pixel keeps a few percent of alpha,
  // and a few percent of alpha over a whole frame is a visible grey veil.
  const f = (t: number) => 1 / (1 + Math.exp(-k * (t - 0.5)));
  const lo = f(0), hi = f(1);
  return Math.round(255 * Math.max(0, Math.min(1, (f(x) - lo) / (hi - lo))));
}

/** Core-harden thresholds (alpha bytes). After confidence→alpha and after
 *  temporal blend, before silhouette blur: anything this opaque is the
 *  person core and must be fully opaque so backdrop cannot bleed through
 *  pupils of the mask; anything this clear is fully room. Only the thin
 *  band between stays soft for anti-alias / hair. */
// Post-#18: dark halo was leftover room rim at mid-alpha. Raise the clear
// floor and lower the opaque ceiling so the soft band is a hair thin — room
// pixels go fully transparent, person core stays fully opaque.
export const HARDEN_OPAQUE = 180;
export const HARDEN_CLEAR = 90;

/** Person-layer matte (source-in punch). Near-binary so the face/cap stay
 *  camera-sharp — mid-alpha dark clothing over a light blur was the dark
 *  fringe, and a wide soft band dissolved the silhouette into waxy blur. */
export const HARDEN_PERSON_OPAQUE = 160;
export const HARDEN_PERSON_CLEAR = 100;

/** Single-value harden — pure, for tests and for reasoning about the curve. */
export function hardenAlpha(
  v: number,
  opaque: number = HARDEN_OPAQUE,
  clear: number = HARDEN_CLEAR,
): number {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  const hi = Math.max(0, Math.min(255, Number(opaque)));
  const lo = Math.max(0, Math.min(255, Number(clear)));
  if (x >= hi) return 255;
  if (x <= lo) return 0;
  return Math.round(Math.max(0, Math.min(255, x)));
}

/** In-place harden of a whole mask buffer. Returns the same array. */
export function hardenMaskAlpha(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  opaque: number = HARDEN_OPAQUE,
  clear: number = HARDEN_CLEAR,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask) return mask;
  for (let i = 0; i < mask.length; i++) {
    mask[i] = hardenAlpha(mask[i] as number, opaque, clear);
  }
  return mask;
}

/** Near-binary harden for the PERSON cutout layer. Soft band is at most a
 *  hair (HARDEN_PERSON_CLEAR..OPAQUE); everything else is 0 or 255. */
export function hardenPersonMatte(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  return hardenMaskAlpha(mask, HARDEN_PERSON_OPAQUE, HARDEN_PERSON_CLEAR);
}

/** Where hard matte is fully opaque, composite RGB must equal the source
 *  camera byte-for-byte (max abs diff <= tol). Pure guard for "face == sharp". */
export function personCoreMatchesSource(
  src: ArrayLike<number>,
  out: ArrayLike<number>,
  alpha: ArrayLike<number>,
  tol: number = 2,
): boolean {
  if (!src || !out || !alpha) return false;
  const n = Math.min(alpha.length, Math.floor(src.length / 4), Math.floor(out.length / 4));
  if (n <= 0) return false;
  const t = Math.max(0, Number(tol) || 0);
  let saw = false;
  for (let i = 0; i < n; i++) {
    if ((alpha[i] as number) < 255) continue;
    saw = true;
    const j = i * 4;
    for (let c = 0; c < 3; c++) {
      if (Math.abs((src[j + c] as number) - (out[j + c] as number)) > t) return false;
    }
  }
  return saw;
}

// ── the blur, and the dark frame nobody ordered ──────────────────────────
//
// FIELD 2026-08-24, visible in the corners of the Blur screenshot: the
// picture is darker at every edge, in a band about as wide as the blur.
// `ctx.filter = blur(24px)` followed by drawImage at exactly the canvas
// bounds means the Gaussian kernel reaches PAST the canvas for most of that
// band and samples transparent black. The result is a vignette that looks
// like a deliberate filter and is in fact an off-by-a-kernel.

/** How far past the canvas the frame must be drawn, as a multiple of the blur
 *  radius. MEASURED, not reasoned: at the very corner of a uniform grey frame
 *  blurred by 24px, the alpha that survives is 156 at one radius of margin,
 *  223 at two, 246 at three and 254 at four. Four it is. (Three is very
 *  nearly right and would have shipped a corner 4% transparent, which over a
 *  dark meeting UI is a faint dark corner — the exact artefact this constant
 *  exists to remove.) */
export const OVERSCAN_K = 4;

/** The rectangle to draw a frame into so a blur of `radius` never samples
 *  outside it. Centred, so nothing shifts — the picture is very slightly
 *  cropped, which is invisible, instead of very slightly transparent at every
 *  edge, which is not.
 *
 *  WHAT THE BUG ACTUALLY WAS, because the first diagnosis was wrong and the
 *  measurement corrected it: the blurred frame does not come out DARKER at
 *  the edges — every channel stays exactly 128. It comes out TRANSPARENT
 *  (alpha 70 in the corner against 255 in the middle), because the Gaussian
 *  averages in the nothing outside the source rectangle. Colour is unchanged,
 *  so a probe that measures luminance sees a clean frame and passes. It is
 *  only when that canvas is composited over the meeting's dark UI that the
 *  missing alpha becomes the dark border people photograph. */
export function overscanRect(W: number, H: number, radius: number = BLUR_PX):
  { x: number; y: number; w: number; h: number } {
  const w = Number(W) || 0, h = Number(H) || 0;
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const r = Math.max(0, Number(radius) || 0);
  // Per side, not in total — the earlier version halved this by growing the
  // rectangle by one margin and splitting it across two edges, and shipped a
  // corner at alpha 168.
  const m = Math.max(w * 0.02, r * OVERSCAN_K);
  const nw = w + 2 * m, nh = h + 2 * m * (h / w || 1);
  return { x: (w - nw) / 2, y: (h - nh) / 2, w: nw, h: nh };
}

/** A single 24px Gaussian across 921,600 pixels, every frame, is the most
 *  expensive thing in the room AND the least like a lens: it smears
 *  uniformly where a real defocus pools light. Drawing the frame small,
 *  blurring it there, and letting the upscale do the rest is both cheaper
 *  and closer to bokeh, because the bilinear upscale adds a second, wider
 *  falloff on top of the first.
 *
 *  Returns the working size and the radius to use at that size. */
export function bokehPass(W: number, H: number, radius: number = BLUR_PX):
  { w: number; h: number; radius: number } {
  const w = Number(W) || 0, h = Number(H) || 0;
  const r = Math.max(1, Number(radius) || 1);
  if (w <= 0 || h <= 0) return { w: 1, h: 1, radius: r };
  // MEASURED against a barcode-and-blocks test card, counting the horizontal
  // detail that survives (lower is blurrier), with a full-size 24px pass as
  // the baseline at 52 / 415 for high and low frequencies:
  //
  //   quarter scale, radius x1.0   248 / 446   ← WORSE. The downscale itself
  //   quarter scale, radius x1.2    65 / 304     aliases fine detail back
  //   half scale,    radius x1.0    25 / 388     into the picture.
  //   half scale,    radius x1.2     6 / 298   ← blurrier than the baseline
  //                                              on BOTH, at a quarter of
  //                                              the cost.
  //
  // Half scale it is. A quarter would have been cheaper still and would have
  // made the room MORE readable, which is the one thing the blur button
  // promises not to do.
  const scale = Math.max(0.5, Math.min(1, 160 / w));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  // 1.2, not 1.0: the bilinear upscale does add softness of its own, but less
  // than it takes away by resampling.
  return { w: sw, h: sh, radius: Math.max(1, Math.round(r * scale * 1.2)) };
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
/** Meet uses a landscape-variant selfie model; square mis-segments wide webcam scenes. */
export const SELFIE_LANDSCAPE_CDN =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";

export const LOCAL_ASSETS = {
  tasksVisionFileSet: "/mediapipe/wasm",
  // Prefer landscape local asset; square is not the primary even if present.
  modelAssetPath: "/mediapipe/selfie_segmenter_landscape.tflite",
};

/** Whether the shipped assets are actually present in this deployment. A
 *  missing file must fall back to the CDN, not to a broken effect — the
 *  vendored copy is an optimisation, never a dependency. */
export function assetPaths(local: { wasm: boolean; model: boolean }):
  { tasksVisionFileSet?: string; modelAssetPath?: string } | undefined {
  const out: { tasksVisionFileSet?: string; modelAssetPath?: string } = {};
  if (local?.wasm) out.tasksVisionFileSet = LOCAL_ASSETS.tasksVisionFileSet;
  // Only use local model when the landscape file is present — do not keep
  // square selfie_segmenter.tflite as primary.
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

/** Drop disconnected false-person islands (couch / plant chunks). Keep the
 *  main person component that intersects CENTER_BOX; if none intersect, keep
 *  the globally largest. Mutates and returns the same alpha buffer. */
export function keepCenterPersonIsland(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  box: { x: number; y: number; w: number; h: number } = CENTER_BOX,
  personThresh: number = HARDEN_PERSON_CLEAR,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const thresh = Math.max(0, Math.min(255, Number(personThresh)));
  const t = Number.isFinite(thresh) ? thresh : HARDEN_PERSON_CLEAR;
  const visited = new Uint8Array(n);
  type Comp = { area: number; hitsCenter: boolean; pixels: number[] };
  const comps: Comp[] = [];
  const bx0 = Math.max(0, Math.floor(box.x * W));
  const by0 = Math.max(0, Math.floor(box.y * H));
  const bx1 = Math.min(W, Math.ceil((box.x + box.w) * W));
  const by1 = Math.min(H, Math.ceil((box.y + box.h) * H));
  const inCenter = (x: number, y: number) =>
    x >= bx0 && x < bx1 && y >= by0 && y < by1;

  for (let i = 0; i < n; i++) {
    if (visited[i] || (mask[i] as number) < t) continue;
    const pixels: number[] = [];
    let area = 0;
    let hitsCenter = false;
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      area++;
      const x = p % W;
      const y = (p / W) | 0;
      if (inCenter(x, y)) hitsCenter = true;
      const neigh = [
        x > 0 ? p - 1 : -1,
        x + 1 < W ? p + 1 : -1,
        y > 0 ? p - W : -1,
        y + 1 < H ? p + W : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const q = neigh[k];
        if (q < 0 || visited[q] || (mask[q] as number) < t) continue;
        visited[q] = 1;
        stack.push(q);
      }
    }
    comps.push({ area, hitsCenter, pixels });
  }
  if (!comps.length) return mask;
  const centerOnes = comps.filter((c) => c.hitsCenter);
  const pool = centerOnes.length ? centerOnes : comps;
  let best = pool[0];
  for (let k = 1; k < pool.length; k++) {
    if (pool[k].area > best.area) best = pool[k];
  }
  const keep = new Uint8Array(n);
  for (let k = 0; k < best.pixels.length; k++) keep[best.pixels[k]] = 1;
  for (let i = 0; i < n; i++) {
    if ((mask[i] as number) >= t && !keep[i]) mask[i] = 0;
  }
  return mask;
}


/** Morphological open radius at segment resolution. Small disk/square breaks
 *  thin chair→couch bridges without shaving wide shoulders (floating-head fix).
 *  Edge-spill: bumped 3→4 so medium plant blobs detach more reliably. */
export const OPEN_RADIUS_PX = 4;

/** Upper fraction of the frame left untouched by morphological open.
 *  Full 2D open flattens rounded baseball-cap crowns (square SE removes the
 *  tip; dilate restores a flat top). Ear/shoulder plant is cut by trapezoid
 *  face-hull X instead — open only needs to break chair→couch bridges below. */
export const OPEN_CROWN_BAND = 0.30;

/** Morphological opening on the person matte: binary threshold → erode →
 *  dilate, then zero person pixels that the open removed (bridges / thin
 *  islands). Restores original alpha for survivors. Call before
 *  keepCenterPersonIsland. Mutates and returns the same buffer. */
export function openPersonMask(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  radiusPx: number = OPEN_RADIUS_PX,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const r = Math.max(0, Math.min(8, Math.floor(Number(radiusPx)) || 0));
  const thresh = HARDEN_PERSON_CLEAR;
  if (r === 0) {
    // Still useful as a no-op identity for tests / radius override.
    return mask;
  }
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = (mask[i] as number) >= thresh ? 1 : 0;
  // Crown band: leave silhouette unchanged (preserve rounded cap). Below: full open.
  const crownY = Math.ceil(H * OPEN_CROWN_BAND);

  // Erode with square SE of radius r (pixel stays only if full window is set).
  const eroded = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    if (y < crownY) continue; // crown: skip — opened stays identity below
    for (let x = 0; x < W; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        const yy = y + dy;
        // Allow SE to look into crown band for context, but do not rewrite crown rows.
        if (yy < 0 || yy >= H) { keep = 0; break; }
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || !bin[yy * W + xx]) { keep = 0; break; }
        }
      }
      eroded[y * W + x] = keep;
    }
  }

  // Dilate eroded with same SE. Crown rows stay as original bin.
  const opened = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    if (y < crownY) {
      for (let x = 0; x < W; x++) opened[y * W + x] = bin[y * W + x];
      continue;
    }
    for (let x = 0; x < W; x++) {
      let any = 0;
      for (let dy = -r; dy <= r && !any; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H || yy < crownY) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (eroded[yy * W + xx]) { any = 1; break; }
        }
      }
      opened[y * W + x] = any;
    }
  }

  // Zero person pixels that opening removed (bridges / thin protrusions).
  for (let i = 0; i < n; i++) {
    if ((mask[i] as number) >= thresh && !opened[i]) mask[i] = 0;
  }
  return mask;
}

/** Full-height soft side gate — kills left/right furniture & plants without
 *  cutting the torso vertically (unlike TORSO_GATE ellipse → floating head).
 *  Core kept where |nx-0.5| <= halfWidth; soft falloff over next falloff of
 *  frame width to zero. Mutates person alphas by gate weight. */
export const LATERAL_GATE = {
  halfWidth: 0.34,
  falloff: 0.06,
};

export type LateralGateOpts = {
  halfWidth?: number;
  falloff?: number;
};

export function lateralPersonGate(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  opts?: LateralGateOpts,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const half = Math.max(0.05, Math.min(0.49, Number(opts?.halfWidth ?? LATERAL_GATE.halfWidth)));
  const fall = Math.max(0.01, Math.min(0.25, Number(opts?.falloff ?? LATERAL_GATE.falloff)));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = mask[i] as number;
      if (a <= 0) continue;
      const nx = (x + 0.5) / W;
      const d = Math.abs(nx - 0.5);
      let g = 1;
      if (d > half) {
        const t = (d - half) / fall;
        g = t >= 1 ? 0 : 1 - t;
      }
      if (g <= 0) mask[i] = 0;
      else if (g < 1) mask[i] = Math.round(a * g);
    }
  }
  return mask;
}

/** Zero remaining person components whose area is below max(48, minAreaFrac
 *  of frame). Kills tiny/medium plant flecks that survive open+island+lateral.
 *  Must NOT remove the main body. Mutates and returns the same buffer. */
export const DESPECKLE_MIN_AREA_FRAC = 0.008;

export function despecklePersonMask(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  minAreaFrac: number = DESPECKLE_MIN_AREA_FRAC,
  personThresh: number = HARDEN_PERSON_CLEAR,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const thresh = Math.max(0, Math.min(255, Number(personThresh)));
  const t = Number.isFinite(thresh) ? thresh : HARDEN_PERSON_CLEAR;
  const frac = Math.max(0, Number(minAreaFrac) || 0);
  const minArea = Math.max(48, Math.floor(n * frac));
  const visited = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (visited[i] || (mask[i] as number) < t) continue;
    const pixels: number[] = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % W;
      const y = (p / W) | 0;
      const neigh = [
        x > 0 ? p - 1 : -1,
        x + 1 < W ? p + 1 : -1,
        y > 0 ? p - W : -1,
        y + 1 < H ? p + W : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const q = neigh[k];
        if (q < 0 || visited[q] || (mask[q] as number) < t) continue;
        visited[q] = 1;
        stack.push(q);
      }
    }
    if (pixels.length < minArea) {
      for (let k = 0; k < pixels.length; k++) mask[pixels[k]] = 0;
    }
  }
  return mask;
}

/** Find topmost row in center-third width with enough person pixels
 *  (count >= 0.08 * W_center). Returns -1 if none. Pure mask geometry. */
export function findCrownY(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  personThresh: number = HARDEN_PERSON_CLEAR,
): number {
  if (!mask || !mw || !mh) return -1;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return -1;
  const t = Math.max(0, Math.min(255, Number(personThresh)));
  const x0 = Math.floor(W / 3);
  const x1 = Math.ceil((2 * W) / 3);
  const wCenter = Math.max(1, x1 - x0);
  const need = Math.max(1, Math.ceil(0.08 * wCenter));
  // Row person count in center third.
  const rowCount = (y: number): number => {
    let c = 0;
    for (let x = x0; x < x1; x++) {
      if ((mask[y * W + x] as number) >= t) c++;
    }
    return c;
  };
  // Require sustained mass over 4 rows so thin plant/blur spikes do not
  // register as the crown — only the compact head top does.
  const RUN = 4;
  for (let y = 0; y <= H - RUN; y++) {
    let ok = true;
    for (let dy = 0; dy < RUN; dy++) {
      if (rowCount(y + dy) < need) { ok = false; break; }
    }
    if (ok) return y;
  }
  return -1;
}

/** Zero thin plant / blur-rectangle protrusions above the compact head mass.
 *  Pure mask geometry (no RGB). Center-half width only. Mutates. */
export function suppressCrownProtrusions(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  personThresh: number = HARDEN_PERSON_CLEAR,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const t = Math.max(0, Math.min(255, Number(personThresh)));
  const crownY = findCrownY(mask, W, H, t);
  if (crownY < 0) return mask;
  const xL = Math.floor(W * 0.25);
  const xR = Math.ceil(W * 0.75);
  const cut = Math.max(0, crownY - 2);
  // Everything above the solid head mass in center half is a protrusion.
  for (let y = 0; y < cut; y++) {
    for (let x = xL; x < xR; x++) {
      const i = y * W + x;
      if ((mask[i] as number) > 0) mask[i] = 0;
    }
  }
  // Thin 1–3px tall spikes sitting on the silhouette top in center half:
  // person pixel with little mass in the 4 rows immediately below → kill.
  const yEnd = Math.min(H, crownY + 4);
  for (let y = cut; y < yEnd; y++) {
    for (let x = xL; x < xR; x++) {
      const i = y * W + x;
      if ((mask[i] as number) < t) continue;
      let below = 0;
      for (let dy = 1; dy <= 4; dy++) {
        const yy = y + dy;
        if (yy >= H) break;
        if ((mask[yy * W + x] as number) >= t) below++;
      }
      // Spike: at most 3 consecutive person rows including this one → below < 3
      // and row above empty (or already cleared).
      const aboveEmpty = y === 0 || (mask[(y - 1) * W + x] as number) < t;
      if (aboveEmpty && below <= 2) mask[i] = 0;
    }
  }
  return mask;
}

/** Zero leaf-green person pixels. Protects green clothing near face (middle
 *  of head box) but NEVER protects leaf-green in the crown band (plant on
 *  cap). Requires RGBA 1:1 with mask dims. Mutates. */
export function suppressLeafLeaks(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  rgba: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !rgba || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n || rgba.length < n * 4) return mask;
  // Center 30% width, upper ~45% — keep green clothing/hair near face.
  const x0 = Math.floor(W * 0.35);
  const x1 = Math.ceil(W * 0.65);
  const y1 = Math.ceil(H * 0.45);
  const crownBand = Math.ceil(H * 0.18);
  const crownSoft = Math.ceil(H * 0.28);
  const crownY = findCrownY(mask, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if ((mask[i] as number) <= 0) continue;
      const j = i * 4;
      const r = rgba[j] as number;
      const g = rgba[j + 1] as number;
      const b = rgba[j + 2] as number;
      // Slightly lower thresholds catch yellowish-green plant fringe.
      const leaf = g > r + 12 && g > b + 8;
      if (!leaf) continue;
      // Crown band: always kill leaf-green (plant on cap sits in head box).
      if (y < crownBand) {
        mask[i] = 0;
        continue;
      }
      // Soft crown: leaf-green above the solid head mass also dies.
      if (y < crownSoft && crownY >= 0 && y < crownY) {
        mask[i] = 0;
        continue;
      }
      // Head box middle: keep green clothing/hair near face.
      if (x >= x0 && x < x1 && y < y1) continue;
      mask[i] = 0;
    }
  }
  return mask;
}

/** MediaPipe BlazeFace short-range — CDN when public/mediapipe/ is absent. */
export const BLAZE_FACE_CDN =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

/** How long to reuse the last good face hull when a frame misses detection.
 *  Short enough that a walk-off does not keep a stale box; long enough that
 *  a blink of the detector does not drop the constraint. */
export const FACE_HULL_HOLD_MS = 400;

/** Expand a normalized face box (x,y,w,h in 0..1) into a seated person hull:
 *  cap room above, shoulders/torso below, shoulder width each side. */
export const FACE_HULL = {
  /** Extend upward as a fraction of face height (API/tests; qbg applies X-only so Y unused there). */
  top: 0.50,
  /** Extend downward as a multiple of face height (shoulders + seated torso). */
  bottom: 2.2,
  /** ExpandFaceHull box side pad (fraction of face width). Mid fallback. */
  side: 0.55,
  /** Trapezoid X: tight pad beside head/ears (cuts plant without Y crown cut). */
  sideHead: 0.28,
  /** Trapezoid X: wider pad at shoulders (keeps arms; still cuts far furniture). */
  shoulderSide: 0.85,
  /** Soft alpha falloff outside the hard hull, as a fraction of frame size. */
  falloff: 0.04,
};

export type FaceBoxNorm = { x: number; y: number; w: number; h: number };
/** Expanded person hull plus face-core box for height-varying (trapezoid) X. */
export type FaceHull = {
  x0: number; y0: number; x1: number; y1: number;
  fx0: number; fy0: number; fx1: number; fy1: number;
};

export type FaceHullOpts = {
  top?: number;
  bottom?: number;
  side?: number;
};

/** Expand a normalized face bounding box into a hard person hull (0..1).
 *  Returns null when the box is unusable — callers then skip the constraint
 *  rather than blanking the person. */
export function expandFaceHull(
  box: FaceBoxNorm | null | undefined,
  opts?: FaceHullOpts,
): FaceHull | null {
  if (!box) return null;
  const fx = Number(box.x), fy = Number(box.y);
  const fw = Number(box.w), fh = Number(box.h);
  if (!(fw > 0 && fh > 0) || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  const top = Number(opts?.top ?? FACE_HULL.top);
  const bottom = Number(opts?.bottom ?? FACE_HULL.bottom);
  const side = Number(opts?.side ?? FACE_HULL.side);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(side)) return null;
  // Hard box keeps FACE_HULL.side (axes=xy). Trapezoid X uses face core + sideHead/shoulderSide.
  const x0 = Math.max(0, Math.min(1, fx - side * fw));
  const x1 = Math.max(0, Math.min(1, fx + fw + side * fw));
  const y0 = Math.max(0, Math.min(1, fy - top * fh));
  const y1 = Math.max(0, Math.min(1, fy + fh + bottom * fh));
  if (!(x1 > x0) || !(y1 > y0)) return null;
  const fx0 = Math.max(0, Math.min(1, fx));
  const fy0 = Math.max(0, Math.min(1, fy));
  const fx1 = Math.max(0, Math.min(1, fx + fw));
  const fy1 = Math.max(0, Math.min(1, fy + fh));
  if (!(fx1 > fx0) || !(fy1 > fy0)) return null;
  return { x0, y0, x1, y1, fx0, fy0, fx1, fy1 };
}

export type FaceHullApplyOpts = {
  /** Which axes to constrain. Default "x": kill side leaks without shaving cap top. */
  axes?: "x" | "xy" | "y";
};

/** Intersect the person matte with an expanded face→shoulders hull.
 *  Hard-zeros outside; soft-multiplies alpha in a falloff band (~0.04 frame).
 *  Default axes="x" (sides only) — Y cut shaves baseball caps / crowns.
 *  When hull is null/undefined the mask is LEFT UNCHANGED — never wipe the
 *  person just because the face detector blinked. Mutates and returns mask. */
export function applyFaceHullMask(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  hull: FaceHull | null | undefined,
  falloff?: number,
  opts?: FaceHullApplyOpts,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh || !hull) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const x0 = Number(hull.x0), y0 = Number(hull.y0);
  const x1 = Number(hull.x1), y1 = Number(hull.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) return mask;
  const fo = Math.max(0, Number(falloff ?? FACE_HULL.falloff));
  const axes = opts?.axes === "xy" || opts?.axes === "y" ? opts.axes : "x";
  const useX = axes === "x" || axes === "xy";
  const useY = axes === "y" || axes === "xy";
  // Trapezoid X (axes=x): tight beside head, wide at shoulders — color-agnostic
  // cut of plant/furniture attached near ears/shoulders without any Y crown cut.
  const fx0 = Number(hull.fx0), fy0 = Number(hull.fy0);
  const fx1 = Number(hull.fx1), fy1 = Number(hull.fy1);
  const hasFace = [fx0, fy0, fx1, fy1].every(Number.isFinite) && fx1 > fx0 && fy1 > fy0;
  const fw = hasFace ? (fx1 - fx0) : 0;
  const fh = hasFace ? (fy1 - fy0) : 0;
  const sideHead = Math.max(0, Number(FACE_HULL.sideHead));
  const sideShoulder = Math.max(sideHead, Number(FACE_HULL.shoulderSide));
  const faceBot = hasFace ? fy1 : 0;
  const shoulderY = hasFace ? Math.min(1, fy1 + 0.9 * fh) : 0;
  const useTrapezoid = useX && !useY && hasFace && fw > 0;

  for (let y = 0; y < H; y++) {
    const ny = (y + 0.5) / H;
    let rowX0 = x0, rowX1 = x1;
    if (useTrapezoid) {
      let padFrac = sideShoulder;
      if (ny <= faceBot) padFrac = sideHead;
      else if (ny < shoulderY) {
        const t = (ny - faceBot) / Math.max(1e-6, shoulderY - faceBot);
        padFrac = sideHead + t * (sideShoulder - sideHead);
      }
      const pad = padFrac * fw;
      rowX0 = Math.max(0, fx0 - pad);
      rowX1 = Math.min(1, fx1 + pad);
    }
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = mask[i] as number;
      if (a <= 0) continue;
      const nx = (x + 0.5) / W;
      const ox = useX ? (nx < rowX0 ? rowX0 - nx : nx > rowX1 ? nx - rowX1 : 0) : 0;
      const oy = useY ? (ny < y0 ? y0 - ny : ny > y1 ? ny - y1 : 0) : 0;
      if (ox === 0 && oy === 0) continue; // inside hard hull (on active axes)
      const d = Math.hypot(ox, oy);
      if (fo <= 0 || d >= fo) {
        mask[i] = 0;
      } else {
        const g = 1 - d / fo;
        mask[i] = Math.round(a * g);
      }
    }
  }
  return mask;
}

/** @deprecated Not wired in qbg — width=0.55 ellipse caused floating-head
 *  (shoulders clipped). Prefer openPersonMask + keepCenterPersonIsland.
 *  Kept for unit tests / rollback. Soft upper-body gate defaults (normalized). */
export const TORSO_GATE = {
  cx: 0.5,
  top: 0.02,
  bottom: 0.78,
  width: 0.55,
  /** Soft falloff outside the core ellipse, as a fraction of frame height. */
  falloff: 0.06,
};

export type TorsoGateOpts = {
  cx?: number;
  top?: number;
  bottom?: number;
  width?: number;
  falloff?: number;
};

/** @deprecated Not wired in qbg (floating-head from TORSO_GATE.width=0.55).
 *  Soft vertical stadium / ellipse gate — kept for tests only. Mutates. */
export function torsoGateMask(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
  opts?: TorsoGateOpts,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const cx = Number(opts?.cx ?? TORSO_GATE.cx);
  const top = Number(opts?.top ?? TORSO_GATE.top);
  const bottom = Number(opts?.bottom ?? TORSO_GATE.bottom);
  const width = Number(opts?.width ?? TORSO_GATE.width);
  const falloff = Math.max(0.01, Number(opts?.falloff ?? TORSO_GATE.falloff));
  const rx = Math.max(1e-3, width * 0.5);
  const cy = (top + bottom) * 0.5;
  const ry = Math.max(1e-3, (bottom - top) * 0.5);
  const soft = falloff;
  for (let y = 0; y < H; y++) {
    const ny = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = mask[i] as number;
      if (a <= 0) continue;
      const nx = (x + 0.5) / W;
      const dx = (nx - cx) / rx;
      const dy = (ny - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      let g = 1;
      if (d > 1) {
        const t = (d - 1) / Math.max(1e-3, soft / Math.max(ry, 1e-3));
        g = t >= 1 ? 0 : 1 - t;
      }
      if (g <= 0) mask[i] = 0;
      else if (g < 1) mask[i] = Math.round(a * g);
    }
  }
  return mask;
}

/** @deprecated Not wired in qbg — worsened floating-head with torsoGate.
 *  Stronger zeroing for lower furniture bands; kept for tests only. Mutates. */
export function suppressLowerRoom(
  mask: Uint8ClampedArray | Uint8Array | number[] | null | undefined,
  mw: number,
  mh: number,
): Uint8ClampedArray | Uint8Array | number[] | null | undefined {
  if (!mask || !mw || !mh) return mask;
  const W = Math.max(0, Math.floor(Number(mw)) || 0);
  const H = Math.max(0, Math.floor(Number(mh)) || 0);
  const n = W * H;
  if (!n || mask.length < n) return mask;
  const yCut = Math.floor(0.82 * H);
  const xLeft = Math.floor(0.22 * W);
  const xRight = Math.ceil(0.78 * W);
  const yCorner = Math.floor(0.72 * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if ((mask[i] as number) <= 0) continue;
      if (y >= yCut) {
        mask[i] = 0;
        continue;
      }
      if (y >= yCorner && (x < xLeft || x >= xRight)) {
        mask[i] = 0;
      }
    }
  }
  return mask;
}

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

// ── the halo, and the backdrop that never arrived ─────────────────────────
//
// FIELD 2026-08-20, third report: "blur is not effective around the edges of
// the people" and "Nebula, Gridline, Dusk, Boardroom are showing same without
// any change." Two more faults, both mine, both proven in pixels before this
// was written.
//
// THE BACKDROP THAT NEVER ARRIVED. The image path painted the real room
// blurred FIRST ("defence in depth, so a sliver the mask misses leaks a
// smear") and then drew the chosen backdrop with `destination-over`. But the
// blurred room had already filled every transparent pixel — destination-over
// had nothing left to paint. The backdrop was composited behind an opaque
// layer, i.e. thrown away, and every image effect rendered as plain blur.
// That is exactly "showing same without any change". The under-blur is
// deleted: a backdrop that covers the whole background IS the privacy
// measure, and a sliver the mask misses now shows the backdrop.
//
// THE HALO. MediaPipe's selfie mask is generous — it keeps a rim of real
// room around the person, a few pixels of shoulder-shaped wallpaper. Feather
// that rim and it is still SHARP background, drawn at full strength right
// where the eye is looking. So the silhouette is pulled IN before it is
// feathered: erode first, then soften. A person cropped a hair tight reads
// as depth of field; a sharp outline of their room reads as a cut-out.

/** How far to pull the silhouette inside the mask's own edge, in output
 *  pixels at that height. ~0.8% — 6px at 720p — which is about the width of
 *  the rim the selfie model habitually leaves. More than this starts eating
 *  fingers and the tips of hair. */
export function erodePx(outputHeight: number): number {
  const h = Number(outputHeight) || 0;
  if (h <= 0) return 2;
  // Pull inside the selfie room-rim (~3-4px at 720p) so dark edge pixels
  // go to the blur plate, not the person layer. Paired with 1px AA feather.
  return Math.max(2, Math.min(4, Math.round(h * 0.0045)));
}

/** The mask is blurred ONCE, by enough to carry both jobs: the erosion needs
 *  a soft ramp to bite on, and the feather is what is left over after the
 *  ramp's midpoint has been pushed inward. */
export function maskBlurPx(outputHeight: number): number {
  return featherPx(outputHeight) + erodePx(outputHeight);
}

/** Erosion is done by raising the blurred mask's alpha to a power: a soft
 *  ramp raised to n has its half-way point moved toward the opaque side, and
 *  a canvas can do it in n-1 self-composites with `source-in`. Guarded here
 *  because "shrink the silhouette" is a claim about a curve, and a curve can
 *  be checked without a camera. */
export const ERODE_POWER = 5;

export function alphaAfterGamma(alpha: number, power: number = ERODE_POWER): number {
  const raw = Number(alpha);
  // Math.min(1, NaN) is NaN and Math.max(0, NaN) is NaN — a clamp does NOT
  // launder a NaN. A NaN alpha paints nothing and leaves no trace to debug,
  // so it is turned into "fully transparent" here, explicitly.
  const a = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  const n = Math.max(1, Math.round(Number(power) || 1));
  return Math.pow(a, n);
}

/** Where the silhouette's edge ends up: the alpha that USED to be the 50%
 *  line is now somewhere lower, so the boundary sits further inside the
 *  person. Returns the alpha that now reads as the edge — strictly greater
 *  than 0.5 for any power above 1, which is the whole point. */
export function edgeAlphaAfterErode(power: number = ERODE_POWER): number {
  return Math.pow(0.5, 1 / Math.max(1, Math.round(Number(power) || 1)));
}

/** The composite pipeline, named once so both the renderer and the guards
 *  agree on it. Normalising the mask to ALWAYS mean "the person" removes the
 *  polarity branch from the paint path — it is decided once, when the mask
 *  is built, instead of at every composite where it can be got wrong. */
export function needsInvert(p: Polarity): boolean {
  return p === "background";
}

// ── WebGL2 Meet-style compositor (v1) ─────────────────────────────────────
//
// Canvas2d hist/personFreeBlur left a waxy face and dark halo. The GL path
// blurs background with (1-mask) weighting and composites sharp person at
// full res. Probe is pure so Node tests can pass { webgl2: true|false }.

/** True when the WebGL2 compositor should be preferred over canvas2d.
 *  In the browser, omit probe to try OffscreenCanvas/canvas getContext.
 *  In tests, pass { webgl2: boolean } explicitly. */
export function webglCompositeReady(probe?: { webgl2?: boolean } | null): boolean {
  if (probe && typeof probe.webgl2 === "boolean") return probe.webgl2;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(1, 1);
      const gl = c.getContext("webgl2");
      if (gl) {
        try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
        return true;
      }
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      if (gl) {
        try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
        return true;
      }
    }
  } catch { /* no GL in this environment */ }
  return false;
}

// ── the three tweaks asked for alongside the backdrops ───────────────────

/** THE DEFAULT BACKGROUND. Somebody who has never chosen gets plain video.
 *
 *  Not blur — and this is a deliberate refusal of the "privacy-safe default"
 *  argument. Blur costs a segmentation model on every frame of every meeting
 *  for every person, including the ones on a four-year-old laptop who would
 *  experience it as "this app is slow" rather than as a feature; and a person
 *  who has not asked to be hidden has not asked to be hidden. The choice is
 *  one click away and it is REMEMBERED, which is the part that actually
 *  matters. */
export const DEFAULT_EFFECT_ID = "none";

/** CONNECTION QUALITY. Effects are the most expensive thing in the room, and
 *  a machine that is struggling shows it as dropped frames — which people
 *  read as "the call is bad", never as "my background is costing me". So say
 *  it, once, and offer the one-tap fix.
 *
 *  Only when an effect is actually ON: telling somebody on plain video that
 *  their connection is poor is the connection banner's job, not this one.
 *  And never for a blip — `poorFor` is how long it has been bad, so a single
 *  bad reading cannot nag somebody mid-sentence. */
export const QUALITY_NAG_MS = 12_000;

export function effectCostNote(s: {
  quality: string;
  effectOn: boolean;
  poorForMs: number;
}): string {
  const q = String(s.quality || "").toLowerCase();
  if (!s.effectOn) return "";
  if (!(q === "poor" || q === "lost")) return "";
  if ((Number(s.poorForMs) || 0) < QUALITY_NAG_MS) return "";
  return "Your picture is struggling. Backgrounds are the most expensive thing your computer is doing right now — turning yours off usually clears it up straight away.";
}

/** SETTINGS PANEL STATE. The panel is where somebody goes to fix a problem,
 *  so it must (a) close on Escape like every other panel on the web, (b)
 *  close when they click away, and (c) STAY OPEN while they try backgrounds,
 *  because choosing a backdrop is a comparison and a panel that closes on
 *  each pick makes comparing impossible.
 *
 *  Pure so the "does this click close it" question has one answer with one
 *  guard, rather than three event handlers each with an opinion. */
export function panelShouldClose(ev: {
  reason: "escape" | "outside" | "pick" | "toggle" | "close-button";
}): boolean {
  switch (ev?.reason) {
    case "escape":
    case "outside":
    case "toggle":
    case "close-button":
      return true;
    case "pick":
      return false;   // comparing backdrops is the whole point of the shelf
    default:
      return false;
  }
}
