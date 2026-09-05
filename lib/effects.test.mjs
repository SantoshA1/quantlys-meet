/**
 * MAYA GUARD — background effects: the flashing, and the cut-out look.
 *
 * Maya asks: "I pressed Blur. Why does my picture strobe, why can I still
 * read the books on my shelf, and why do I look like a sticker somebody
 * pasted onto a wall?"
 *
 * FIELD 2026-08-20, live meeting on a Logitech BRIO. Three faults, one
 * complaint — all of them a pipeline showing something it had not computed:
 *   1. the stock transformer republishes its LAST canvas when the mask is
 *      late (it is late often — the mask is written by an async callback);
 *   2. the mask is a fresh per-frame decision boundary feathered by a fixed
 *      3px, so the edge crawls and reads as a cut-out;
 *   3. blurRadius 12 leaves a room legible, which breaks the privacy promise
 *      the button makes.
 *
 * Run: node lib/effects.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  confidenceToAlpha, MASK_CONTRAST, overscanRect, OVERSCAN_K, bokehPass,
  BLUR_PX, BACKDROP_DOF_PX, IMAGE_UNDERBLUR_PX, featherPx, SEGMENT_HZ, shouldSegment,
  MASK_SMOOTHING, MASK_SMOOTHING_FAST, MASK_SMOOTHING_STILL, MASK_DELTA_FAST, blendMask,
  maskMeanAbsDelta, adaptiveSmoothAlpha, warmupPaint, SEGMENT_WIDTH, segmentSize,
  MASK_MAX_AGE_MS, maskIsFresh,
  PLATE_DILATE_FRAC, HIST_DILATE, plateDilatePx, plateFillSize, boxMeanLuma,
  shouldDropFrame, LOCAL_ASSETS, assetPaths, shouldApplyEffect,
  PROC_PREFIX, procName, effectIdOfProcessor,
  CENTER_BOX, POLARITY_MARGIN, maskPolarity, keepComposite, boxMean, edgeMean,
  erodePx, maskBlurPx, ERODE_POWER, alphaAfterGamma, edgeAlphaAfterErode, needsInvert,
  HARDEN_OPAQUE, HARDEN_CLEAR, hardenAlpha, hardenMaskAlpha,
  HARDEN_PERSON_OPAQUE, HARDEN_PERSON_CLEAR, hardenPersonMatte, openPersonMask, OPEN_RADIUS_PX, OPEN_CROWN_BAND, keepCenterPersonIsland, expandFaceHull, applyFaceHullMask, FACE_HULL, FACE_HULL_HOLD_MS, BLAZE_FACE_CDN, lateralPersonGate, LATERAL_GATE, despecklePersonMask, DESPECKLE_MIN_AREA_FRAC, findCrownY, suppressCrownProtrusions, suppressLeafLeaks, torsoGateMask, suppressLowerRoom, TORSO_GATE, SELFIE_LANDSCAPE_CDN, personCoreMatchesSource,
  DEFAULT_EFFECT_ID, effectCostNote, QUALITY_NAG_MS, panelShouldClose,
  webglCompositeReady,
} from "./effects.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. THE FLASH: never publish a frame you did not just paint ───────────
ok(warmupPaint({ wantsEffect: true, hasMask: false }) === "blur-all",
  "cold start (no matte, no hist) → blur-all for privacy while the model loads");
ok(warmupPaint({ wantsEffect: true, hasMask: true }) === "masked",
  "fresh mask → the normal masked paint");
ok(warmupPaint({ wantsEffect: false, hasMask: false }) === "raw",
  "no effect wanted → the camera's own frame, untouched");
ok(warmupPaint({ wantsEffect: true, hasMask: false, haveMask: true }) === "masked",
  "stale last-mask still paints masked — NEVER blur-all the face (waxy-face bug)");
ok(warmupPaint({ wantsEffect: true, hasMask: false, histReady: true }) === "raw",
  "hist ready but no matte → sharp passthrough, not a Gaussian over the subject");
ok(["raw", "blur-all", "masked"].includes(warmupPaint({ wantsEffect: true, hasMask: false })),
  "there is deliberately no freeze/hold verdict — a stale frame IS the flashing");
ok(warmupPaint({ wantsEffect: true, hasMask: false, haveMask: false, histReady: false }) === "blur-all",
  "while the model loads with nothing else ready the room is blurred — privacy from frame one");

// ── the OTHER flash: the effect re-applying itself for ever ──────────────
const A = (o = {}) => ({ wantedId: "blur", liveId: "", hasTrack: true, busy: false, ...o });
ok(shouldApplyEffect(A()) === true,
  "a bare track that should be wearing blur gets it");
ok(shouldApplyEffect(A({ liveId: "blur" })) === false,
  "a track ALREADY wearing blur is left alone — this is the whole fix: setProcessor swaps the track, which used to re-trigger the watcher, which re-applied, for ever, flashing raw camera every lap");
ok(shouldApplyEffect(A({ liveId: "dusk" })) === true,
  "a track wearing the WRONG effect is corrected");
ok(shouldApplyEffect(A({ busy: true })) === false,
  "an application already in flight is never doubled — two setProcessors in one tick is two flashes");
ok(shouldApplyEffect(A({ hasTrack: false })) === false,
  "no camera track, nothing to dress");
ok(shouldApplyEffect(A({ wantedId: "none", liveId: "" })) === false,
  "wanting no effect on a bare track is already true — doing nothing is the correct action");
ok(shouldApplyEffect(A({ wantedId: "none", liveId: "blur" })) === true,
  "turning an effect OFF is still a change that must be applied");

// the name is the memory: it is how a live track answers "what are you wearing"
ok(procName("blur") === PROC_PREFIX + "blur", "the processor's name carries the effect id");
ok(effectIdOfProcessor(procName("dusk")) === "dusk", "…and reads back out again");
ok(effectIdOfProcessor("background-blur") === "",
  "a processor somebody else installed reads as unknown, never as ours");
ok(effectIdOfProcessor(null) === "" && effectIdOfProcessor(undefined) === "",
  "an absent processor is an empty answer, never a crash");

// ── 2. THE CUT-OUT LOOK: memory in the edge, feather in proportion ───────
const flat = (v, n = 16) => new Uint8ClampedArray(n).fill(v);
ok(blendMask(null, flat(255)) instanceof Uint8ClampedArray,
  "the first mask is adopted whole — a half-blended first frame is a ghost of somebody who was never there");
{
  const prev = flat(0), next = flat(100);
  const out = blendMask(prev, next, 0.6);
  ok(Math.abs(out[0] - 60) < 1.5, "a new mask is mixed into the old one, not swapped for it — this is what gives the edge memory and kills the crawl");
}
{
  // convergence: a still person's edge must settle, not oscillate
  let m = flat(0);
  for (let i = 0; i < 12; i++) m = blendMask(m, flat(255), MASK_SMOOTHING);
  ok(m[0] > 250, "a steady mask converges — a still head does not shimmer");
}
{
  // responsiveness: a moving hand must arrive within a few frames
  let m = flat(255);
  let frames = 0;
  while (m[0] > 40 && frames < 20) { m = blendMask(m, flat(0), MASK_SMOOTHING); frames++; }
  ok(frames <= 4, `a gesture is tracked within a few frames (took ${frames}) — memory must not become smear`);
}
ok(MASK_SMOOTHING === 1,
  "default mask weight is SNAP — any retained previous pose is the ghost beside a head turn");
ok(MASK_SMOOTHING_STILL >= 0.75 && MASK_SMOOTHING_STILL < 1,
  "nearly-still frames alone get a mild mix so a quiet edge does not crawl");
ok(MASK_SMOOTHING_FAST === 1,
  "motion path is a hard snap — not a slightly-faster EMA");
{
  const still = flat(200), next = flat(210);
  ok(maskMeanAbsDelta(still, next) < MASK_DELTA_FAST,
    "a quiet edge has a small mean-abs delta");
  const turn = flat(20), jump = flat(220);
  ok(maskMeanAbsDelta(turn, jump) >= MASK_DELTA_FAST,
    "a head-turn sized jump clears the snap threshold");
  ok(adaptiveSmoothAlpha(still, next) === MASK_SMOOTHING_STILL,
    "quiet frames use the mild still-mix, not full snap memory");
  ok(adaptiveSmoothAlpha(turn, jump) === 1,
    "a large delta snaps — no fraction of the previous pose survives");
  ok(adaptiveSmoothAlpha(null, jump) === 1,
    "with no previous mask, adopt whole — same as blendMask's first-frame rule");
}
{
  const prev = flat(50, 16), next = flat(200, 8);
  ok(blendMask(prev, next) === next,
    "a resolution change adopts the new mask whole instead of blending two different pictures");
}
ok(blendMask(null, null) !== undefined, "a missing mask never throws");

// FIELD 2026-08-24, judged from a screenshot: the hat brim and the shoulder
// dissolved over tens of pixels. Eight pixels of feather plus six of erosion
// was never a decision about how an edge should LOOK — it was camouflage for
// a binary mask at 384x216. The mask carries its own gradient now, so the
// feather is allowed to be a feather again.
ok(featherPx(720) === 1,
  "at 720p the edge is a 1px AA band only — soft dissolve was the waxy-face bug");
ok(featherPx(360) === 1 && featherPx(1080) === 1,
  "feather is AA-only at every meeting resolution — Zoom/Meet keep the subject pin-sharp");
ok(maskBlurPx(720) <= 5,
  "…and the WHOLE mask softening — feather plus light erosion — stays thin at 720p. NEGATIVE CONTROL for the thick halo / sticker look in the 2026-09-04 screenshots");
ok(featherPx(0) === 1 && featherPx(-5) === 1 && featherPx(99999) === 1,
  "a nonsense height still yields a 1px AA feather");

// ── 3. ACTUALLY BLURRY: the privacy promise the button makes ─────────────
ok(BLUR_PX >= 20,
  "the blur is strong enough that a bookshelf is shapes, not titles — at 12 the room stayed readable and the feature lied");
// RETIRED 2026-08-20. This guard asserted the under-blur was AT LEAST 18px —
// and that under-blur is exactly what buried every backdrop, because it
// filled the transparent pixels the backdrop was going to be painted into.
// The privacy intent it was protecting is now met by the backdrop itself
// covering the whole background, which is asserted in the render check and
// below. A guard that pins a broken mechanism keeps the mechanism.
ok(IMAGE_UNDERBLUR_PX === 0,
  "there is no second layer under a virtual background — the backdrop IS the privacy measure, and the layer that used to be there discarded it");

// ── cost: the third way it strobes is dropped frames ─────────────────────
ok(shouldSegment(1000, 0) === true, "the first frame always segments");
ok(shouldSegment(1000, 990, 20) === false, "…and then not more often than the cadence allows");
ok(shouldSegment(1051, 1000, 20) === true, "…and again once the interval has passed");
ok(SEGMENT_HZ === 30,
  "segmentation targets 30Hz — CPU headroom after dropping full-res pixel readback");
ok(shouldSegment(1000, 990, 30) === false && shouldSegment(1034, 1000, 30) === true,
  "…and the cadence helper still gates on the interval at 30Hz");
ok(shouldSegment(NaN, 0) === false, "a nonsense clock does not trigger work");

ok(segmentSize(1280, 720).w === SEGMENT_WIDTH,
  "the model gets a downscaled copy — it resizes to 256 internally anyway, so feeding it 720p is work thrown away");
ok(Math.abs(segmentSize(1280, 720).h / segmentSize(1280, 720).w - 720 / 1280) < 0.01,
  "…at the source's aspect, so a face is never squashed into somebody else's mask");
ok(segmentSize(320, 240).w === 320, "a source smaller than the target is left alone — upscaling to segment is pure cost");
ok(segmentSize(0, 0).w > 0 && segmentSize(0, 0).h > 0, "a source with no size still yields a usable segmentation size");

ok(shouldDropFrame(true) === true,
  "a frame arriving mid-flight is DROPPED — a queue on live video is lip-sync drift that never comes back");
ok(shouldDropFrame(false) === false, "…and an idle pipeline takes the frame");

// ── the model must not depend on somebody else's CDN ─────────────────────
ok(assetPaths({ wasm: true, model: true }).tasksVisionFileSet === LOCAL_ASSETS.tasksVisionFileSet,
  "when we ship the model, the first blur of the day does not wait on a download");
ok(assetPaths({ wasm: false, model: false }) === undefined,
  "when we don't, the CDN answers — the vendored copy is an optimisation, never a dependency");
ok(assetPaths({ wasm: true, model: false }).modelAssetPath === undefined,
  "each asset is decided on its own; a missing model does not disown a present wasm");

// ── WHICH HALF IS THE PERSON (the 2026-08-20 second report) ─────────────
// "Blur is applying on people instead of background." It was: the mask marks
// one class opaque and NOTHING IN THE API SAYS WHICH, so the composite was
// hardcoded — to the wrong one. It is measured now.
{
  // a 32×18 mask, opaque over the middle where a webcam subject sits
  const W = 32, H = 18;
  const personOpaque = new Uint8ClampedArray(W * H);
  const bgOpaque = new Uint8ClampedArray(W * H).fill(255);
  for (let y = 3; y < 15; y++) for (let x = 11; x < 21; x++) {
    personOpaque[y * W + x] = 255;
    bgOpaque[y * W + x] = 0;
  }
  const pc = boxMean(personOpaque, W, H, CENTER_BOX), pe = edgeMean(personOpaque, W, H);
  const bc = boxMean(bgOpaque, W, H, CENTER_BOX), be = edgeMean(bgOpaque, W, H);
  ok(pc > pe, "a person-opaque mask reads brighter in the middle than at the edges");
  ok(bc < be, "a background-opaque mask reads the other way round");
  ok(maskPolarity({ centerMean: pc, edgeMean: pe }) === "person",
    "…and the polarity is read off the mask itself, not assumed from a convention nobody wrote down");
  ok(maskPolarity({ centerMean: bc, edgeMean: be }) === "background",
    "…in both directions, so a model that flips its convention cannot silently invert the product");
}
ok(keepComposite("person") === "source-in",
  "mask opaque on the person → keep the picture where the mask IS");
ok(keepComposite("background") === "source-out",
  "mask opaque on the room → keep the picture where the mask IS NOT. Getting THIS backwards is what blurred a person and sharpened their living room.");
ok(keepComposite("person") !== keepComposite("background"),
  "the two answers are genuinely different — this is a decision, not a formality");

ok(maskPolarity({ centerMean: 128, edgeMean: 128 + POLARITY_MARGIN / 3, last: "person" }) === "person",
  "an ambiguous frame keeps the standing answer — a polarity that flickers frame to frame would strobe worse than the bug it fixes");
ok(maskPolarity({ centerMean: NaN, edgeMean: 10, last: "person" }) === "person",
  "an unreadable mask never overrules a good answer");
ok(maskPolarity({ centerMean: NaN, edgeMean: NaN }) === "background",
  "…and with no answer at all, the default is MediaPipe's convention as it stands today");
ok(POLARITY_MARGIN > 0 && POLARITY_MARGIN < 60,
  "the margin is big enough to ignore noise and small enough that a real subject clears it");

ok(Number.isNaN(boxMean(null, 32, 18, CENTER_BOX)) && Number.isNaN(boxMean([], 0, 0, CENTER_BOX)),
  "measuring an absent mask yields NaN — which the polarity treats as 'no opinion', never as 'zero'");
ok(CENTER_BOX.w < 0.5 && CENTER_BOX.h > 0.5,
  "the centre box is narrow and tall: heads sit high, and the SIDES of a tile are the most reliably-room part of it");

// ── THE HALO (2026-08-20, third report) ─────────────────────────────────
// "Blur is not effective around the edges of the people." The selfie mask is
// generous: it keeps a few pixels of real room around a person, and
// feathering that rim leaves it SHARP right where the eye is looking. So the
// silhouette is eroded before it is feathered.
ok(erodePx(720) >= 3 && erodePx(720) <= 4,
  "the silhouette is pulled in ~3-4px at 720p — enough to take the selfie room-rim, not enough to shave a shoulder");
ok(erodePx(360) < erodePx(1080), "…in proportion, like the feather");
ok(erodePx(0) > 0 && erodePx(-9) > 0 && erodePx(999999) <= 4,
  "a nonsense height still yields a sane, bounded erosion — and the cap is what stops it eating fingers and hair");
ok(maskBlurPx(720) === featherPx(720) + erodePx(720),
  "the mask is blurred ONCE by enough to carry both jobs: the erosion needs a ramp to bite on, the feather is what survives it");
ok(maskBlurPx(720) > featherPx(720), "…so it is softer than the feather alone");

ok(alphaAfterGamma(1, 3) === 1 && alphaAfterGamma(0, 3) === 0,
  "erosion leaves the fully-person and fully-room ends exactly where they were");
ok(alphaAfterGamma(0.5, 3) < 0.5,
  "…and pulls the soft middle toward the room, which is what moves the boundary inward");
ok(alphaAfterGamma(0.9, 3) > alphaAfterGamma(0.6, 3),
  "the curve stays monotonic — an edge that reordered itself would tear");
ok(alphaAfterGamma(0.5, 1) === 0.5, "power 1 is no erosion at all, so the knob genuinely does something");
ok(edgeAlphaAfterErode(ERODE_POWER) > 0.5,
  "the alpha that now reads as the edge is HIGHER than a half — i.e. the boundary sits further inside the person");
ok(edgeAlphaAfterErode(1) === 0.5, "…and with no erosion it is exactly the half-way line");
ok(ERODE_POWER >= 2 && ERODE_POWER <= 5,
  "the power is small: each step is one more canvas composite per frame, and too many eats the subject");
ok(alphaAfterGamma(NaN, 3) === 0 && Number.isFinite(alphaAfterGamma(0.5, NaN)),
  "nonsense in, a number out — never NaN alpha, which paints nothing and cannot be debugged");

ok(needsInvert("background") === true && needsInvert("person") === false,
  "the mask is normalised to mean THE PERSON once, when it is built — instead of branching the composite in the paint path, which is where getting it backwards blurred a person");

// ── the backdrop that never arrived ─────────────────────────────────────
ok(IMAGE_UNDERBLUR_PX === 0,
  "the 'privacy under-blur' is retired: it filled every transparent pixel, so the destination-over that painted the chosen backdrop had nothing to paint, and every image effect rendered as plain blur");

// ── the three tweaks that came with the backdrops ───────────────────────
ok(DEFAULT_EFFECT_ID === "none",
  "somebody who has never chosen gets plain video — blur costs a model on every frame for every person, including the one on a four-year-old laptop who would experience it as 'this app is slow'");
{
  const on = { quality: "poor", effectOn: true, poorForMs: QUALITY_NAG_MS + 1 };
  ok(effectCostNote(on).length > 0, "a struggling picture WITH a background on says so, and says which");
  ok(/background/i.test(effectCostNote(on)), "…naming the background as the expensive thing, because nobody guesses that");
  ok(effectCostNote({ ...on, effectOn: false }) === "",
    "…and never on plain video: telling somebody their connection is poor is the connection banner's job, not this one");
  ok(effectCostNote({ ...on, poorForMs: 1000 }) === "",
    "…and never for a blip — one bad reading must not nag somebody mid-sentence");
  ok(effectCostNote({ ...on, quality: "excellent" }) === "", "a healthy connection says nothing at all");
  ok(QUALITY_NAG_MS >= 8000, "the patience is measured in seconds, not milliseconds");
}
ok(panelShouldClose({ reason: "escape" }) && panelShouldClose({ reason: "outside" }),
  "the settings panel closes on Escape and on a click away, like every other panel on the web");
ok(panelShouldClose({ reason: "pick" }) === false,
  "…but NOT when you pick a backdrop: choosing one is a comparison, and a panel that shuts on every pick makes comparing impossible");
ok(panelShouldClose({}) === false && panelShouldClose(null) === false,
  "an unknown reason leaves it open rather than closing under somebody's hands");

// ── the wiring actually uses all of this ─────────────────────────────────
const qbg = readFileSync(new URL("./qbg.ts", import.meta.url), "utf8");
ok(/controller\.enqueue\(new VideoFrame\(this\.canvas/.test(qbg),
  "the processor enqueues the canvas it JUST painted, every frame");
ok(!/if \(!this\.segmentationResults\)[\s\S]{0,40}return;?[\s\S]{0,80}enqueue/.test(qbg),
  "there is no path that returns early and still publishes — that path is the flash");
ok(/warmupPaint\(/.test(qbg) && /paintBlurAll/.test(qbg),
  "the warm-up policy is the one guarded above, not a second opinion inside the renderer");
ok(/blendMask\(/.test(qbg) && (/plateDilatePx\(/.test(qbg) || /shouldSegment\(/.test(qbg)),
  "smoothing and plate/cadence helpers come from the guarded module");
ok(/adaptiveSmoothAlpha\(/.test(qbg) && /hardenPersonMatte\(/.test(qbg),
  "adaptive EMA and near-binary person harden are wired into the segmenter callback");
ok(qbg.indexOf("hardenPersonMatte") > qbg.indexOf("blendMask") || /hardenPersonMatte\([\s\S]*blendMask|blendMask[\s\S]*hardenPersonMatte/.test(qbg),
  "hardenPersonMatte runs in the same mask path as blend (after temporal mix, at segment res)");
ok(/needsInvert\(this\.polarity/.test(qbg),
  "the polarity is resolved ONCE while building the person matte, so the paint path has no composite to get backwards");
ok(/this\.polarity = maskPolarity\(/.test(qbg),
  "…and the polarity is re-measured on every fresh mask, so a model that changes convention self-corrects");
ok(/personMatte\(/.test(qbg) && /source-in/.test(qbg),
  "person matte upscales the hard segment mask and uses source-in for a cheap erode — no pixel loops");
{
  const code = qbg.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok(!/filter = `blur\(\$\{IMAGE_UNDERBLUR_PX\}/.test(code),
    "the under-blur that buried every backdrop is gone from the paint path, not merely set to zero");
  ok(/drawCoverSoft\(ctx,/.test(code) && /source-over/.test(code) && /personCanvas/.test(code),
    "full backdrop first, then person source-over — not destination-over under a soft dark fringe");
  ok(!/globalCompositeOperation = "destination-over"/.test(code),
    "destination-over is gone from the paint path — it was the dark halo under soft mattes");
}
ok(/shouldDropFrame\(this\.busy\)/.test(qbg), "the frame-drop rule is enforced where frames arrive");
ok(/drawCover/.test(qbg),
  "a 16:9 backdrop behind a 4:3 camera is cropped, not squashed — a squashed horizon is another thing an eye reads as fake");

const guard = readFileSync(new URL("../app/room/[room]/MediaGuard.tsx", import.meta.url), "utf8");
ok(/shouldApplyEffect\(\{/.test(guard),
  "MediaGuard asks the guarded question instead of testing !track.processor");
{
  // The post-mortem comment names the old test, so look at CODE only: any
  // line that is not a comment and still branches on !track.processor.
  const code = guard.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok(!/!\s*cam\w*\.processor/.test(code),
    "…and the old !processor test — the loop itself — is gone from the code (the comment that names it stays: the next person needs to know why)");
}
ok(/applyEffectRef/.test(guard) && !/recoverCam, applyEffect\]/.test(guard),
  "applyEffect is reached through a ref, so its identity changing cannot rebuild the camera watcher mid-apply");
ok(/if \(fxBusyRef\.current\) return;/.test(guard),
  "the busy guard reads the REF — setFxBusy lands next render, so two applies in one tick both saw false and both ran");
ok(/quantlysBackground\(/.test(guard) && !/mod\.BackgroundBlur\(/.test(guard),
  "the stock strobing processor is no longer used");
ok(/Settings\n?\s*<\/button>/.test(guard) && !/Devices & effects/.test(guard),
  "the button says Settings, as asked");

// ── 2026-08-24: the mask has a gradient, the blur has edges, the shelf has
//    only backdrops that exist ─────────────────────────────────────────────
ok(confidenceToAlpha(0) === 0 && confidenceToAlpha(1) === 255,
  "a pixel the model is sure about is fully person or fully room — an S-curve that leaves 3% alpha on the background paints a grey veil over the whole frame");
ok(confidenceToAlpha(0.5) > 100 && confidenceToAlpha(0.5) < 155,
  "…and a pixel it is unsure about lands in the middle, which is the strand of hair the category mask could not draw at all");
ok(confidenceToAlpha(0.35) < confidenceToAlpha(0.5) && confidenceToAlpha(0.5) < confidenceToAlpha(0.65),
  "the curve is monotonic — an edge that is not monotonic is an edge with a ripple in it");
ok(confidenceToAlpha(0.42, 20) < confidenceToAlpha(0.42, 2),
  "more contrast pushes an uncertain pixel further toward the side it was leaning");
ok(confidenceToAlpha(NaN) === 0 && confidenceToAlpha(undefined) === 0,
  "a mask value that is not a number is transparent, not a NaN painted into the frame where it leaves no trace to debug");
ok(MASK_CONTRAST >= 10 && MASK_CONTRAST <= 12,
  "contrast is steep enough that mid confidence is not a grey veil on the face (city lights through the cap), soft enough that hair strands survive");

// Core harden: opaque person core, zero outside, soft mid band only.
ok(hardenAlpha(HARDEN_OPAQUE) === 255 && hardenAlpha(255) === 255 && hardenAlpha(230) === 255,
  "alpha at/above the opaque threshold is fully person — backdrop cannot show through the face");
ok(hardenAlpha(HARDEN_CLEAR) === 0 && hardenAlpha(0) === 0 && hardenAlpha(25) === 0,
  "alpha at/below the clear threshold is fully room");
ok(hardenAlpha(128) === 128 && hardenAlpha(100) === 100,
  "the thin band between stays soft for anti-alias / hair");
ok(hardenAlpha(NaN) === 0 && hardenAlpha(undefined) === 0,
  "nonsense harden input is transparent, never NaN painted into the mask");
{
  const m = new Uint8ClampedArray([0, 25, 40, 100, 220, 255]);
  hardenMaskAlpha(m);
  ok(m[0] === 0 && m[1] === 0 && m[2] === 0 && m[3] === 100 && m[4] === 255 && m[5] === 255,
    "hardenMaskAlpha hardens a whole buffer in place: clear→0, opaque→255, mid untouched");
}
ok(HARDEN_OPAQUE >= 160 && HARDEN_OPAQUE <= 200 && HARDEN_CLEAR >= 70 && HARDEN_CLEAR <= 110,
  "harden thresholds leave a hair of soft band — not a binary cut-out, not a face veil of room rim");

const os = overscanRect(1280, 720, 24);
ok(os.x < 0 && os.y < 0 && os.w > 1280 && os.h > 720,
  "THE DARK FRAME: the picture is drawn BIGGER than the canvas before it is blurred, so the kernel never samples the transparent black outside it");
ok(os.x + os.w > 1280 && os.y + os.h > 720, "…and it overhangs on all four sides, not just two");
ok(Math.abs((os.w / os.h) - (1280 / 720)) < 0.02, "…without stretching it — an overscan that changes the aspect ratio is a fix that squashes faces");
ok(overscanRect(1280, 720, 200).w > overscanRect(1280, 720, 24).w,
  "a bigger blur needs a bigger margin, because the band it ruins is as wide as its own radius");
ok(overscanRect(0, 0).w === 0 && OVERSCAN_K >= 4,
  "a canvas with no size yields no rectangle rather than a NaN one — and the margin is at least four radii, which is where the measured corner alpha reaches 254 of 255");
ok(overscanRect(640, 360, 24).x <= -96,
  "…meaning the frame really does overhang by four radii PER SIDE. NEGATIVE CONTROL for the first attempt at this fix, which grew the rectangle by one margin and split it across two edges — it left the corner at alpha 168 and would have shipped looking almost fixed");

const bp = bokehPass(1280, 720, 24);
ok(bp.w < 1280 && bp.h < 720, "the blur is done on a small canvas — sixteen times less work per frame on the most expensive thing in the room");
ok(Math.abs((bp.w / bp.h) - (1280 / 720)) < 0.02, "…at the same aspect ratio");
ok(bp.radius < 24 && bp.radius >= 1,
  "…with the radius scaled to it, because the upscale afterwards adds a second falloff of its own — that second falloff is what makes it read as depth of field rather than as smear");
ok(bokehPass(1280, 720, 24).w === 640,
  "half scale, not a quarter: measured, a quarter-scale pass leaves MORE of the room legible than no downscale at all, because the resampling aliases fine detail back in");
ok(bokehPass(320, 180, 24).w >= 160,
  "a small picture is not shrunk further into fog — below about 160 wide the blur eats whole features out of the background");
ok(bokehPass(0, 0).w > 0 && bokehPass(1280, 720, 0).radius >= 1, "nonsense in still yields a drawable pass");


// ── 2026-09-03: edge fidelity + backdrop DOF + strong blur wiring ─────────
ok(MASK_SMOOTHING === 1,
  "EMA default is snap — hair softness is confidence alpha + thin feather, not temporal lag");
ok(SEGMENT_WIDTH >= 512,
  "segment width is at least 512 — higher fidelity mask where CPU allows");
ok(BACKDROP_DOF_PX >= 2 && BACKDROP_DOF_PX <= 6,
  "backdrop DOF is a few pixels of lens falloff — enough to sit behind the person, not a second privacy blur");
ok(/drawCoverSoft/.test(qbg) && /BACKDROP_DOF_PX/.test(qbg),
  "stills and loops are painted through the soft-cover path, not a hard sticker composite");
ok(/loadVideo|videoPath|kind === "video"|kind: "video"/.test(qbg),
  "the compositor can paint a living loop with the same edge pipeline as a still");


// ── 2026-09-04: kill ghost / face bleed / halo ───────────────────────────
ok(SEGMENT_HZ === 30, "segment at 30Hz for CPU headroom; last hard matte paints when briefly stale");
ok(plateDilatePx(720) >= 14 && plateDilatePx(720) <= 20,
  "plate dilate is a solid band at 720p — enough to scrub soft matte edges so dark clothing never seeds hist");
ok(plateFillSize(1280, 720).w <= 48 && plateFillSize(1280, 720).w >= 12,
  "person-fill mush is tiny so upscale averages room color, not a second portrait");
ok(Number.isFinite(PLATE_DILATE_FRAC) && PLATE_DILATE_FRAC > 0,
  "plate dilate fraction is a positive constant");
{
  // RGBA 4x4 blue, mean luma of a 2x2 corner should be ~0.114*200
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 0; rgba[i+1] = 0; rgba[i+2] = 200; rgba[i+3] = 255; }
  const m = boxMeanLuma(rgba, 4, 4, { x: 0, y: 0, w: 2, h: 2 });
  ok(Number.isFinite(m) && m > 20 && m < 30, "boxMeanLuma is NaN-safe and tracks blue luma");
  ok(Number.isNaN(boxMeanLuma(null, 4, 4, { x: 0, y: 0, w: 2, h: 2 })), "boxMeanLuma returns NaN on bad input");
}
ok(/personFreeBlur/.test(qbg) && /dilateSilhouette/.test(qbg),
  "blur path scrubs the person from the plate before Gaussian (personFreeBlur + dilateSilhouette)");
ok(/shouldSegment\(now, this\.lastSegAt\)/.test(qbg),
  "segmentation is gated by shouldSegment(SEGMENT_HZ) — not a hard-coded 8ms coalesce");
ok(maskBlurPx(720) === featherPx(720) + erodePx(720) && maskBlurPx(720) <= 5,
  "mask blur is still feather+erode, and the sum is a thin band not a sticker glow");
ok(erodePx(720) >= 2 && erodePx(720) <= 4,
  "erosion pulls inside the selfie room-rim so dark edge pixels go to the backdrop");
ok(HARDEN_CLEAR >= 80 && HARDEN_OPAQUE <= 200 && HARDEN_OPAQUE - HARDEN_CLEAR <= 120,
  "harden leaves only a hair of soft mid-band — room rim clears, person core stays opaque");
ok(maskIsFresh(1000, 980, 66) === true && maskIsFresh(1000, 900, 66) === false,
  "a mask older than two frames at 30fps is stale — paint blur-all rather than a ghost pose");
ok(MASK_MAX_AGE_MS <= 50,
  "freshness window is tight enough that a lagged silhouette cannot ride beside a turn");
ok(/segmentFrame\(/.test(qbg) && !/this\.segment\(this\.inputVideo/.test(qbg),
  "segmentation reads the VideoFrame being painted — not the lagging inputVideo element");
ok(/px\[j\] = 255/.test(qbg) && /source-over/.test(qbg) && /personCanvas/.test(qbg),
  "mask RGB is white (no black-fringe blur) and person is source-over on a full background");
ok(/maskIsFresh\(/.test(qbg),
  "paint path gates on mask freshness so a stale silhouette never composites");



// ── 2026-09-04 v5: temporal hist plate (dark self-ghost of cap) ──────────
ok(HIST_DILATE === PLATE_DILATE_FRAC && HIST_DILATE >= 0.025 && HIST_DILATE <= 0.032,
  "hist/plate dilate is generous — dark clothing must never write into hist near the edge");
ok(plateDilatePx(720) >= 14 && plateDilatePx(720) <= 20,
  "at 720p hist dilate is a solid band so person fringes cannot seed a dark self-ghost");
ok(ERODE_POWER >= 4,
  "erode power 4+ pulls soft dark clothing / cap brim inside so it cannot halo over blur");
ok(/histCanvas/.test(qbg) && /histReady/.test(qbg),
  "qbg keeps a temporal histCanvas / histReady for the person-free plate");
ok(/personFreeBlur[\s\S]{0,800}histReady[\s\S]{0,800}histCanvas|histReady[\s\S]{0,1200}blurred\(this\.histCanvas/.test(qbg),
  "personFreeBlur uses hist (histReady bootstrap + blur histCanvas), not a live-frame lowres stamp");
ok(/resetHist\(/.test(qbg),
  "hist resets on destroy / resolution change so yesterday room cannot smear into today");
ok(/destination-out/.test(qbg) && /updCanvas/.test(qbg),
  "hist update matte punches dilated person out (room-only write)");
ok(/fillStyle = "#fff"/.test(qbg) && !/dilateSilhouette[\s\S]{0,400}fillStyle = "#000"/.test(qbg),
  "dilate/silhouette invert fills white - black RGB + blur was the dark fringe");



// ── 2026-09-04 v6: hard opaque person, no blur-all face, sharp core ───────
ok(HARDEN_PERSON_OPAQUE >= 140 && HARDEN_PERSON_OPAQUE <= 180, "person opaque threshold is near-binary");
ok(HARDEN_PERSON_CLEAR >= 80 && HARDEN_PERSON_CLEAR <= 120, "person clear threshold leaves at most a hair of AA");
ok(HARDEN_PERSON_OPAQUE - HARDEN_PERSON_CLEAR <= 80,
  "person soft band is narrow — not a dissolve of face into blur");
ok(hardenAlpha(HARDEN_PERSON_OPAQUE, HARDEN_PERSON_OPAQUE, HARDEN_PERSON_CLEAR) === 255, "person harden opaque → 255");
ok(hardenAlpha(HARDEN_PERSON_CLEAR, HARDEN_PERSON_OPAQUE, HARDEN_PERSON_CLEAR) === 0, "person harden clear → 0");
{
  const m = new Uint8ClampedArray([0, 50, 120, 160, 200, 255]);
  hardenPersonMatte(m);
  ok(m[0] === 0 && m[1] === 0 && m[2] === 120 && m[3] === 255 && m[4] === 255 && m[5] === 255,
    "hardenPersonMatte: clear→0, opaque→255, thin mid untouched");
}
{
  // Synthetic composite: where hard mask is 255, out must equal source.
  const W = 8, H = 8, n = W * H;
  const src = new Uint8ClampedArray(n * 4);
  const bg = new Uint8ClampedArray(n * 4);
  const out = new Uint8ClampedArray(n * 4);
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    src[j] = 10; src[j+1] = 20; src[j+2] = 30; src[j+3] = 255;
    bg[j] = 200; bg[j+1] = 200; bg[j+2] = 50; bg[j+3] = 255;
    // Center 4x4 is person
    const x = i % W, y = (i / W) | 0;
    alpha[i] = (x >= 2 && x < 6 && y >= 2 && y < 6) ? 255 : 0;
  }
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (alpha[i] === 255) {
      out[j] = src[j]; out[j+1] = src[j+1]; out[j+2] = src[j+2]; out[j+3] = 255;
    } else {
      out[j] = bg[j]; out[j+1] = bg[j+1]; out[j+2] = bg[j+2]; out[j+3] = 255;
    }
  }
  ok(personCoreMatchesSource(src, out, alpha, 2) === true,
    "person core pixels stay byte-identical to the source camera where hard mask is 255");
  // Corrupt one face pixel — must fail
  out[(2 * W + 2) * 4] = 99;
  ok(personCoreMatchesSource(src, out, alpha, 2) === false,
    "NEGATIVE CONTROL: a softened face pixel fails the sharpness guard");
}
ok(featherPx(720) === 1 && erodePx(720) >= 3 && erodePx(720) <= 4,
  "v6 knobs: 1px AA feather + 3-4px erode at 720p");
ok(ERODE_POWER >= 4 && ERODE_POWER <= 5, "erode power stays in the safe self-composite range");
ok(/personMatte\(/.test(qbg) && /imageSmoothingEnabled = true/.test(qbg),
  "qbg builds a Meet-style person matte via upscaled hard mask (no full-res pixel readback)");
ok(/hardenPersonMatte\(/.test(qbg),
  "person-layer harden runs at segment resolution so maskCanvas is already near-binary");
ok(/codedWidth/.test(qbg) && /codedHeight/.test(qbg),
  "output canvas prefers codedWidth/codedHeight — display size can differ and soften everything");
ok(/haveMask: this\.haveMask/.test(qbg) && /histReady: this\.histReady/.test(qbg),
  "paint decision passes haveMask/histReady so stale matte never falls through to blur-all face");
ok(/Never Gaussian the subject|sharp passthrough/.test(qbg),
  "paintMasked failure path is sharp passthrough, not paintBlurAll");
{
  const code = qbg.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // Person layer draw must not set a blur filter on the frame itself.
  ok(/p\.filter = "none"[\s\S]{0,120}p\.drawImage\(frame/.test(code) ||
     /filter = "none"[\s\S]{0,80}drawImage\(frame as any, 0, 0, W, H\)/.test(code),
    "person layer draws the full-res VideoFrame with filter none");
}



// ── 2026-09-04 v7: drop full-res pixel readback (#22 soft-face regression) ─
{
  const code = qbg.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // Allow smallCtx/leafCtx.getImageData in segment callback (leaf suppress; leafCtx when sizes differ).
  // Full-res / paint-path getImageData is still forbidden (#22 soft-face).
  const gid = [...code.matchAll(/(\w+)\.getImageData\s*\(/g)].map((m) => m[1]);
  ok(gid.every((obj) => obj === "smallCtx" || obj === "leafCtx"),
    "qbg getImageData only on smallCtx/leafCtx (segment-res leaf suppress) — no full-HD paint readback");
  ok(!/hardSilhouette/.test(code),
    "hardSilhouette (the #22 getImageData harden) is gone");
}
ok(/shouldSegment\(/.test(qbg) && SEGMENT_HZ === 30,
  "30Hz segment + shouldSegment restores CPU headroom without blurring the face");
ok(/personMatte\([\s\S]{0,200}featherPx|featherPx\([\s\S]{0,200}personMatte/.test(qbg) ||
   /const aa = featherPx\(H\)/.test(qbg),
  "person matte uses at most featherPx canvas-filter AA — no pixel-loop re-harden");



// ── 2026-09-04 webgl v1: Meet-style compositor ────────────────────────────
ok(webglCompositeReady({ webgl2: true }) === true, "webglCompositeReady probe true");
ok(webglCompositeReady({ webgl2: false }) === false, "webglCompositeReady probe false");
{
  const glSrc = readFileSync(new URL("./qbg-gl.ts", import.meta.url), "utf8");
  const code = glSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok(!/\.getImageData\s*\(/.test(code), "qbg-gl has no getImageData in hot path");
  ok(/smoothstep\s*\(\s*0\.15\s*,\s*0\.45\s*,\s*m\)/.test(glSrc) || /\(1\.0 - m\)/.test(glSrc),
    "qbg-gl blur weights by hard room smoothstep exclusion");
  ok(/mix\s*\(\s*bg/.test(glSrc), "qbg-gl composite uses mix(bg, sharp, person)");
  ok(/FRAG_BLUR_H|FRAG_COMPOSITE|VERT_SRC/.test(glSrc), "qbg-gl exports shader source strings");
}
ok(/from "\.\/qbg-gl"/.test(qbg) && /new QbgGl/.test(qbg),
  "qbg imports and constructs QbgGl when WebGL2 is available");
ok(/webglCompositeReady\(/.test(qbg), "qbg gates GL init on webglCompositeReady");
ok(/drawImage\(this\.gl\.surface/.test(qbg),
  "qbg blits GL OffscreenCanvas into the 2d processor canvas");
ok(/setTransform\(1,\s*0,\s*0,\s*-1,\s*0,\s*H[i]?\)/.test(qbg) || (/translate\(0,\s*H\)/.test(qbg) && /scale\(1,\s*-1\)/.test(qbg)),
  "qbg GL blit uses setTransform Y-flip (or translate+scale) for upright (not vertex flip)");
ok(/drawBlur\(/.test(qbg) && /drawImageBg\(/.test(qbg),
  "paintMasked prefers GL drawBlur / drawImageBg over canvas2d hist when ready");


// ── 2026-09-04 matte v2: drop couch islands + harder blur exclusion ───────
ok(typeof keepCenterPersonIsland === "function", "keepCenterPersonIsland exported");
{
  // 16x10 mask: center person blob + left-side couch island
  const W = 16, H = 10;
  const m = new Uint8ClampedArray(W * H);
  // center person ~ cols 6..10, rows 2..8
  for (let y = 2; y <= 8; y++) for (let x = 6; x <= 10; x++) m[y * W + x] = 255;
  // side couch island cols 0..2, rows 6..9 (outside CENTER_BOX x=0.32..)
  for (let y = 6; y <= 9; y++) for (let x = 0; x <= 2; x++) m[y * W + x] = 255;
  keepCenterPersonIsland(m, W, H);
  let centerKept = 0, couchLeft = 0;
  for (let y = 2; y <= 8; y++) for (let x = 6; x <= 10; x++) if (m[y * W + x] === 255) centerKept++;
  for (let y = 6; y <= 9; y++) for (let x = 0; x <= 2; x++) if (m[y * W + x] === 255) couchLeft++;
  ok(centerKept === 5 * 7, "keepCenterPersonIsland: keeps center person blob");
  ok(couchLeft === 0, "keepCenterPersonIsland: clears side couch island");
}
{
  // No center intersection → keep globally largest
  const W = 10, H = 10;
  const m = new Uint8ClampedArray(W * H);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) m[y * W + x] = 200; // small
  for (let y = 0; y < 4; y++) for (let x = 7; x < 10; x++) m[y * W + x] = 200; // larger, both off-center-ish top
  keepCenterPersonIsland(m, W, H);
  let small = 0, large = 0;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) if (m[y * W + x] >= 100) small++;
  for (let y = 0; y < 4; y++) for (let x = 7; x < 10; x++) if (m[y * W + x] >= 100) large++;
  ok(small === 0 && large === 12, "keepCenterPersonIsland: if none hit center, keep largest");
}
ok(/keepCenterPersonIsland\(this\.smooth/.test(qbg),
  "qbg calls keepCenterPersonIsland after hardenPersonMatte");
ok(/drawImageBg\(frame as any, src, 0\)/.test(qbg),
  "virtual softEdge is 0 on image path (no wrap glow)");


// ── 2026-09-04 Meet stack hotfix: open mask (no torso ellipse) ────────────
ok(typeof openPersonMask === "function", "openPersonMask exported");
ok(OPEN_RADIUS_PX === 4, "OPEN_RADIUS_PX default is 4");
ok(OPEN_CROWN_BAND === 0.30, "OPEN_CROWN_BAND is 0.30 (open skips crown band)");
{
  // Rounded cap crown must survive open (no flat Y shave from square SE).
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Solid head mass
  for (let y = 8; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  // Rounded crown peak (pyramid) in upper band — square 2D open would flatten this
  m[3 * W + 20] = 255;
  m[4 * W + 19] = 255; m[4 * W + 20] = 255; m[4 * W + 21] = 255;
  m[5 * W + 18] = 255; m[5 * W + 19] = 255; m[5 * W + 20] = 255; m[5 * W + 21] = 255; m[5 * W + 22] = 255;
  m[6 * W + 17] = 255; m[6 * W + 18] = 255; m[6 * W + 19] = 255; m[6 * W + 20] = 255;
  m[6 * W + 21] = 255; m[6 * W + 22] = 255; m[6 * W + 23] = 255;
  m[7 * W + 16] = 255; m[7 * W + 17] = 255; m[7 * W + 18] = 255; m[7 * W + 19] = 255;
  m[7 * W + 20] = 255; m[7 * W + 21] = 255; m[7 * W + 22] = 255; m[7 * W + 23] = 255; m[7 * W + 24] = 255;
  openPersonMask(m, W, H, OPEN_RADIUS_PX);
  ok(m[3 * W + 20] > 0 || m[4 * W + 20] > 0, "openPersonMask: rounded crown peak not flat-shaved");
  let crownMass = 0;
  for (let y = 3; y <= 7; y++) for (let x = 17; x <= 23; x++) if (m[y * W + x] > 0) crownMass++;
  ok(crownMass >= 8, "openPersonMask: crown band keeps rounded mass");
}
ok(typeof torsoGateMask === "function", "torsoGateMask kept (deprecated, tests)");
ok(typeof suppressLowerRoom === "function", "suppressLowerRoom kept (deprecated, tests)");
ok(/selfie_segmenter_landscape/.test(SELFIE_LANDSCAPE_CDN),
  "SELFIE_LANDSCAPE_CDN points at landscape float16 model");
ok(LOCAL_ASSETS.modelAssetPath.includes("selfie_segmenter_landscape"),
  "LOCAL_ASSETS prefers landscape tflite path");
{
  // Floating-head regression: wide shoulders inside frame must survive open+island.
  // Person blob is wider than TORSO_GATE.width=0.55 would have kept (cols ~8..32 of 40).
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  for (let y = 4; y <= 26; y++) for (let x = 8; x <= 32; x++) m[y * W + x] = 255;
  openPersonMask(m, W, H);
  keepCenterPersonIsland(m, W, H);
  let shoulders = 0;
  // Shoulder band near mid-height at left/right of person (would be clipped by ellipse)
  for (let y = 10; y <= 16; y++) {
    for (let x = 8; x <= 10; x++) if (m[y * W + x] > 100) shoulders++;
    for (let x = 30; x <= 32; x++) if (m[y * W + x] > 100) shoulders++;
  }
  let core = 0;
  for (let y = 8; y <= 20; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 100) core++;
  ok(core > 50, "open+island: keeps center person core");
  ok(shoulders >= 20, "open+island: wide shoulders survive (no floating head)");
}
{
  // Thin bridge to side couch must break so island drops the couch.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Center person
  for (let y = 6; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  // Side couch island (left)
  for (let y = 18; y <= 28; y++) for (let x = 0; x <= 6; x++) m[y * W + x] = 255;
  // Thin 1px bridge connecting person to couch (open radius 2 must sever)
  for (let x = 7; x <= 13; x++) m[22 * W + x] = 255;
  openPersonMask(m, W, H, OPEN_RADIUS_PX);
  keepCenterPersonIsland(m, W, H);
  let couch = 0;
  for (let y = 18; y <= 28; y++) for (let x = 0; x <= 6; x++) if (m[y * W + x] > 20) couch++;
  let person = 0;
  for (let y = 8; y <= 24; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 100) person++;
  ok(person > 50, "open+island: person survives after bridge break");
  ok(couch === 0, "open+island: thin chair→couch bridge broken; couch dropped");
}
ok(/openPersonMask\(this\.smooth/.test(qbg), "qbg wires openPersonMask after harden");
ok(!/torsoGateMask\(this\.smooth/.test(qbg), "qbg does NOT wire torsoGateMask (floating-head)");
ok(!/suppressLowerRoom\(this\.smooth/.test(qbg), "qbg does NOT wire suppressLowerRoom");
ok(/hardenPersonMatte\(this\.smooth[\s\S]*?openPersonMask\(this\.smooth[\s\S]*?keepCenterPersonIsland\(this\.smooth[\s\S]*?lateralPersonGate\(this\.smooth[\s\S]*?despecklePersonMask\(this\.smooth[\s\S]*?suppressLeafLeaks\(this\.smooth/.test(qbg),
  "qbg order: harden → open → island → lateral → despeckle → leaf");
ok(!/FaceDetector/.test(qbg) && !/applyFaceHullMask\(this\.smooth/.test(qbg) && !/blaze_face/.test(qbg),
  "qbg does NOT wire FaceDetector / applyFaceHullMask / blaze_face");
ok((qbg.match(/keepCenterPersonIsland\(this\.smooth/g) || []).length === 1,
  "qbg calls keepCenterPersonIsland exactly once (no post-hull island)");
ok(!/torsoGateMask\(this\.smooth/.test(qbg), "qbg still does not wire torsoGateMask");
ok(!/suppressCrownProtrusions\(this\.smooth/.test(qbg), "qbg does NOT call suppressCrownProtrusions (cap crown)");
ok(!/suppressDarkEdgeLeaks\(this\.smooth/.test(qbg), "qbg does NOT call suppressDarkEdgeLeaks");
ok(/lateralPersonGate\(this\.smooth/.test(qbg), "qbg wires lateralPersonGate");
ok(/despecklePersonMask\(this\.smooth/.test(qbg), "qbg wires despecklePersonMask");
ok(/suppressLeafLeaks\(this\.smooth/.test(qbg), "qbg wires suppressLeafLeaks after gates");
ok(/selfie_segmenter_landscape/.test(qbg), "qbg uses landscape model path");
ok(/Hi \+ 2|H \+ 2/.test(qbg) && /0,\s*-1/.test(qbg),
  "qbg blit uses 1px overscan for cyan seam");



// ── 2026-09-04 matte leaks v3: lateral gate + despeckle ───────────────────
ok(typeof lateralPersonGate === "function", "lateralPersonGate exported");
ok(LATERAL_GATE.halfWidth === 0.34 && LATERAL_GATE.falloff === 0.06, "LATERAL_GATE defaults");
ok(typeof despecklePersonMask === "function", "despecklePersonMask exported");
ok(DESPECKLE_MIN_AREA_FRAC === 0.008, "DESPECKLE_MIN_AREA_FRAC is 0.8%");
{
  // Side plant column cleared; center torso full height (no floating head).
  // halfWidth=0.34 + falloff=0.06 → fully zero only when |nx-0.5| >= 0.40.
  const W = 50, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Full-height center torso well inside halfWidth 0.34
  for (let y = 2; y <= 36; y++) for (let x = 15; x <= 35; x++) m[y * W + x] = 255;
  // Extreme right plant cols (nx≈0.97 → |d|=0.47 → gate 0)
  for (let y = 4; y <= 30; y++) for (let x = 48; x <= 49; x++) m[y * W + x] = 255;
  // Extreme left furniture (nx≈0.01 → |d|=0.49 → gate 0)
  for (let y = 10; y <= 28; y++) for (let x = 0; x <= 1; x++) m[y * W + x] = 255;
  lateralPersonGate(m, W, H);
  let plant = 0, furniture = 0, torsoTop = 0, torsoBot = 0, shoulders = 0;
  for (let y = 4; y <= 30; y++) for (let x = 48; x <= 49; x++) if (m[y * W + x] > 0) plant++;
  for (let y = 10; y <= 28; y++) for (let x = 0; x <= 1; x++) if (m[y * W + x] > 0) furniture++;
  for (let x = 20; x <= 30; x++) { if (m[3 * W + x] > 100) torsoTop++; if (m[34 * W + x] > 100) torsoBot++; }
  for (let y = 12; y <= 18; y++) {
    for (let x = 15; x <= 17; x++) if (m[y * W + x] > 100) shoulders++;
    for (let x = 33; x <= 35; x++) if (m[y * W + x] > 100) shoulders++;
  }
  ok(plant === 0, "lateral gate: side plant column cleared");
  ok(furniture === 0, "lateral gate: left furniture strip cleared");
  ok(torsoTop >= 8 && torsoBot >= 8, "lateral gate: center torso kept full height (no floating head)");
  ok(shoulders >= 20, "lateral gate: wide shoulders survive");
}
{
  // Despeckle: tiny islands gone, large center kept.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  for (let y = 8; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  m[2 * W + 2] = 255; m[2 * W + 3] = 255; m[3 * W + 2] = 255; m[3 * W + 3] = 255;
  m[5 * W + 36] = 255; m[5 * W + 37] = 255; m[6 * W + 36] = 255; m[6 * W + 37] = 255;
  despecklePersonMask(m, W, H);
  let flecks = 0, body = 0;
  for (let y = 2; y <= 3; y++) for (let x = 2; x <= 3; x++) if (m[y * W + x] > 0) flecks++;
  for (let y = 5; y <= 6; y++) for (let x = 36; x <= 37; x++) if (m[y * W + x] > 0) flecks++;
  for (let y = 10; y <= 26; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 100) body++;
  ok(flecks === 0, "despeckle: tiny islands gone");
  ok(body > 100, "despeckle: large center body kept");
}
{
  // Open radius still breaks thin chair-couch bridge; shoulders survive.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  for (let y = 6; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  for (let y = 18; y <= 28; y++) for (let x = 0; x <= 6; x++) m[y * W + x] = 255;
  for (let x = 7; x <= 13; x++) m[22 * W + x] = 255;
  openPersonMask(m, W, H, OPEN_RADIUS_PX);
  keepCenterPersonIsland(m, W, H);
  lateralPersonGate(m, W, H);
  despecklePersonMask(m, W, H);
  let couch = 0, person = 0, shoulders = 0;
  for (let y = 18; y <= 28; y++) for (let x = 0; x <= 6; x++) if (m[y * W + x] > 20) couch++;
  for (let y = 8; y <= 24; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 100) person++;
  for (let y = 10; y <= 16; y++) {
    for (let x = 14; x <= 15; x++) if (m[y * W + x] > 100) shoulders++;
    for (let x = 25; x <= 26; x++) if (m[y * W + x] > 100) shoulders++;
  }
  ok(person > 50, "v3 pipeline: person survives bridge break");
  ok(couch === 0, "v3 open radius still breaks thin chair→couch bridge");
  ok(shoulders >= 10, "v3: shoulders survive open radius 4");
}

// ── edge spill: leaf suppress + despeckle bump ───────────────────────────────
ok(typeof suppressLeafLeaks === "function", "suppressLeafLeaks exported");
ok(typeof suppressCrownProtrusions === "function", "suppressCrownProtrusions exported");
ok(typeof findCrownY === "function", "findCrownY exported");
{
  const fxSrc = readFileSync(new URL("./effects.ts", import.meta.url), "utf8");
  ok(/Math\.max\(\s*48\s*,/.test(fxSrc), "despeckle floor is max(48, …)");
  ok(/g > r \+ 12 && g > b \+ 8/.test(fxSrc), "leaf thresholds lowered to +12/+8");
  ok(/H \* 0\.18/.test(fxSrc), "leaf crown band uses y < H*0.18");
  ok(/OPEN_CROWN_BAND/.test(fxSrc) && /y < crownY/.test(fxSrc),
    "openPersonMask skips crown band (no Y flatten of rounded cap)");
  ok(/sideHead/.test(fxSrc) && /shoulderSide/.test(fxSrc) && /useTrapezoid/.test(fxSrc),
    "applyFaceHullMask has trapezoid X (sideHead/shoulderSide)");
}
{
  const W = 20, H = 20;
  const m = new Uint8ClampedArray(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 8; y <= 14; y++) for (let x = 15; x <= 18; x++) {
    m[y * W + x] = 255;
    const j = (y * W + x) * 4;
    rgba[j] = 40; rgba[j + 1] = 180; rgba[j + 2] = 50; rgba[j + 3] = 255;
  }
  m[4 * W + 10] = 255;
  const hj = (4 * W + 10) * 4;
  rgba[hj] = 40; rgba[hj + 1] = 180; rgba[hj + 2] = 50; rgba[hj + 3] = 255;
  suppressLeafLeaks(m, rgba, W, H);
  let plant = 0;
  for (let y = 8; y <= 14; y++) for (let x = 15; x <= 18; x++) if (m[y * W + x] > 0) plant++;
  ok(plant === 0, "suppressLeafLeaks: mid-right leaf blob cleared");
  ok(m[4 * W + 10] === 255, "suppressLeafLeaks: green in head box kept");
}
{
  // FIELD: plant on cap crown — leaf-green at y=5% INSIDE head box must die.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 10; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  for (let x = 18; x <= 22; x++) {
    m[2 * W + x] = 255;
    const j = (2 * W + x) * 4;
    rgba[j] = 50; rgba[j + 1] = 160; rgba[j + 2] = 40; rgba[j + 3] = 255;
  }
  m[1 * W + 20] = 255;
  const yj = (1 * W + 20) * 4;
  rgba[yj] = 90; rgba[yj + 1] = 110; rgba[yj + 2] = 70; rgba[yj + 3] = 255;
  suppressLeafLeaks(m, rgba, W, H);
  let crownLeaf = 0;
  for (let x = 18; x <= 22; x++) if (m[2 * W + x] > 0) crownLeaf++;
  ok(crownLeaf === 0, "suppressLeafLeaks: leaf-green on cap crown (y=5%) zeroed");
  ok(m[1 * W + 20] === 0, "suppressLeafLeaks: yellowish-green crown fringe zeroed");
  ok(m[12 * W + 20] === 255, "suppressLeafLeaks: solid head mass intact");
}
{
  // Crown protrusions: thin spike + blur rectangle above head; shoulders intact.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  for (let y = 10; y <= 30; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  for (let y = 2; y <= 7; y++) m[y * W + 20] = 255;
  for (let y = 3; y <= 5; y++) for (let x = 17; x <= 23; x++) m[y * W + x] = 255;
  const cy = findCrownY(m, W, H);
  ok(cy >= 8 && cy <= 12, "findCrownY locates solid head top (~y=10)");
  suppressCrownProtrusions(m, W, H);
  let spike = 0, speck = 0, shoulders = 0, torso = 0;
  for (let y = 2; y <= 7; y++) if (m[y * W + 20] > 0) spike++;
  for (let y = 3; y <= 5; y++) for (let x = 17; x <= 23; x++) if (m[y * W + x] > 0) speck++;
  for (let y = 12; y <= 16; y++) {
    for (let x = 14; x <= 15; x++) if (m[y * W + x] > 100) shoulders++;
    for (let x = 25; x <= 26; x++) if (m[y * W + x] > 100) shoulders++;
  }
  for (let y = 20; y <= 28; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 100) torso++;
  ok(spike === 0, "suppressCrownProtrusions: thin spike above head removed");
  ok(speck === 0, "suppressCrownProtrusions: blur rectangle above cap removed");
  ok(shoulders >= 10, "suppressCrownProtrusions: shoulders intact");
  ok(torso > 50, "suppressCrownProtrusions: torso intact (no floating-head)");
}
{
  // No floating-head: pipeline with crown+leaf still keeps full center body.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 6; y <= 34; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  for (let y = 10; y <= 16; y++) for (let x = 34; x <= 37; x++) {
    m[y * W + x] = 255;
    const j = (y * W + x) * 4;
    rgba[j] = 40; rgba[j + 1] = 180; rgba[j + 2] = 50; rgba[j + 3] = 255;
  }
  openPersonMask(m, W, H, OPEN_RADIUS_PX);
  keepCenterPersonIsland(m, W, H);
  lateralPersonGate(m, W, H);
  despecklePersonMask(m, W, H);
  suppressCrownProtrusions(m, W, H);
  suppressLeafLeaks(m, rgba, W, H);
  let leafOut = 0, bodyTop = 0, bodyBot = 0;
  for (let y = 10; y <= 16; y++) for (let x = 34; x <= 37; x++) if (m[y * W + x] > 0) leafOut++;
  for (let x = 16; x <= 24; x++) { if (m[8 * W + x] > 100) bodyTop++; if (m[30 * W + x] > 100) bodyBot++; }
  ok(leafOut === 0, "pipeline: leaf outside head box still cleared");
  ok(bodyTop >= 5 && bodyBot >= 5, "pipeline: no floating-head after crown+leaf");
}


// ── face-box matte: FaceDetector hull helpers ───────────────────────────────
ok(typeof expandFaceHull === "function", "expandFaceHull exported");
ok(typeof applyFaceHullMask === "function", "applyFaceHullMask exported");
ok(/blaze_face_short_range/.test(BLAZE_FACE_CDN), "BLAZE_FACE_CDN points at short-range blaze face");
ok(FACE_HULL.top === 0.50 && FACE_HULL.bottom === 2.2 && FACE_HULL.side === 0.55,
  "FACE_HULL expand factors: top 0.50 / bottom 2.2 / side 0.55");
ok(FACE_HULL.sideHead === 0.14 && FACE_HULL.shoulderSide === 0.55,
  "FACE_HULL trapezoid X: sideHead 0.14 / shoulderSide 0.55");
ok(FACE_HULL.falloff === 0.04, "FACE_HULL soft falloff is 0.04 of frame");
ok(FACE_HULL_HOLD_MS >= 300 && FACE_HULL_HOLD_MS <= 500, "FACE_HULL_HOLD_MS in 300–500ms");
{
  // expandFaceHull expands up/down/sides as specified
  const box = { x: 0.40, y: 0.20, w: 0.20, h: 0.20 };
  const h = expandFaceHull(box);
  ok(!!h, "expandFaceHull returns hull for valid box");
  const topExt = box.y - h.y0;
  const botExt = h.y1 - (box.y + box.h);
  const leftExt = box.x - h.x0;
  const rightExt = h.x1 - (box.x + box.w);
  ok(Math.abs(topExt - FACE_HULL.top * box.h) < 1e-9, "expandFaceHull: top extends 0.50× face height");
  ok(Math.abs(botExt - FACE_HULL.bottom * box.h) < 1e-9, "expandFaceHull: bottom extends 2.2× face height");
  ok(Math.abs(leftExt - FACE_HULL.side * box.w) < 1e-9, "expandFaceHull: left extends 0.55× face width");
  ok(Math.abs(rightExt - FACE_HULL.side * box.w) < 1e-9, "expandFaceHull: right extends 0.55× face width");
  ok(h.x0 >= 0 && h.y0 >= 0 && h.x1 <= 1 && h.y1 <= 1, "expandFaceHull: clamped to 0..1");
  ok(Math.abs(h.fx0 - box.x) < 1e-9 && Math.abs(h.fy0 - box.y) < 1e-9, "expandFaceHull: stores face core origin");
  ok(Math.abs(h.fx1 - (box.x + box.w)) < 1e-9 && Math.abs(h.fy1 - (box.y + box.h)) < 1e-9,
    "expandFaceHull: stores face core extent");
}
{
  // applyFaceHullMask default axes="x": zeros side plant/chair, keeps center face
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Face/person core around center
  for (let y = 8; y <= 28; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  // Plant-like blob far right (outside expanded hull)
  for (let y = 10; y <= 18; y++) for (let x = 34; x <= 38; x++) m[y * W + x] = 255;
  // Chair bit far left (x=0..1 — outside shoulder trapezoid + falloff fringe)
  for (let y = 20; y <= 30; y++) for (let x = 0; x <= 1; x++) m[y * W + x] = 255;
  const hull = expandFaceHull({ x: 0.35, y: 0.20, w: 0.30, h: 0.25 });
  ok(!!hull, "test hull built");
  applyFaceHullMask(m, W, H, hull); // default X-only (trapezoid)
  let plant = 0, chair = 0, face = 0;
  for (let y = 10; y <= 18; y++) for (let x = 34; x <= 38; x++) if (m[y * W + x] > 0) plant++;
  for (let y = 20; y <= 30; y++) for (let x = 0; x <= 1; x++) if (m[y * W + x] > 0) chair++;
  for (let y = 12; y <= 20; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 200) face++;
  ok(plant === 0, "applyFaceHullMask: plant-like pixels outside X hull zeroed");
  ok(chair === 0, "applyFaceHullMask: chair bits outside X hull zeroed");
  ok(face > 40, "applyFaceHullMask: center face region kept");
}
{
  // X-only must NOT shave cap/crown above y0 (Y unconstrained)
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  const hull = expandFaceHull({ x: 0.35, y: 0.40, w: 0.30, h: 0.20 }); // y0 leaves room above face mid
  ok(!!hull, "crown test hull built");
  // Cap pixels above hull.y0 but inside face-core X (trapezoid head band is tight)
  const cx0 = Math.floor(hull.fx0 * W) + 1;
  const cx1 = Math.floor(hull.fx1 * W) - 1;
  const cyAbove = Math.max(1, Math.floor(hull.y0 * H) - 3);
  for (let x = cx0; x <= cx1; x++) m[cyAbove * W + x] = 255;
  applyFaceHullMask(m, W, H, hull, FACE_HULL.falloff, { axes: "x" });
  let capKept = 0;
  for (let x = cx0; x <= cx1; x++) if (m[cyAbove * W + x] > 200) capKept++;
  ok(capKept > 5, "applyFaceHullMask axes=x: cap/crown above y0 kept");
  // Full xy still cuts above y0
  for (let x = cx0; x <= cx1; x++) m[cyAbove * W + x] = 255;
  applyFaceHullMask(m, W, H, hull, FACE_HULL.falloff, { axes: "xy" });
  let capCut = 0;
  for (let x = cx0; x <= cx1; x++) if (m[cyAbove * W + x] > 0) capCut++;
  ok(capCut === 0, "applyFaceHullMask axes=xy: still cuts above y0");
}
{
  // no-face → no wipe (mask unchanged when hull null)
  const W = 16, H = 16;
  const m = new Uint8ClampedArray(W * H);
  for (let i = 0; i < m.length; i++) m[i] = (i % 3 === 0) ? 200 : 0;
  const before = Uint8ClampedArray.from(m);
  applyFaceHullMask(m, W, H, null);
  let same = true;
  for (let i = 0; i < m.length; i++) if (m[i] !== before[i]) { same = false; break; }
  ok(same, "applyFaceHullMask: hull null leaves mask unchanged (no wipe)");
  applyFaceHullMask(m, W, H, undefined);
  same = true;
  for (let i = 0; i < m.length; i++) if (m[i] !== before[i]) { same = false; break; }
  ok(same, "applyFaceHullMask: hull undefined leaves mask unchanged");
}


{
  // Trapezoid X: tight at head cuts ear-plant; wide at shoulders keeps arms.
  // Color-agnostic (dark furniture counts too) — no Y crown cut.
  const W = 50, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Face/torso core
  for (let y = 8; y <= 32; y++) for (let x = 18; x <= 32; x++) m[y * W + x] = 255;
  // Wide shoulders
  for (let y = 18; y <= 24; y++) for (let x = 12; x <= 38; x++) m[y * W + x] = 255;
  // Ear-adjacent plant (head height, just outside face+sideHead)
  for (let y = 9; y <= 14; y++) for (let x = 8; x <= 11; x++) m[y * W + x] = 255;
  for (let y = 9; y <= 14; y++) for (let x = 39; x <= 42; x++) m[y * W + x] = 255;
  // Cap crown above face (must survive — axes=x, no Y cut)
  for (let x = 22; x <= 28; x++) m[4 * W + x] = 255;
  const hull = expandFaceHull({ x: 0.36, y: 0.20, w: 0.28, h: 0.22 });
  ok(!!hull && hull.fx1 > hull.fx0, "trapezoid test hull has face core");
  applyFaceHullMask(m, W, H, hull, FACE_HULL.falloff, { axes: "x" });
  let earPlant = 0, shoulders = 0, crown = 0, face = 0;
  for (let y = 9; y <= 14; y++) {
    for (let x = 8; x <= 11; x++) if (m[y * W + x] > 0) earPlant++;
    for (let x = 39; x <= 42; x++) if (m[y * W + x] > 0) earPlant++;
  }
  for (let y = 18; y <= 24; y++) {
    for (let x = 12; x <= 14; x++) if (m[y * W + x] > 100) shoulders++;
    for (let x = 36; x <= 38; x++) if (m[y * W + x] > 100) shoulders++;
  }
  for (let x = 22; x <= 28; x++) if (m[4 * W + x] > 200) crown++;
  for (let y = 10; y <= 16; y++) for (let x = 20; x <= 30; x++) if (m[y * W + x] > 200) face++;
  ok(earPlant === 0, "trapezoid X: ear-adjacent plant/furniture zeroed");
  ok(shoulders >= 10, "trapezoid X: wide shoulders kept");
  ok(crown >= 5, "trapezoid X: cap crown above face kept (no Y shave)");
  ok(face > 40, "trapezoid X: face core kept");
}


// ── face-hull helpers remain unit-tested (not wired in qbg live path) ───────
{
  // After trapezoid X hull, tall plant column beside head (outside sideHead pad) is zeroed.
  const W = 50, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Center person / face core
  for (let y = 6; y <= 30; y++) for (let x = 20; x <= 30; x++) m[y * W + x] = 255;
  // Tall plant at HEAD height only (ny <= faceBot uses sideHead). Face 0.40..0.60,
  // sideHead pad=0.14*0.20=0.028 → hard X ~0.372..0.628. x=12..13 (nx≈0.25) outside.
  for (let y = 6; y <= 15; y++) {
    m[y * W + 12] = 255;
    m[y * W + 13] = 255;
  }
  // Cap crown above face (must survive axes=x)
  for (let x = 22; x <= 28; x++) m[2 * W + x] = 255;
  const hull = expandFaceHull({ x: 0.40, y: 0.18, w: 0.20, h: 0.22 });
  ok(!!hull, "tight plant-column hull built");
  applyFaceHullMask(m, W, H, hull, FACE_HULL.falloff, { axes: "x" });
  let plantCol = 0, face = 0, crown = 0;
  for (let y = 6; y <= 15; y++) {
    if (m[y * W + 12] > 0) plantCol++;
    if (m[y * W + 13] > 0) plantCol++;
  }
  for (let y = 10; y <= 18; y++) for (let x = 22; x <= 28; x++) if (m[y * W + x] > 200) face++;
  for (let x = 22; x <= 28; x++) if (m[2 * W + x] > 200) crown++;
  ok(plantCol === 0, "tight sideHead: tall plant column beside head zeroed");
  ok(face > 30, "tight sideHead: face core kept");
  ok(crown >= 5, "tight sideHead: no Y crown cut (cap pixels kept)");
}
{
  // Mask with main person + orphan blob: keepCenterPersonIsland removes orphan.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  // Main center person
  for (let y = 6; y <= 30; y++) for (let x = 14; x <= 26; x++) m[y * W + x] = 255;
  // Orphan blob (was bridged; hull/lateral cut left it disconnected) — mid-right, off center box
  for (let y = 8; y <= 20; y++) for (let x = 32; x <= 36; x++) m[y * W + x] = 255;
  // Simulate post-hull orphan state: already disconnected
  keepCenterPersonIsland(m, W, H);
  let orphan = 0, center = 0;
  for (let y = 8; y <= 20; y++) for (let x = 32; x <= 36; x++) if (m[y * W + x] > 0) orphan++;
  for (let y = 10; y <= 24; y++) for (let x = 16; x <= 24; x++) if (m[y * W + x] > 200) center++;
  ok(orphan === 0, "keepCenterPersonIsland: orphan blob removed");
  ok(center > 50, "keepCenterPersonIsland: center person kept");
}
{
  // Leaf protect shrunk: ear-adjacent leaf (x≈0.38) is NOT protected; crown leaf still dies.
  const W = 40, H = 40;
  const m = new Uint8ClampedArray(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  // Ear-adjacent plant at x=15 (nx≈0.387) — was in old [0.35,0.65], now outside [0.42,0.58]
  for (let y = 10; y <= 14; y++) {
    m[y * W + 15] = 255;
    const j = (y * W + 15) * 4;
    rgba[j] = 40; rgba[j + 1] = 180; rgba[j + 2] = 50; rgba[j + 3] = 255;
  }
  // True center green clothing (protected)
  m[12 * W + 20] = 255;
  const cj = (12 * W + 20) * 4;
  rgba[cj] = 40; rgba[cj + 1] = 180; rgba[cj + 2] = 50; rgba[cj + 3] = 255;
  suppressLeafLeaks(m, rgba, W, H);
  let earLeaf = 0;
  for (let y = 10; y <= 14; y++) if (m[y * W + 15] > 0) earLeaf++;
  ok(earLeaf === 0, "suppressLeafLeaks: ear-adjacent plant (x≈0.38) not protected");
  ok(m[12 * W + 20] === 255, "suppressLeafLeaks: center-band green clothing still kept");
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
