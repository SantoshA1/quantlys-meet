"use client";

// Spike: MODNet webcam ONNX as matte source for blur / image / video backgrounds.
//
// Model source + license (do not replace without re-checking license):
//   - Weights: modnet_webcam.onnx from yakhyo/modnet releases (ported from ZHKKKe/MODNet)
//   - Upstream: ZHKKKe/MODNet (Apache-2.0); port/export: yakhyo/modnet (Apache-2.0)
//   - SHA-256: de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306
// Prefer same-origin /models/modnet_webcam.onnx (scripts/download-modnet.sh).
// CDN/release URL is only a fetch fallback when the local file is missing.
// NO RVM (GPL-3). NO BRIA RMBG without commercial license.

import type { InferenceSession } from "onnxruntime-web";

export type MatteBackend = "modnet" | "mediapipe";

/** Default preference when available. Overridden by ?matte= or localStorage. */
export const PREFERRED_MATTE: MatteBackend = "modnet";

export const MATTE_STORAGE_KEY = "quantlys-matte";
export const MODNET_LOCAL_URL = "/models/modnet_webcam.onnx";
export const MODNET_CDN_URL =
  "https://github.com/yakhyo/modnet/releases/download/weights/modnet_webcam.onnx";
/** Integrity note for operators — browser Cache API path does not enforce this yet. */
export const MODNET_SHA256 =
  "de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306";
export const MODNET_REF_SIZE = 512;
/** Match package.json onnxruntime-web major/minor for wasm assets. */
export const ORT_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

export type MatteResolveOpts = {
  search?: string | null;
  storage?: { getItem(key: string): string | null } | null;
  preferred?: MatteBackend;
};

/** Query (?matte=) > localStorage > PREFERRED_MATTE / preferred. */
export function resolveMattePreference(opts: MatteResolveOpts = {}): MatteBackend {
  const fromQuery = parseMatteToken(queryMatte(opts.search));
  if (fromQuery) return fromQuery;
  try {
    const store = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const fromStore = parseMatteToken(store?.getItem(MATTE_STORAGE_KEY));
    if (fromStore) return fromStore;
  } catch { /* private mode / SSR */ }
  return parseMatteToken(opts.preferred) || PREFERRED_MATTE;
}

export function parseMatteToken(raw: string | null | undefined): MatteBackend | null {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "modnet" || t === "mediapipe") return t;
  return null;
}

function queryMatte(search?: string | null): string | null {
  try {
    const q = search ?? (typeof location !== "undefined" ? location.search : "");
    if (!q) return null;
    const sp = new URLSearchParams(q.startsWith("?") ? q : `?${q}`);
    return sp.get("matte");
  } catch {
    return null;
  }
}

/** Green screen Reliable never loads ML matte (MODNet or MediaPipe). */
export function chromaSkipsMlMatte(kind: string): boolean {
  return kind === "chroma";
}

/** True when blur / Beta (image|video) should prefer MODNet before MediaPipe. */
export function wantsMlMatte(kind: string): boolean {
  return kind === "blur" || kind === "image" || kind === "video";
}

export type ModnetInferResult = {
  /** Person alpha 0..255 at model resolution (soft matte — no harden). */
  alpha: Uint8ClampedArray;
  w: number;
  h: number;
};

/**
 * Browser MODNet runner. WebGPU preferred, WASM fallback.
 * Callers must keep the VideoFrame alive until drawImage in infer() returns;
 * ORT run itself is async on a copied tensor.
 */
export class ModnetMatte {
  private session: InferenceSession | null = null;
  private inputName = "input";
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private tensorBuf: Float32Array | null = null;
  private alphaBuf: Uint8ClampedArray | null = null;
  private inflight = false;
  ready = false;
  ep: "webgpu" | "wasm" | null = null;

  get isReady(): boolean { return this.ready && !!this.session; }
  get busy(): boolean { return this.inflight; }

  async init(modelUrl: string = MODNET_LOCAL_URL): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const ort = await import("onnxruntime-web");
      const localWasm = await headOk("/ort/ort-wasm-simd-threaded.wasm");
      ort.env.wasm.wasmPaths = localWasm ? "/ort/" : ORT_WASM_CDN;
      ort.env.wasm.numThreads = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 2));

      const modelData = await fetchModelBuffer(modelUrl);
      if (!modelData) return false;

      const tryEp = async (ep: "webgpu" | "wasm"): Promise<InferenceSession | null> => {
        try {
          return await ort.InferenceSession.create(modelData.slice(0), {
            executionProviders: [ep],
            graphOptimizationLevel: "all",
          });
        } catch {
          return null;
        }
      };

      let session = await tryEp("webgpu");
      let ep: "webgpu" | "wasm" | null = session ? "webgpu" : null;
      if (!session) {
        session = await tryEp("wasm");
        ep = session ? "wasm" : null;
      }
      if (!session) return false;

      this.session = session;
      this.inputName = session.inputNames[0] || "input";
      this.ep = ep;
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      this.session = null;
      this.ep = null;
      return false;
    }
  }

  async infer(src: CanvasImageSource, vw: number, vh: number): Promise<ModnetInferResult | null> {
    if (!this.session || !this.ready || this.inflight) return null;
    const ow = Math.max(1, Math.round(Number(vw) || 0));
    const oh = Math.max(1, Math.round(Number(vh) || 0));
    if (!ow || !oh) return null;

    const { tw, th } = modnetInputSize(ow, oh, MODNET_REF_SIZE);
    if (!this.canvas || this.canvas.width !== tw || this.canvas.height !== th) {
      this.canvas = new OffscreenCanvas(tw, th);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx) return null;

    ctx.save();
    ctx.globalCompositeOperation = "copy";
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src as CanvasImageSource, 0, 0, tw, th);
    ctx.restore();

    let id: ImageData;
    try {
      id = ctx.getImageData(0, 0, tw, th);
    } catch {
      return null;
    }

    const n = tw * th;
    if (!this.tensorBuf || this.tensorBuf.length !== n * 3) {
      this.tensorBuf = new Float32Array(n * 3);
    }
    const t = this.tensorBuf;
    const px = id.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      t[i] = px[p]! / 127.5 - 1;
      t[n + i] = px[p + 1]! / 127.5 - 1;
      t[2 * n + i] = px[p + 2]! / 127.5 - 1;
    }

    this.inflight = true;
    try {
      const ort = await import("onnxruntime-web");
      const tensor = new ort.Tensor("float32", t, [1, 3, th, tw]);
      const out = await this.session.run({ [this.inputName]: tensor });
      const first = out[this.session.outputNames[0]!];
      if (!first) return null;
      const data = first.data as Float32Array | number[];
      if (!this.alphaBuf || this.alphaBuf.length !== n) {
        this.alphaBuf = new Uint8ClampedArray(n);
      }
      const a = this.alphaBuf;
      // Soft matte: prove model alone — no harden / island / plant heuristics.
      for (let i = 0; i < n; i++) {
        const v = Number(data[i]);
        a[i] = Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * 255)));
      }
      return { alpha: a, w: tw, h: th };
    } catch {
      return null;
    } finally {
      this.inflight = false;
    }
  }

  dispose(): void {
    this.ready = false;
    this.ep = null;
    try { void (this.session as any)?.release?.(); } catch { /* best-effort */ }
    this.session = null;
    this.canvas = null;
    this.ctx = null;
    this.tensorBuf = null;
    this.alphaBuf = null;
    this.inflight = false;
  }
}

/** Short-side ref_size, both dims divisible by 32 (official ONNX preprocess). */
export function modnetInputSize(
  w: number, h: number, refSize: number = MODNET_REF_SIZE,
): { tw: number; th: number } {
  const ow = Math.max(1, Math.round(Number(w) || 1));
  const oh = Math.max(1, Math.round(Number(h) || 1));
  let th: number, tw: number;
  if (Math.max(ow, oh) < refSize || Math.min(ow, oh) > refSize) {
    if (ow >= oh) {
      th = refSize;
      tw = Math.round((ow / oh) * refSize);
    } else {
      tw = refSize;
      th = Math.round((oh / ow) * refSize);
    }
  } else {
    th = oh;
    tw = ow;
  }
  tw = Math.max(32, tw - (tw % 32));
  th = Math.max(32, th - (th % 32));
  return { tw, th };
}

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "force-cache" });
    return r.ok;
  } catch {
    return false;
  }
}

async function fetchModelBuffer(preferredUrl: string): Promise<ArrayBuffer | null> {
  const urls = preferredUrl === MODNET_LOCAL_URL
    ? [MODNET_LOCAL_URL, MODNET_CDN_URL]
    : [preferredUrl, MODNET_LOCAL_URL, MODNET_CDN_URL];
  for (const url of urls) {
    try {
      if (typeof caches !== "undefined") {
        const cache = await caches.open("quantlys-modnet-v1");
        const hit = await cache.match(url);
        if (hit && hit.ok) return await hit.arrayBuffer();
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        try {
          await cache.put(url, new Response(buf.slice(0), { headers: res.headers }));
        } catch { /* quota */ }
        return buf;
      }
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) continue;
      return await res.arrayBuffer();
    } catch {
      continue;
    }
  }
  return null;
}
