"use client";

// The Quantlys background processor: the browser half of lib/effects.ts.
//
// It exists because the stock @livekit/track-processors transformer strobes
// (it enqueues a stale canvas whenever the mask is late) and because its
// edge is a hard, jittering, per-frame decision boundary that reads as a
// cut-out. See lib/effects.ts for the full post-mortem — every judgement
// call in this file is imported from there so it can be tested without a
// camera.
//
// What this one does differently, in order of how much it matters:
//   1. EVERY frame is painted. If the mask is late, the whole picture is
//      blurred and published live. Never a repeat of the last frame.
//   2. The mask is smoothed across frames (EMA) so the edge has memory —
//      this is what removes the crawling shimmer around hair and shoulders.
//   3. The mask is feathered proportionally to the output, not by a fixed
//      3px that is a hard line at 720p.
//   4. Segmentation runs every paint frame (coalesce under 8ms), with buffers reused
//      and zero per-frame allocation of ImageBitmaps.
//   5. Frames that arrive while one is in flight are dropped, not queued —
//      a queue on live video is latency that compounds.
//   6. Model and WASM are served from our own origin when present, so the
//      first blur does not wait on a CDN and a desktop build works offline.
//
// This file only runs in a browser with MediaStreamTrackGenerator; every
// caller checks effectSupport() first.

import { ProcessorWrapper, VideoTransformer } from "@livekit/track-processors";
import type { ImageSegmenter, FaceDetector } from "@mediapipe/tasks-vision";
import {
  BLUR_PX, BACKDROP_DOF_PX, blendMask,
  warmupPaint, segmentSize, shouldDropFrame, assetPaths, procName,
  CENTER_BOX, maskPolarity, boxMean, edgeMean, type Polarity,
  needsInvert, featherPx, shouldSegment,
  confidenceToAlpha, hardenPersonMatte, openPersonMask, keepCenterPersonIsland, applyFaceHullMask, expandFaceHull, lateralPersonGate, despecklePersonMask, suppressCrownProtrusions, suppressLeafLeaks,
  SELFIE_LANDSCAPE_CDN, BLAZE_FACE_CDN, FACE_HULL, FACE_HULL_HOLD_MS, adaptiveSmoothAlpha,
  type FaceHull,
  overscanRect, bokehPass, maskIsFresh,
  plateDilatePx, webglCompositeReady,
} from "./effects";
import { QbgGl } from "./qbg-gl";

export type QbgOptions = {
  kind: "blur" | "image" | "video";
  /** data: URL or same-origin path for still backgrounds */
  imagePath?: string;
  /** same-origin muted seamless loop for living backgrounds */
  videoPath?: string;
  blurRadius?: number;
};

class QuantlysBackground extends VideoTransformer<QbgOptions> {
  private opts: QbgOptions;
  private seg?: ImageSegmenter;
  /** FaceDetector constrains the person matte to an expanded face→shoulders hull. */
  private face?: FaceDetector;
  /** Last good expanded hull (normalized); held briefly across missed detections. */
  private lastFaceHull: FaceHull | null = null;
  private lastFaceAt = 0;
  private bg: ImageBitmap | null = null;
  /** living loop element; drawn each paint when kind === "video" */
  private bgVideo: HTMLVideoElement | null = null;
  private busy = false;

  /** the smoothed mask, alpha channel only, at segmentation resolution */
  private smooth: Uint8ClampedArray | null = null;
  private maskCanvas?: OffscreenCanvas;
  private maskCtx?: OffscreenCanvasRenderingContext2D | null;
  /** Hard person matte at output size (upscaled from segment mask) */
  private silCanvas?: OffscreenCanvas;
  private silCtx?: OffscreenCanvasRenderingContext2D | null;
  private maskImage?: ImageData;
  /** the downscaled copy handed to the segmenter */
  private smallCanvas?: OffscreenCanvas;
  private smallCtx?: OffscreenCanvasRenderingContext2D | null;
  /** reused Float32 -> alpha scratch, so a 110k-pixel mask is not a fresh
   *  allocation twenty times a second */
  private alphaBuf: Uint8ClampedArray | null = null;
  private blurCanvas?: OffscreenCanvas;
  private blurCtx?: OffscreenCanvasRenderingContext2D | null;
  private lastSegAt = 0;
  private haveMask = false;
  /** performance.now() when the smoothed mask last landed — freshness gate */
  private maskAt = 0;
  /** person cutout layer for source-over composite (kills destination-over halo) */
  private personCanvas?: OffscreenCanvas;
  private personCtx?: OffscreenCanvasRenderingContext2D | null;
  /** Person-free blur plate: scrub the subject before blur so a soft matte
   *  cannot reveal a smeared double as ghost/halo. */
  private plateCanvas?: OffscreenCanvas;
  private plateCtx?: OffscreenCanvasRenderingContext2D | null;
  private fillCanvas?: OffscreenCanvas;
  private fillCtx?: OffscreenCanvasRenderingContext2D | null;
  private dilCanvas?: OffscreenCanvas;
  private dilCtx?: OffscreenCanvasRenderingContext2D | null;
  private stampCanvas?: OffscreenCanvas;
  private stampCtx?: OffscreenCanvasRenderingContext2D | null;
  /** Temporal person-free background plate. Room pixels accumulate across
   *  frames; the person hole keeps the last known room from when they were
   *  elsewhere. Blurring THIS is what kills the dark self-ghost of a cap. */
  private histCanvas?: OffscreenCanvas;
  private histCtx?: OffscreenCanvasRenderingContext2D | null;
  private histReady = false;
  /** Room-only update matte (white on room, clear over dilated person). */
  private updCanvas?: OffscreenCanvas;
  private updCtx?: OffscreenCanvasRenderingContext2D | null;
  /** Which class the mask paints opaque. MEASURED, never assumed — see the
   *  post-mortem above maskPolarity() in lib/effects.ts. */
  private polarity: Polarity | null = null;
  /** Meet-style WebGL2 compositor. Null when WebGL2 unavailable — canvas2d
   *  hist path remains the fallback (never hard-crash). */
  private gl: QbgGl | null = null;
  /** True when GL init succeeded; paintMasked prefers GL then falls back. */
  private useGl = false;

  constructor(opts: QbgOptions) {
    super();
    this.opts = opts;
  }

  async init(o: any): Promise<void> {
    await super.init(o);
    const vision = await import("@mediapipe/tasks-vision");
    // Local assets when this deployment ships them; the CDN otherwise. The
    // vendored copy is an optimisation, never a dependency — a missing file
    // must degrade to "slower first blur", not to "no blur".
    // Meet uses a landscape-variant selfie model; square mis-segments wide webcam scenes.
    // Prefer local landscape tflite; if missing, fall back to CDN landscape (not square).
    const local = assetPaths({ wasm: await head("/mediapipe/wasm/vision_wasm_internal.js"), model: await head("/mediapipe/selfie_segmenter_landscape.tflite") });
    const fileSet = await vision.FilesetResolver.forVisionTasks(
      local?.tasksVisionFileSet ||
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm",
    );
    this.seg = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath: local?.modelAssetPath ||
          SELFIE_LANDSCAPE_CDN,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      // BOTH. Confidence is what we want — a Float32 per pixel, which is the
      // only thing that can draw a strand of hair — and the category mask is
      // the fallback for a build or a model that does not return one. A
      // fallback is behaviour, not a comment: paintMasked works either way,
      // it just looks like 2026-08-20 on the old path.
      outputCategoryMask: true,
      outputConfidenceMasks: true,
    });
    // FaceDetector (Chrome/WebGL path): intersect person matte with expanded
    // face→shoulders hull so plant-on-cap / chair bits outside the hull die.
    // Prefer local public/mediapipe/; CDN otherwise. Failure is non-fatal —
    // existing open/island/lateral/despeckle/crown/leaf still run.
    this.face = undefined;
    this.lastFaceHull = null;
    this.lastFaceAt = 0;
    try {
      const faceLocal = await head("/mediapipe/blaze_face_short_range.tflite");
      this.face = await vision.FaceDetector.createFromOptions(fileSet, {
        baseOptions: {
          modelAssetPath: faceLocal
            ? "/mediapipe/blaze_face_short_range.tflite"
            : BLAZE_FACE_CDN,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
      });
    } catch {
      this.face = undefined;
    }
    if (this.opts.kind === "video" && this.opts.videoPath) await this.loadVideo(this.opts.videoPath);
    else if (this.opts.imagePath) await this.loadBackground(this.opts.imagePath);

    // Prefer WebGL2 Meet-style compositor. Keep the LiveKit output canvas as
    // 2d (VideoFrame + one-context rule); GL renders to its own OffscreenCanvas
    // and we blit once per frame with drawImage — never getImageData.
    this.useGl = false;
    this.gl = null;
    if (webglCompositeReady()) {
      const g = new QbgGl();
      if (g.init(this.canvas as any)) {
        this.gl = g;
        this.useGl = true;
      }
    }
  }

  async destroy(): Promise<void> {
    await super.destroy();
    try { await this.seg?.close(); } catch { /* closing twice is not an error worth surfacing */ }
    this.seg = undefined;
    try { await this.face?.close(); } catch { /* teardown best-effort */ }
    this.face = undefined;
    this.lastFaceHull = null;
    this.lastFaceAt = 0;
    this.bg = null;
    this.teardownVideo();
    this.smooth = null;
    this.haveMask = false;
    this.maskAt = 0;
    this.resetHist();
    try { this.gl?.destroy(); } catch { /* GL teardown best-effort */ }
    this.gl = null;
    this.useGl = false;
  }

  /** Drop the temporal plate so a fresh session / resolution does not smear
   *  yesterday's room into today's blur. */
  private resetHist() {
    this.histReady = false;
    if (this.histCtx && this.histCanvas) {
      this.histCtx.save();
      this.histCtx.globalCompositeOperation = "copy";
      this.histCtx.fillStyle = "#000";
      this.histCtx.fillRect(0, 0, this.histCanvas.width, this.histCanvas.height);
      this.histCtx.restore();
    }
  }

  async update(opts: QbgOptions): Promise<void> {
    const wasImage = this.opts.imagePath;
    const wasVideo = this.opts.videoPath;
    this.opts = opts;
    if (opts.kind === "video" && opts.videoPath) {
      if (opts.videoPath !== wasVideo) await this.loadVideo(opts.videoPath);
      this.bg = null;
    } else {
      this.teardownVideo();
      if (opts.imagePath && opts.imagePath !== wasImage) await this.loadBackground(opts.imagePath);
      if (!opts.imagePath) this.bg = null;
    }
  }

  private async loadBackground(path: string) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("background image failed to load"));
      img.src = path;
    });
    this.bg = await createImageBitmap(img);
  }

  private teardownVideo() {
    const v = this.bgVideo;
    this.bgVideo = null;
    if (!v) return;
    try { v.pause(); } catch { /* already gone */ }
    try { v.removeAttribute("src"); v.load(); } catch { /* same */ }
  }

  private async loadVideo(path: string) {
    this.teardownVideo();
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    await new Promise<void>((res, rej) => {
      const ok = () => { v.removeEventListener("error", bad); res(); };
      const bad = () => { v.removeEventListener("loadeddata", ok); rej(new Error("background loop failed to load")); };
      v.addEventListener("loadeddata", ok, { once: true });
      v.addEventListener("error", bad, { once: true });
      v.src = path;
    });
    try { await v.play(); } catch { /* autoplay may be blocked until a gesture; paint uses current frame anyway */ }
    this.bgVideo = v;
  }

  // ── the per-frame work ──────────────────────────────────────────────────
  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    // A frame arriving mid-flight is dropped whole: the NEWEST frame is the
    // true one, and a queue here becomes permanent lip-sync drift.
    if (shouldDropFrame(this.busy)) { frame.close(); return; }
    this.busy = true;
    try {
      if (this.isDisabled || !this.canvas || !this.ctx) {
        if (this.isDisabled) this.resetHist();
        controller.enqueue(frame);
        return;
      }
      // Prefer coded size over display size — display can differ (CSS/layout)
      // and an undersized canvas softens the whole published picture.
      const fw = Number((frame as any).codedWidth || (frame as any).displayWidth || 0) || 0;
      const fh = Number((frame as any).codedHeight || (frame as any).displayHeight || 0) || 0;
      if (fw > 0 && fh > 0 && (this.canvas.width !== fw || this.canvas.height !== fh)) {
        this.canvas.width = fw;
        this.canvas.height = fh;
        this.resetHist();
        if (this.useGl && this.gl) this.gl.resize(fw, fh);
      }
      const W = this.canvas.width, H = this.canvas.height;

      // Segment THIS VideoFrame — not this.inputVideo. The hidden video
      // element lags the insertable-stream frame by one or more poses; that
      // desync is the translucent ghost beside a turning head.
      this.segmentFrame(frame, W, H);

      const now = performance.now();
      const fresh = this.haveMask && maskIsFresh(now, this.maskAt);
      // NEVER paintBlurAll over a face we can still matte. Stale last-mask
      // beats a Gaussian over the subject (the waxy-face bug). Cold start
      // only: blur-all; if hist exists but no mask yet: sharp passthrough.
      const paint = warmupPaint({
        wantsEffect: true,
        hasMask: fresh,
        haveMask: this.haveMask,
        histReady: this.histReady,
      });
      if (paint === "masked") this.paintMasked(frame, W, H);
      else if (paint === "raw") {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalCompositeOperation = "copy";
        ctx.filter = "none";
        ctx.drawImage(frame as any, 0, 0, W, H);
        ctx.restore();
      } else this.paintBlurAll(frame, W, H);

      // ALWAYS enqueue what we just painted this frame. The stock transformer
      // skipped this on a late mask and published the previous canvas — that
      // is the flashing, and it is one line of discipline to never do it.
      controller.enqueue(new VideoFrame(this.canvas as any, {
        timestamp: frame.timestamp ?? 0,
        alpha: "discard",
      }));
    } catch {
      // A failed frame must not become a frozen picture: send the camera's
      // own frame through untouched rather than nothing at all.
      try { controller.enqueue(new VideoFrame(frame as any, { timestamp: frame.timestamp ?? 0 })); } catch { /* the next frame gets another go */ }
    } finally {
      frame.close();
      this.busy = false;
    }
  }

  /** Run the model on a downscaled copy of the SAME frame about to be
   *  painted, then mix the result into the smoothed mask. Cap at SEGMENT_HZ
   *  (30) so CPU has headroom after dropping full-res pixel readback; paint
   *  keeps using the last hard matte when the mask is briefly stale.
   *  Synchronous by design - segmentForVideo's callback fires inline, and
   *  awaiting anything here is how the stock version ended up with a mask
   *  that belonged to a frame already gone. */
  private segmentFrame(src: CanvasImageSource, W: number, H: number) {
    const now = performance.now();
    if (!this.seg) return;
    if (!shouldSegment(now, this.lastSegAt)) return;
    // Prefer the source's intrinsic size; fall back to the output canvas.
    const vw = Number((src as any).videoWidth || (src as any).codedWidth || (src as any).width || W) || W;
    const vh = Number((src as any).videoHeight || (src as any).codedHeight || (src as any).height || H) || H;
    if (!vw || !vh) return;
    const s = segmentSize(vw, vh);

    if (!this.smallCanvas || this.smallCanvas.width !== s.w || this.smallCanvas.height !== s.h) {
      this.smallCanvas = new OffscreenCanvas(s.w, s.h);
      this.smallCtx = this.smallCanvas.getContext("2d", { willReadFrequently: true });
      this.smooth = null;            // resolution changed — start the memory over
      this.maskImage = undefined;
      this.resetHist();
    }
    if (!this.smallCtx) return;
    this.smallCtx.drawImage(src as any, 0, 0, s.w, s.h);

    this.lastSegAt = now;
    try {
      this.seg.segmentForVideo(this.smallCanvas as any, now, (res) => {
        // Confidence first. `getAsFloat32Array` gives 0..1 per pixel, which
        // goes through the S-curve in effects.ts and lands as alpha with a
        // real gradient in it. The category mask, which is all this used to
        // ask for, is 0 or 255 and nothing else — so hair was always either
        // wholly person or wholly room, and the only way to make that look
        // soft was a fourteen-pixel feather over the whole silhouette.
        const conf: any = (res as any)?.confidenceMasks?.[0];
        const cat: any = res?.categoryMask;
        const src = conf || cat;
        if (!src) return;
        const mw = src.width, mh = src.height;

        let raw: Uint8ClampedArray;
        if (conf) {
          const f = conf.getAsFloat32Array();
          if (!this.alphaBuf || this.alphaBuf.length !== f.length) this.alphaBuf = new Uint8ClampedArray(f.length);
          const a = this.alphaBuf;
          for (let i = 0; i < f.length; i++) a[i] = confidenceToAlpha(f[i]);
          raw = a;
        } else {
          raw = cat.getAsUint8Array() as any;
        }
        // Adaptive EMA: head turns get a one-frame fast blend so a ghost of
        // the previous pose cannot linger beside the new one.
        const mix = adaptiveSmoothAlpha(this.smooth, raw as any);
        this.smooth = blendMask(this.smooth, raw as any, mix) as Uint8ClampedArray;
        // Near-binary harden at SEGMENT RES (cheap). maskCanvas then already
        // carries a hard person alpha — no full-res pixel readback later.
        hardenPersonMatte(this.smooth);
        // Morphological open breaks thin chair→couch bridges without the
        // TORSO_GATE ellipse that clipped shoulders (floating-head hotfix).
        openPersonMask(this.smooth, mw, mh);
        keepCenterPersonIsland(this.smooth, mw, mh);
        // Face→shoulders hull BEFORE lateral so we constrain plant/chair
        // attached to the cap without fighting the side gate; lateral still
        // helps when the face box widens into furniture.
        {
          let hull: FaceHull | null = null;
          if (this.face && this.smallCanvas) {
            try {
              const det = this.face.detectForVideo(this.smallCanvas as any, now);
              const list = (det as any)?.detections || [];
              let best: any = null;
              let bestScore = -1;
              for (let di = 0; di < list.length; di++) {
                const d = list[di];
                const score = Number(d?.categories?.[0]?.score ?? 0);
                if (d?.boundingBox && score > bestScore) {
                  bestScore = score;
                  best = d.boundingBox;
                }
              }
              if (best) {
                const bw = Number(best.width) || 0;
                const bh = Number(best.height) || 0;
                // Normalize vs mask size (same mw×mh as smallCanvas for segment).
                hull = expandFaceHull({
                  x: (Number(best.originX) || 0) / mw,
                  y: (Number(best.originY) || 0) / mh,
                  w: bw / mw,
                  h: bh / mh,
                });
                if (hull) {
                  this.lastFaceHull = hull;
                  this.lastFaceAt = now;
                }
              }
            } catch { /* face detect failed this frame — hold/skip below */ }
          }
          if (!hull && this.lastFaceHull && (now - this.lastFaceAt) <= FACE_HULL_HOLD_MS) {
            hull = this.lastFaceHull;
          }
          // No face (and hold expired): skip constraint — do not blank person.
          if (hull) applyFaceHullMask(this.smooth, mw, mh, hull, FACE_HULL.falloff);
        }
        // Full-height side gate: kill plant/furniture columns without vertical torso cut.
        lateralPersonGate(this.smooth, mw, mh);
        // Drop tiny flecks that somehow survive open+island+lateral.
        despecklePersonMask(this.smooth, mw, mh);
        // Kill plant spike / blur rectangle above the compact head mass.
        suppressCrownProtrusions(this.smooth, mw, mh);
        // Leaf-green leaks (crown band never protected; only when smallCanvas 1:1).
        if (
          this.smallCtx && this.smallCanvas &&
          this.smallCanvas.width === mw && this.smallCanvas.height === mh
        ) {
          try {
            const id = this.smallCtx.getImageData(0, 0, mw, mh);
            suppressLeafLeaks(this.smooth, id.data, mw, mh);
          } catch { /* getImageData unavailable — crown+lateral+despeckle still apply */ }
        }

        if (!this.maskCanvas || this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
          this.maskCanvas = new OffscreenCanvas(mw, mh);
          this.maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: false });
          this.maskImage = new ImageData(mw, mh);
        }
        // Alpha carries the matte. RGB must be WHITE, not left at 0: a
        // subsequent canvas blur() of black+alpha smears a dark fringe into
        // the soft edge — that is the halo around the cap in the screenshots.
        const px = this.maskImage!.data;
        const sm = this.smooth!;
        for (let i = 0, j = 0; i < sm.length; i++, j += 4) {
          px[j] = 255; px[j + 1] = 255; px[j + 2] = 255; px[j + 3] = sm[i];
        }
        this.maskCtx!.putImageData(this.maskImage!, 0, 0);
        this.haveMask = true;
        this.maskAt = performance.now();

        // Which half of this mask is the person? Measured off the mask
        // itself every time one lands, with the standing answer kept when a
        // frame is too ambiguous to overrule it. This is the fix for "the
        // blur is applying on people instead of background": the convention
        // is not written down anywhere, so we do not assume it.
        this.polarity = maskPolarity({
          centerMean: boxMean(sm, mw, mh, CENTER_BOX),
          edgeMean: edgeMean(sm, mw, mh),
          last: this.polarity,
        });
        try { conf?.close?.(); } catch { /* some builds auto-close */ }
        try { cat?.close?.(); } catch { /* same */ }
      });
    } catch {
      // A segmenter that throws mid-call must not take the video with it —
      // haveMask stays as it was and the next frame paints blur-all.
    }
  }

  /** Meet-style person matte: hard alpha already on maskCanvas (segment res),
   *  upscaled to output with smoothing for slight AA only. NO full-res pixel
   *  readback — that CPU path was the #22 soft-face regression (dropped frames).
   *  Optional 1px canvas-filter blur + one source-in self-composite pulls
   *  soft mid alpha inward (cheap erode) without pixel loops. */
  private personMatte(W: number, H: number): OffscreenCanvas | null {
    if (!this.maskCanvas) return null;
    if (!this.silCanvas || this.silCanvas.width !== W || this.silCanvas.height !== H) {
      this.silCanvas = new OffscreenCanvas(W, H);
      this.silCtx = this.silCanvas.getContext("2d", { willReadFrequently: false });
    }
    const s = this.silCtx;
    if (!s) return null;

    s.save();
    s.globalCompositeOperation = "copy";
    s.filter = "none";
    // Upscale AA only — hard matte was decided at segment resolution.
    s.imageSmoothingEnabled = true;
    s.drawImage(this.maskCanvas as any, 0, 0, W, H);

    // Normalise polarity ONCE so white alpha always means THE PERSON.
    // `source-out` + a full fill is alpha inversion on a canvas.
    if (needsInvert(this.polarity || "background")) {
      s.globalCompositeOperation = "source-out";
      // WHITE, not black: black RGB + blur smears a dark fringe (halo).
      s.fillStyle = "#fff";
      s.fillRect(0, 0, W, H);
    }

    // At most featherPx AA blur — never a soft dissolve of the face.
    const aa = featherPx(H);
    if (aa > 0) {
      s.globalCompositeOperation = "copy";
      s.filter = `blur(${aa}px)`;
      s.drawImage(this.silCanvas as any, 0, 0, W, H);
      s.filter = "none";
      // Cheap erode: source-in self-composite pulls soft mid inward.
      s.globalCompositeOperation = "source-in";
      s.drawImage(this.silCanvas as any, 0, 0, W, H);
    }

    s.restore();
    return this.silCanvas;
  }

  /** The background blur, drawn once into its own small canvas.
   *
   *  TWO FIXES IN ONE PLACE, both visible in the 2026-08-24 screenshot:
   *
   *  1. THE DARK FRAME. `filter = blur(24px)` then drawImage at exactly the
   *     canvas bounds means the Gaussian reaches past the edge for a band as
   *     wide as its radius and samples transparent black. Every side of the
   *     picture came out darker — it read as a deliberate vignette and was in
   *     fact an off-by-a-kernel. The frame is drawn OVERSCANNED now, so the
   *     kernel always has real pixels under it.
   *
   *  2. IT DID NOT LOOK LIKE A LENS. One 24px Gaussian over 921,600 pixels
   *     every frame is the most expensive thing in the room and smears
   *     uniformly, where a real defocus pools light. Drawing small, blurring
   *     there, and letting the bilinear upscale add its own wider falloff is
   *     sixteen times cheaper AND closer to bokeh.
   *
   *  Returns the small canvas; the caller scales it up. */
  private blurred(src: CanvasImageSource, W: number, H: number, radius: number): OffscreenCanvas | null {
    const b = bokehPass(W, H, radius);
    if (!this.blurCanvas || this.blurCanvas.width !== b.w || this.blurCanvas.height !== b.h) {
      this.blurCanvas = new OffscreenCanvas(b.w, b.h);
      this.blurCtx = this.blurCanvas.getContext("2d", { willReadFrequently: false });
    }
    const c = this.blurCtx;
    if (!c) return null;
    const r = overscanRect(b.w, b.h, b.radius);
    c.save();
    c.globalCompositeOperation = "copy";
    c.filter = `blur(${b.radius}px)`;
    c.drawImage(src as any, r.x, r.y, r.w, r.h);
    c.filter = "none";
    c.restore();
    return this.blurCanvas;
  }

  /** Dilate the person matte so the plate scrub covers soft edge pixels
   *  that would otherwise leave person color for the blur to smear. */
  private dilateSilhouette(W: number, H: number): OffscreenCanvas | null {
    if (!this.maskCanvas) return null;
    if (!this.dilCanvas || this.dilCanvas.width !== W || this.dilCanvas.height !== H) {
      this.dilCanvas = new OffscreenCanvas(W, H);
      this.dilCtx = this.dilCanvas.getContext("2d", { willReadFrequently: false });
    }
    const d = this.dilCtx;
    if (!d) return null;
    const r = plateDilatePx(H);
    d.save();
    d.globalCompositeOperation = "copy";
    d.filter = "none";
    d.drawImage(this.maskCanvas as any, 0, 0, W, H);
    // Normalise polarity so white alpha always means THE PERSON.
    if (needsInvert(this.polarity || "background")) {
      d.globalCompositeOperation = "source-out";
      // WHITE: black RGB + blur = dark fringe on the hist update matte too.
      d.fillStyle = "#fff";
      d.fillRect(0, 0, W, H);
    }
    // Blur expands the footprint (dilate). RGB stays white so the soft rim
    // cannot pick up a dark fringe.
    d.globalCompositeOperation = "copy";
    d.filter = `blur(${r}px)`;
    d.drawImage(this.dilCanvas as any, 0, 0, W, H);
    d.filter = "none";
    d.restore();
    return this.dilCanvas;
  }

  /** Blur a TEMPORAL person-free plate. Downscaling the live frame and
   *  stamping mush over the person left a dark self-blob (cap / hair) that
   *  blur smeared into a ghost. Instead, keep a history canvas of room-only
   *  pixels: update hist where the dilated person is NOT, leave the hole
   *  alone so it still holds the last known room from when they stood
   *  elsewhere. plateFillSize / dilate helpers stay for tests; paint uses
   *  hist.
   */
  private personFreeBlur(
    frame: CanvasImageSource, W: number, H: number, radius: number,
  ): OffscreenCanvas | null {
    if (!this.histCanvas || this.histCanvas.width !== W || this.histCanvas.height !== H) {
      this.histCanvas = new OffscreenCanvas(W, H);
      this.histCtx = this.histCanvas.getContext("2d", { willReadFrequently: false });
      this.histReady = false;
    }
    const hist = this.histCtx;
    if (!hist) return this.blurred(frame, W, H, radius);

    // Bootstrap: first frame seeds hist with the whole picture. The hole
    // will be overwritten by room on later frames as the person moves.
    if (!this.histReady) {
      hist.save();
      hist.globalCompositeOperation = "copy";
      hist.filter = "none";
      hist.drawImage(frame as any, 0, 0, W, H);
      hist.restore();
      this.histReady = true;
    }

    const dil = this.dilateSilhouette(W, H);
    if (!dil) return this.blurred(this.histCanvas, W, H, radius);

    // Room-only update matte: white on room, clear over dilated person.
    if (!this.updCanvas || this.updCanvas.width !== W || this.updCanvas.height !== H) {
      this.updCanvas = new OffscreenCanvas(W, H);
      this.updCtx = this.updCanvas.getContext("2d", { willReadFrequently: false });
    }
    if (!this.stampCanvas || this.stampCanvas.width !== W || this.stampCanvas.height !== H) {
      this.stampCanvas = new OffscreenCanvas(W, H);
      this.stampCtx = this.stampCanvas.getContext("2d", { willReadFrequently: false });
    }
    const uc = this.updCtx, sc = this.stampCtx;
    if (!uc || !sc) return this.blurred(this.histCanvas, W, H, radius);

    uc.save();
    uc.globalCompositeOperation = "copy";
    uc.filter = "none";
    uc.fillStyle = "#fff";
    uc.fillRect(0, 0, W, H);
    // Punch an expanded hole over the person so soft fringes never write
    // into hist (that fringe WAS the dark self-ghost).
    uc.globalCompositeOperation = "destination-out";
    uc.drawImage(dil as any, 0, 0, W, H);
    uc.restore();

    // Current frame, only room pixels.
    sc.save();
    sc.globalCompositeOperation = "copy";
    sc.filter = "none";
    sc.drawImage(frame as any, 0, 0, W, H);
    sc.globalCompositeOperation = "destination-in";
    sc.drawImage(this.updCanvas as any, 0, 0, W, H);
    sc.restore();

    // Stamp room onto hist; person region stays last-known room.
    hist.save();
    hist.globalCompositeOperation = "source-over";
    hist.filter = "none";
    hist.drawImage(this.stampCanvas as any, 0, 0, W, H);
    hist.restore();

    return this.blurred(this.histCanvas, W, H, radius);
  }

  /** The good path: person sharp, background replaced, edge eroded and
   *  feathered. Background is painted FULLY FIRST, then the person cutout
   *  is source-over'd on top. destination-over under a soft black-fringed
   *  matte was the dark halo around hat and shoulders. */
  private paintMasked(frame: VideoFrame, W: number, H: number) {
    const ctx = this.ctx!;
    // WebGL2 path: weighted bg blur + sharp person mix. One blit to 2d canvas.
    if (this.useGl && this.gl && this.gl.isReady && this.smooth && this.maskCanvas) {
      try {
        this.gl.resize(W, H);
        this.gl.setMask(
          this.smooth,
          this.maskCanvas.width,
          this.maskCanvas.height,
          needsInvert(this.polarity || "background"),
        );
        let ok = false;
        if ((this.opts.kind === "image" || this.opts.kind === "video") && (this.bg || this.bgVideo)) {
          const src: any = this.bgVideo && this.bgVideo.readyState >= 2 ? this.bgVideo : this.bg;
          if (src) ok = this.gl.drawImageBg(frame as any, src, 0);
        } else {
          ok = this.gl.drawBlur(frame as any, this.opts.blurRadius || BLUR_PX);
        }
        if (ok && this.gl.surface) {
          // WebGL default FB is bottom-left; flip on 2d blit only.
          // Do NOT flip in the vertex shader — that breaks FBO ping-pong blur
          // plate alignment vs mask/sharp (black jagged blobs).
          ctx.save();
          ctx.globalCompositeOperation = "copy";
          ctx.filter = "none";
          // Full-cover Y flip via setTransform. 1px overscan covers the cyan
          // seam OffscreenCanvas WebGL leaves when H is odd / subpixel.
          const Wi = Math.round(W), Hi = Math.round(H);
          if (ctx.canvas.width !== Wi || ctx.canvas.height !== Hi) {
            ctx.canvas.width = Wi;
            ctx.canvas.height = Hi;
          }
          ctx.imageSmoothingEnabled = false;
          ctx.setTransform(1, 0, 0, -1, 0, Hi);
          ctx.drawImage(this.gl.surface as any, 0, -1, Wi, Hi + 2);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.restore();
          return;
        }
      } catch {
        // Fall through to canvas2d — never hard-crash on a bad GL frame.
      }
    }

    // Hard matte for the person punch — soft sil was dissolving the face.
    // (canvas2d fallback when WebGL2 unavailable or a GL draw failed)
    const sil = this.personMatte(W, H);
    if (!sil) {
      // Never Gaussian the subject. Sharp passthrough until a matte exists.
      ctx.save();
      ctx.globalCompositeOperation = "copy";
      ctx.filter = "none";
      ctx.drawImage(frame as any, 0, 0, W, H);
      ctx.restore();
      return;
    }

    if (!this.personCanvas || this.personCanvas.width !== W || this.personCanvas.height !== H) {
      this.personCanvas = new OffscreenCanvas(W, H);
      this.personCtx = this.personCanvas.getContext("2d", { willReadFrequently: false });
    }
    const p = this.personCtx;
    if (!p) {
      ctx.save();
      ctx.globalCompositeOperation = "copy";
      ctx.filter = "none";
      ctx.drawImage(frame as any, 0, 0, W, H);
      ctx.restore();
      return;
    }

    // Person cutout: hard matte × full-res VideoFrame. No filter on the person
    // layer — subject stays as sharp as the raw camera (Zoom/Meet pattern).
    p.save();
    p.globalCompositeOperation = "copy";
    p.filter = "none";
    p.drawImage(sil as any, 0, 0, W, H);
    p.globalCompositeOperation = "source-in";
    p.filter = "none";
    p.drawImage(frame as any, 0, 0, W, H);
    p.restore();

    ctx.save();
    ctx.filter = "none";
    // 1. full background (blur ONLY the hist/bg plate — never the person)
    ctx.globalCompositeOperation = "copy";
    if ((this.opts.kind === "image" || this.opts.kind === "video") && (this.bg || this.bgVideo)) {
      const src: any = this.bgVideo && this.bgVideo.readyState >= 2 ? this.bgVideo : this.bg;
      if (src) drawCoverSoft(ctx, src, W, H, BACKDROP_DOF_PX);
      else if (this.bg) drawCoverSoft(ctx, this.bg, W, H, BACKDROP_DOF_PX);
      else {
        const soft = this.personFreeBlur(frame as any, W, H, this.opts.blurRadius || BLUR_PX);
        if (soft) ctx.drawImage(soft as any, 0, 0, W, H);
      }
    } else {
      const soft = this.personFreeBlur(frame as any, W, H, this.opts.blurRadius || BLUR_PX);
      if (soft) ctx.drawImage(soft as any, 0, 0, W, H);
      else {
        // Fallback bg only — still do not blur the person layer below.
        ctx.filter = `blur(${this.opts.blurRadius || BLUR_PX}px)`;
        ctx.drawImage(frame as any, 0, 0, W, H);
        ctx.filter = "none";
      }
    }
    // 2. opaque person on top — hard matte, camera-sharp
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.drawImage(this.personCanvas as any, 0, 0, W, H);
    ctx.restore();
  }

  /** No mask yet — blur EVERYTHING. The person stays live and moving; their
   *  room is not readable for even one frame. The alternative the stock
   *  library chose, republishing the last good frame, is the strobe. */
  private paintBlurAll(frame: VideoFrame, W: number, H: number) {
    const ctx = this.ctx!;
    const radius = Math.max(BLUR_PX, this.opts.blurRadius || 0);
    ctx.save();
    ctx.globalCompositeOperation = "copy";
    const soft = this.blurred(frame as any, W, H, radius);
    if (soft) ctx.drawImage(soft as any, 0, 0, W, H);
    else {
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(frame as any, 0, 0, W, H);
      ctx.filter = "none";
    }
    ctx.restore();
  }
}

/** Cover, not stretch: a 16:9 backdrop behind a 4:3 camera must be cropped,
 *  not squashed. A squashed horizon is another thing an eye reads as fake. */
function drawCover(
  ctx: OffscreenCanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number }, W: number, H: number,
) {
  const iw = (img as any).videoWidth || (img as any).width || W;
  const ih = (img as any).videoHeight || (img as any).height || H;
  const ar = iw / ih, target = W / H;
  let sw = iw, sh = ih, sx = 0, sy = 0;
  if (ar > target) { sw = ih * target; sx = (iw - sw) / 2; }
  else { sh = iw / target; sy = (ih - sh) / 2; }
  ctx.drawImage(img as any, sx, sy, sw, sh, 0, 0, W, H);
}

/** Cover + a few pixels of lens falloff so a backdrop reads as depth, not a
 *  sticker. The blur is applied via a temporary filter on the draw — cheap,
 *  and the same for stills and live loop frames. */
function drawCoverSoft(
  ctx: OffscreenCanvasRenderingContext2D,
  img: CanvasImageSource & { width?: number; height?: number },
  W: number, H: number, dofPx: number = BACKDROP_DOF_PX,
) {
  const r = Math.max(0, Number(dofPx) || 0);
  if (r > 0) ctx.filter = `blur(${r}px)`;
  drawCover(ctx, img as any, W, H);
  ctx.filter = "none";
}

/** Is a same-origin asset actually there? Cheap HEAD, and any failure means
 *  "no" — the CDN path is always a working answer. */
async function head(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "force-cache" });
    return r.ok;
  } catch { return false; }
}

/** Build a processor for an effect. The NAME carries the effect id, which is
 *  how a live track can be asked what it is already wearing — the question
 *  that stops the re-apply loop that caused the flashing. */
export function quantlysBackground(effectId: string, opts: QbgOptions) {
  return new ProcessorWrapper(new QuantlysBackground(opts) as any, procName(effectId));
}
