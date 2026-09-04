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
  MASK_SMOOTHING, blendMask, warmupPaint, SEGMENT_WIDTH, segmentSize,
  shouldDropFrame, LOCAL_ASSETS, assetPaths, shouldApplyEffect,
  PROC_PREFIX, procName, effectIdOfProcessor,
  CENTER_BOX, POLARITY_MARGIN, maskPolarity, keepComposite, boxMean, edgeMean,
  erodePx, maskBlurPx, ERODE_POWER, alphaAfterGamma, edgeAlphaAfterErode, needsInvert,
  DEFAULT_EFFECT_ID, effectCostNote, QUALITY_NAG_MS, panelShouldClose,
} from "./effects.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. THE FLASH: never publish a frame you did not just paint ───────────
ok(warmupPaint({ wantsEffect: true, hasMask: false }) === "blur-all",
  "no mask yet → blur the WHOLE picture; there is no 'hold the last frame' state, because that is the strobe");
ok(warmupPaint({ wantsEffect: true, hasMask: true }) === "masked",
  "mask in hand → the normal masked paint");
ok(warmupPaint({ wantsEffect: false, hasMask: false }) === "raw",
  "no effect wanted → the camera's own frame, untouched");
ok(["raw", "blur-all", "masked"].length === 3 &&
   !["hold", "skip", "freeze"].includes(warmupPaint({ wantsEffect: true, hasMask: false })),
  "there is deliberately no freeze/hold verdict — a stale frame IS the flashing");
ok(warmupPaint({ wantsEffect: true, hasMask: false }) === "blur-all",
  "while the model loads the room is blurred, not revealed — the privacy promise starts at frame one, not second four");

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
ok(MASK_SMOOTHING > 0.4 && MASK_SMOOTHING < 0.85,
  "the smoothing sits between crawl (too high) and smear (too low)");
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
ok(featherPx(720) >= 2 && featherPx(720) <= 4,
  "at 720p the edge is feathered ~3px: enough that a boundary is not a cut line, not so much that a person dissolves into their own background");
ok(maskBlurPx(720) <= 6,
  "…and the WHOLE mask softening — feather plus the erosion ramp — stays under 6px at 720p. NEGATIVE CONTROL for the camouflage: at the old 14px this row fails, which is the number the screenshot was of");
ok(featherPx(360) < featherPx(1080),
  "feather scales with the picture — a fixed pixel count is a different softness at every resolution");
ok(featherPx(0) > 0 && featherPx(-5) > 0 && featherPx(99999) <= 8,
  "a nonsense height still yields a sane, bounded feather");

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
ok(SEGMENT_HZ >= 12 && SEGMENT_HZ <= 24,
  "segmentation runs slower than video: 20Hz of mask under 30fps is invisible once smoothed, and gives back a third of the CPU");
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
ok(erodePx(720) >= 1 && erodePx(720) <= 3,
  "the silhouette is pulled in a pixel or two at 720p — enough to take the rim of real room the model leaves, not enough to shave a shoulder");
ok(erodePx(360) < erodePx(1080), "…in proportion, like the feather");
ok(erodePx(0) > 0 && erodePx(-9) > 0 && erodePx(999999) <= 6,
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
ok(/blendMask\(/.test(qbg) && /maskBlurPx\(/.test(qbg) && /shouldSegment\(/.test(qbg),
  "smoothing, feathering (now inside maskBlurPx, which carries feather + erosion) and cadence all come from the guarded module");
ok(/needsInvert\(this\.polarity/.test(qbg),
  "the polarity is resolved ONCE while building the silhouette, so the paint path has no composite to get backwards");
ok(/this\.polarity = maskPolarity\(/.test(qbg),
  "…and the polarity is re-measured on every fresh mask, so a model that changes convention self-corrects");
ok(/for \(let i = 1; i < ERODE_POWER; i\+\+\)/.test(qbg),
  "the erosion runs as self-composites on the silhouette canvas — the guarded curve, executed");
{
  const code = qbg.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok(!/filter = `blur\(\$\{IMAGE_UNDERBLUR_PX\}/.test(code),
    "the under-blur that buried every backdrop is gone from the paint path, not merely set to zero");
  ok(/drawCover\(ctx, this\.bg, W, H\)/.test(code) &&
     code.indexOf("drawCover(ctx, this.bg") > code.indexOf('globalCompositeOperation = "destination-over"'),
    "the backdrop is the FIRST thing painted behind the person — nothing opaque goes down before it");
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
ok(MASK_CONTRAST >= 4 && MASK_CONTRAST <= 10,
  "NEGATIVE CONTROL on the curve: flat enough and it is the old grey smear, steep enough and it is the old binary cut-out");

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
ok(MASK_SMOOTHING >= 0.65 && MASK_SMOOTHING <= 0.8,
  "EMA leans toward the new mask so a head turn does not smear; hair softness is confidence alpha, not temporal lag");
ok(SEGMENT_WIDTH >= 512,
  "segment width is at least 512 — higher fidelity mask where CPU allows");
ok(BACKDROP_DOF_PX >= 2 && BACKDROP_DOF_PX <= 6,
  "backdrop DOF is a few pixels of lens falloff — enough to sit behind the person, not a second privacy blur");
ok(/drawCoverSoft/.test(qbg) && /BACKDROP_DOF_PX/.test(qbg),
  "stills and loops are painted through the soft-cover path, not a hard sticker composite");
ok(/loadVideo|videoPath|kind === "video"|kind: "video"/.test(qbg),
  "the compositor can paint a living loop with the same edge pipeline as a still");


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
