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
  BLUR_PX, IMAGE_UNDERBLUR_PX, featherPx, SEGMENT_HZ, shouldSegment,
  MASK_SMOOTHING, blendMask, warmupPaint, SEGMENT_WIDTH, segmentSize,
  shouldDropFrame, LOCAL_ASSETS, assetPaths, shouldApplyEffect,
  PROC_PREFIX, procName, effectIdOfProcessor,
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

ok(featherPx(720) >= 7 && featherPx(720) <= 9,
  "at 720p the edge is feathered ~8px — the stock 3px is a hard line, which is exactly what reads as artificial");
ok(featherPx(360) < featherPx(1080),
  "feather scales with the picture — a fixed pixel count is a different softness at every resolution");
ok(featherPx(0) > 0 && featherPx(-5) > 0 && featherPx(99999) <= 14,
  "a nonsense height still yields a sane, bounded feather");

// ── 3. ACTUALLY BLURRY: the privacy promise the button makes ─────────────
ok(BLUR_PX >= 20,
  "the blur is strong enough that a bookshelf is shapes, not titles — at 12 the room stayed readable and the feature lied");
ok(IMAGE_UNDERBLUR_PX >= 12,
  "a virtual background blurs the REAL room underneath too, so a sliver the mask misses leaks a smear, never a readable window");

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

// ── the wiring actually uses all of this ─────────────────────────────────
const qbg = readFileSync(new URL("./qbg.ts", import.meta.url), "utf8");
ok(/controller\.enqueue\(new VideoFrame\(this\.canvas/.test(qbg),
  "the processor enqueues the canvas it JUST painted, every frame");
ok(!/if \(!this\.segmentationResults\)[\s\S]{0,40}return;?[\s\S]{0,80}enqueue/.test(qbg),
  "there is no path that returns early and still publishes — that path is the flash");
ok(/warmupPaint\(/.test(qbg) && /paintBlurAll/.test(qbg),
  "the warm-up policy is the one guarded above, not a second opinion inside the renderer");
ok(/blendMask\(/.test(qbg) && /featherPx\(/.test(qbg) && /shouldSegment\(/.test(qbg),
  "smoothing, feathering and cadence all come from the guarded module");
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
