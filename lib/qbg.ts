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
//   4. Segmentation runs at 20Hz under 30fps of video, with buffers reused
//      and zero per-frame allocation of ImageBitmaps.
//   5. Frames that arrive while one is in flight are dropped, not queued —
//      a queue on live video is latency that compounds.
//   6. Model and WASM are served from our own origin when present, so the
//      first blur does not wait on a CDN and a desktop build works offline.
//
// This file only runs in a browser with MediaStreamTrackGenerator; every
// caller checks effectSupport() first.

import { ProcessorWrapper, VideoTransformer } from "@livekit/track-processors";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  BLUR_PX, BACKDROP_DOF_PX, shouldSegment, blendMask,
  warmupPaint, segmentSize, shouldDropFrame, assetPaths, procName,
  CENTER_BOX, maskPolarity, boxMean, edgeMean, type Polarity,
  maskBlurPx, ERODE_POWER, needsInvert,
  confidenceToAlpha, overscanRect, bokehPass,
} from "./effects";

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
  private bg: ImageBitmap | null = null;
  /** living loop element; drawn each paint when kind === "video" */
  private bgVideo: HTMLVideoElement | null = null;
  private busy = false;

  /** the smoothed mask, alpha channel only, at segmentation resolution */
  private smooth: Uint8ClampedArray | null = null;
  private maskCanvas?: OffscreenCanvas;
  private maskCtx?: OffscreenCanvasRenderingContext2D | null;
  /** the mask after inversion, blur and erosion — always means THE PERSON */
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
  /** Which class the mask paints opaque. MEASURED, never assumed — see the
   *  post-mortem above maskPolarity() in lib/effects.ts. */
  private polarity: Polarity | null = null;

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
    const local = assetPaths({ wasm: await head("/mediapipe/wasm/vision_wasm_internal.js"), model: await head("/mediapipe/selfie_segmenter.tflite") });
    const fileSet = await vision.FilesetResolver.forVisionTasks(
      local?.tasksVisionFileSet ||
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm",
    );
    this.seg = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath: local?.modelAssetPath ||
          "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
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
    if (this.opts.kind === "video" && this.opts.videoPath) await this.loadVideo(this.opts.videoPath);
    else if (this.opts.imagePath) await this.loadBackground(this.opts.imagePath);
  }

  async destroy(): Promise<void> {
    await super.destroy();
    try { await this.seg?.close(); } catch { /* closing twice is not an error worth surfacing */ }
    this.seg = undefined;
    this.bg = null;
    this.teardownVideo();
    this.smooth = null;
    this.haveMask = false;
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
        controller.enqueue(frame);
        return;
      }
      const W = this.canvas.width, H = this.canvas.height;

      if (this.inputVideo) this.segment(this.inputVideo, W, H);

      const paint = warmupPaint({ wantsEffect: true, hasMask: this.haveMask });
      if (paint === "masked") this.paintMasked(frame, W, H);
      else this.paintBlurAll(frame, W, H);

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

  /** Run the model at SEGMENT_HZ on a downscaled copy, then mix the result
   *  into the smoothed mask. Synchronous by design — segmentForVideo's
   *  callback fires inline, and awaiting anything here is how the stock
   *  version ended up with a mask that belonged to a frame already gone. */
  private segment(video: HTMLVideoElement, W: number, H: number) {
    const now = performance.now();
    if (!this.seg || !shouldSegment(now, this.lastSegAt)) return;
    const vw = video.videoWidth || W, vh = video.videoHeight || H;
    if (!vw || !vh) return;
    const s = segmentSize(vw, vh);

    if (!this.smallCanvas || this.smallCanvas.width !== s.w || this.smallCanvas.height !== s.h) {
      this.smallCanvas = new OffscreenCanvas(s.w, s.h);
      this.smallCtx = this.smallCanvas.getContext("2d", { willReadFrequently: true });
      this.smooth = null;            // resolution changed — start the memory over
      this.maskImage = undefined;
    }
    if (!this.smallCtx) return;
    this.smallCtx.drawImage(video, 0, 0, s.w, s.h);

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
        this.smooth = blendMask(this.smooth, raw as any) as Uint8ClampedArray;

        if (!this.maskCanvas || this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
          this.maskCanvas = new OffscreenCanvas(mw, mh);
          this.maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: false });
          this.maskImage = new ImageData(mw, mh);
        }
        // The mask goes into the canvas as pure alpha — the colour channels
        // are irrelevant to every composite below, so writing only alpha is
        // a quarter of the memory traffic of the stock RGBA copy.
        const px = this.maskImage!.data;
        const sm = this.smooth!;
        for (let i = 0, j = 3; i < sm.length; i++, j += 4) px[j] = sm[i];
        this.maskCtx!.putImageData(this.maskImage!, 0, 0);
        this.haveMask = true;

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

  /** The silhouette, prepared once per frame on its own canvas: normalised so
   *  it always means THE PERSON, blurred, then eroded so it sits inside the
   *  mask's own generous edge.
   *
   *  Erosion is why "blur is not effective around the edges of the people"
   *  stopped being true: the selfie model keeps a rim of real room around a
   *  person, and feathering that rim leaves it SHARP, drawn at full strength
   *  exactly where the eye is looking. Pulling the silhouette in hands that
   *  rim to the blur where it belongs. */
  private silhouette(W: number, H: number): OffscreenCanvas | null {
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
    s.drawImage(this.maskCanvas as any, 0, 0, W, H);

    // Normalise polarity ONCE, here, instead of branching the composite in
    // the paint path where getting it backwards blurs the person (which it
    // did). `source-out` + a full fill is alpha inversion on a canvas.
    if (needsInvert(this.polarity || "background")) {
      s.globalCompositeOperation = "source-out";
      s.fillStyle = "#000";
      s.fillRect(0, 0, W, H);
    }

    // Soften enough to carry both jobs: the erosion needs a ramp to bite on,
    // and what survives it is the feather.
    s.globalCompositeOperation = "copy";
    s.filter = `blur(${maskBlurPx(H)}px)`;
    s.drawImage(this.silCanvas as any, 0, 0, W, H);
    s.filter = "none";

    // alpha -> alpha^ERODE_POWER, which walks the half-way line inward. Each
    // self-composite with source-in multiplies the alpha by itself.
    s.globalCompositeOperation = "source-in";
    for (let i = 1; i < ERODE_POWER; i++) s.drawImage(this.silCanvas as any, 0, 0, W, H);

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

  /** The good path: person sharp, background replaced, edge eroded and
   *  feathered. Composite order matters and is the reason this reads as a
   *  lens rather than a sticker. */
  private paintMasked(frame: VideoFrame, W: number, H: number) {
    const ctx = this.ctx!;
    const sil = this.silhouette(W, H);
    if (!sil) { this.paintBlurAll(frame, W, H); return; }
    ctx.save();

    // 1. the prepared silhouette — always the person, never the room
    ctx.globalCompositeOperation = "copy";
    ctx.filter = "none";
    ctx.drawImage(sil as any, 0, 0, W, H);

    // 2. the person, punched out of the live frame by it
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(frame as any, 0, 0, W, H);

    // 3. the background, painted behind them
    ctx.globalCompositeOperation = "destination-over";
    if ((this.opts.kind === "image" || this.opts.kind === "video") && (this.bg || this.bgVideo)) {
      // JUST the backdrop — never an under-blur of the real room (that buried
      // every image effect). Soft DOF so the backdrop sits behind the person.
      const src: any = this.bgVideo && this.bgVideo.readyState >= 2 ? this.bgVideo : this.bg;
      if (src) drawCoverSoft(ctx, src, W, H, BACKDROP_DOF_PX);
      else if (this.bg) drawCoverSoft(ctx, this.bg, W, H, BACKDROP_DOF_PX);
    } else {
      const soft = this.blurred(frame as any, W, H, this.opts.blurRadius || BLUR_PX);
      if (soft) ctx.drawImage(soft as any, 0, 0, W, H);
      else {
        // The small canvas could not be made — blur in place rather than
        // publish a sharp room behind somebody who asked for privacy.
        ctx.filter = `blur(${this.opts.blurRadius || BLUR_PX}px)`;
        ctx.drawImage(frame as any, 0, 0, W, H);
        ctx.filter = "none";
      }
    }
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
