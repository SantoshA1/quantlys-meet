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
  if (h <= 0) return 2;
  // FIELD 2026-08-24, from two screenshots: "the backgrounds and the blur
  // quality is really bad". The old value was 1.1% of height — 8px at 720p,
  // and 14px once erosion was added on top. That much softness was never a
  // choice about how an edge should look; it was camouflage for a BINARY
  // mask at 384x216 upscaled 3.3x, whose staircase had to be hidden. A hat
  // brim dissolving over thirty pixels is what camouflage costs.
  //
  // The mask is a confidence mask now (see confidenceToAlpha) — it arrives
  // soft, with real values in the hair — so the feather goes back to being
  // what it says it is: the last touch that stops a boundary reading as a
  // cut line. ~0.4% of height: 3px at 720p, 2px at 360p.
  return Math.max(1, Math.min(6, Math.round(h * 0.004)));
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
 *  gesture within ~2-3 frames while removing the shimmer of a still head.
  Retuned 2026-09-03 from 0.6 to 0.72 so a head turn does not smear; hair
  softness still comes from confidence alpha, not from temporal lag.
 *
 *  Written as a mutation of `prev` and returning it, because this runs on
 *  every frame at 921,600 subpixels and allocation is the enemy. */
export const MASK_SMOOTHING = 0.72;

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
 *  side they were already leaning. 6 is firm enough to give a clean edge and
 *  soft enough to keep the strands of hair that are the whole point. */
export const MASK_CONTRAST = 6;

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
  // Same correction as the feather. Erosion still earns its place — the
  // selfie model keeps a rim of real room around a person and that rim must
  // be pulled into the blur — but it needs a ramp of two or three pixels to
  // bite on, not six. ~0.3% of height.
  return Math.max(1, Math.min(5, Math.round(h * 0.003)));
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
export const ERODE_POWER = 2;

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
