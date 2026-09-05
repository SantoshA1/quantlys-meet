"use client";

// Meet-style WebGL2 background compositor.
//
// Pipeline (Google Meet blog pattern):
//   1. MediaPipe still produces a low-res confidence mask (CPU, in qbg.ts).
//   2. Each frame: upload camera + mask to GPU textures.
//   3. Joint bilateral refine (runJbf) aligns matte to image boundaries.
//   4. Separable Gaussian blur of the BACKGROUND only — samples weighted by
//      hard room exclusion and renormalized so person color cannot bleed into
//      the blur plate (kills the dark halo from shirt / cap).
//   5. Full-res composite: out = mix(bgOrBlur, sharpFrame, refined personAlpha).
//   6. Blit the GL canvas into the processor's 2d canvas for VideoFrame.
//
// One context per canvas: we own an OffscreenCanvas (or HTMLCanvasElement)
// with webgl2. The LiveKit output canvas stays 2d; one drawImage blit per
// frame, never getImageData.

/** Exported for file/unit tests — must contain weighted blur + mix. */
export const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // Keep UV unflipped for ALL passes (including FBO ping-pong). Flipping here
  // uprighted the final blit but misaligned the blur plate vs mask — black
  // jagged blobs in the room (FIELD 2026-09-04). Upright is done in the 2d blit.
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/** Horizontal separable blur. Weight by (1.0 - personMask), renormalize. */
export const FRAG_BLUR_H = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform vec2 u_texel;   // 1/width, 0 for H
uniform vec2 u_maskTexel; // 1/W, 1/H for 4-neigh erode
uniform float u_radius; // blur radius in source pixels at this pass size

float sampleMaskEroded(vec2 uv) {
  float m = texture(u_mask, uv).r;
  m = min(m, texture(u_mask, uv + vec2(u_maskTexel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv - vec2(u_maskTexel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv + vec2(0.0, u_maskTexel.y)).r);
  m = min(m, texture(u_mask, uv - vec2(0.0, u_maskTexel.y)).r);
  return m;
}

void main() {
  // Fixed 17-tap Gaussian; sigma ~ radius/3. Distances in texels.
  float sigma = max(0.5, u_radius / 3.0);
  float twoSigma2 = 2.0 * sigma * sigma;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float off = fi * (u_radius / 8.0);
    vec2 uv = v_uv + vec2(off * u_texel.x, off * u_texel.y);
    float m = sampleMaskEroded(uv);
    // Harder room exclusion: mid-mask near person contributes almost nothing
    // to the blur plate (kills dark clothing fringe into blur).
    float room = 1.0 - smoothstep(0.15, 0.45, m);
    float w = exp(-(off * off) / twoSigma2) * room;
    sum += texture(u_frame, uv) * w;
    wsum += w;
  }
  // Fallback to sharp when mask briefly marks room as person (prevents black holes).
  if (wsum > 1e-3) {
    outColor = sum / wsum;
  } else {
    outColor = texture(u_frame, v_uv);
  }
}
`;

/** Vertical separable blur — same weighting as H. */
export const FRAG_BLUR_V = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform vec2 u_texel;
uniform vec2 u_maskTexel; // 1/W, 1/H for 4-neigh erode
uniform float u_radius;

float sampleMaskEroded(vec2 uv) {
  float m = texture(u_mask, uv).r;
  m = min(m, texture(u_mask, uv + vec2(u_maskTexel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv - vec2(u_maskTexel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv + vec2(0.0, u_maskTexel.y)).r);
  m = min(m, texture(u_mask, uv - vec2(0.0, u_maskTexel.y)).r);
  return m;
}

void main() {
  float sigma = max(0.5, u_radius / 3.0);
  float twoSigma2 = 2.0 * sigma * sigma;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float off = fi * (u_radius / 8.0);
    vec2 uv = v_uv + vec2(off * u_texel.x, off * u_texel.y);
    float m = sampleMaskEroded(uv);
    // Harder room exclusion: mid-mask near person contributes almost nothing
    // to the blur plate (kills dark clothing fringe into blur).
    float room = 1.0 - smoothstep(0.15, 0.45, m);
    float w = exp(-(off * off) / twoSigma2) * room;
    sum += texture(u_frame, uv) * w;
    wsum += w;
  }
  // Fallback to sharp when mask briefly marks room as person (prevents black holes).
  if (wsum > 1e-3) {
    outColor = sum / wsum;
  } else {
    outColor = texture(u_frame, v_uv);
  }
}
`;

/** Full-res composite: sharp person over blurred (or virtual) background. */
/** Joint bilateral refine tunables (Meet-style edge align). Exported for tests. */
export const JBF_RADIUS = 5;
export const JBF_SIGMA_SPACE = 2.5;
export const JBF_SIGMA_RANGE = 0.1;
/** Blur-path light-wrap softEdge (virtual image/video stays 0). */
export const LIGHT_WRAP_BLUR = 0.35;
/** Temporal EMA mix with previous chroma matte (kills sparkle flicker). */
export const CHROMA_MASK_EMA = 0.68;
/** Morphological SE radius (px) for close-then-open on chroma matte. */
export const CHROMA_MORPH_RADIUS = 2;
/** Dark-fringe decontam mix toward BG (blur path); kept mild for navy caps. */
export const DARK_FRINGE_MIX = 0.32;

/**
 * Joint bilateral filter on the person mask guided by frame luminance.
 * Meet blog: joint bilateral aligns matte to image boundaries before composite.
 */
export const FRAG_JBF = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_mask;
uniform sampler2D u_guide;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_sigmaSpace;
uniform float u_sigmaRange;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  float centerM = texture(u_mask, v_uv).r;
  float centerL = luma(texture(u_guide, v_uv).rgb);
  float sigmaS = max(0.5, u_sigmaSpace);
  float sigmaR = max(0.01, u_sigmaRange);
  float twoS = 2.0 * sigmaS * sigmaS;
  float twoR = 2.0 * sigmaR * sigmaR;
  float sum = 0.0;
  float wsum = 0.0;
  int R = int(clamp(u_radius, 1.0, 8.0));
  for (int dy = -8; dy <= 8; dy++) {
    if (dy < -R || dy > R) continue;
    for (int dx = -8; dx <= 8; dx++) {
      if (dx < -R || dx > R) continue;
      vec2 off = vec2(float(dx), float(dy)) * u_texel;
      vec2 uv = v_uv + off;
      float m = texture(u_mask, uv).r;
      float l = luma(texture(u_guide, uv).rgb);
      float ds = float(dx * dx + dy * dy);
      float dr = l - centerL;
      float w = exp(-ds / twoS) * exp(-(dr * dr) / twoR);
      sum += m * w;
      wsum += w;
    }
  }
  float outM = wsum > 1e-5 ? sum / wsum : centerM;
  // Mild shrink bias: prefer not growing the matte past the filtered min of
  // a small neighborhood when the bilateral would expand (chair fluff).
  float nMin = centerM;
  nMin = min(nMin, texture(u_mask, v_uv + vec2(u_texel.x, 0.0)).r);
  nMin = min(nMin, texture(u_mask, v_uv - vec2(u_texel.x, 0.0)).r);
  nMin = min(nMin, texture(u_mask, v_uv + vec2(0.0, u_texel.y)).r);
  nMin = min(nMin, texture(u_mask, v_uv - vec2(0.0, u_texel.y)).r);
  if (outM > centerM) {
    outM = mix(outM, min(outM, nMin), 0.45);
  }
  outColor = vec4(outM, outM, outM, 1.0);
}
`;


/** Chroma-key person mask from camera RGB (HSV/YCbCr-ish green).
 *  person = 1 where NOT green screen; green cloth → 0 (background).
 *  No MediaPipe — Reliable path when the user has a green backdrop. */
export const FRAG_CHROMA_MASK = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_frame;
uniform float u_flipY;

vec2 maybeFlip(vec2 uv) {
  return u_flipY > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv;
}

void main() {
  vec3 c = texture(u_frame, maybeFlip(v_uv)).rgb;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
  // Classic green dominance + olive/yellow-green (g>r and g>b both positive).
  float greenDom = c.g - max(c.r, c.b);
  float olive = min(c.g - c.r, c.g - c.b);
  float greenAmt = max(greenDom, olive * 0.9);
  // Wider soft thresholds for wrinkled / uneven cloth (holes + shade).
  float key = smoothstep(0.02, 0.14, greenAmt) * smoothstep(0.08, 0.28, sat);
  // Mild YCbCr assist: green screen sits in low Cr / mid-high Cb territory.
  float y  = dot(c, vec3(0.299, 0.587, 0.114));
  float cb = 0.5 + (c.b - y) * 0.564;
  float cr = 0.5 + (c.r - y) * 0.713;
  float ycbcrKey = smoothstep(0.40, 0.52, cb) * (1.0 - smoothstep(0.38, 0.48, cr))
                 * smoothstep(0.08, 0.26, sat);
  key = max(key, ycbcrKey * 0.85);
  float person = 1.0 - clamp(key, 0.0, 1.0);
  outColor = vec4(person, person, person, 1.0);
}
`;

/** Dilate (u_mode=0) or erode (u_mode=1) person matte with small SE (~2–3px). */
export const FRAG_CHROMA_MORPH = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_mask;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_mode;

void main() {
  float r = clamp(u_radius, 1.0, 3.0);
  float m = texture(u_mask, v_uv).r;
  for (int i = 1; i <= 3; i++) {
    if (float(i) > r + 0.01) break;
    vec2 t = u_texel * float(i);
    float a = texture(u_mask, v_uv + vec2( t.x, 0.0)).r;
    float b = texture(u_mask, v_uv + vec2(-t.x, 0.0)).r;
    float c = texture(u_mask, v_uv + vec2(0.0,  t.y)).r;
    float d = texture(u_mask, v_uv + vec2(0.0, -t.y)).r;
    float e = texture(u_mask, v_uv + vec2( t.x,  t.y)).r;
    float f = texture(u_mask, v_uv + vec2( t.x, -t.y)).r;
    float g = texture(u_mask, v_uv + vec2(-t.x,  t.y)).r;
    float h = texture(u_mask, v_uv + vec2(-t.x, -t.y)).r;
    if (u_mode < 0.5) {
      m = max(m, max(max(max(a, b), max(c, d)), max(max(e, f), max(g, h))));
    } else {
      m = min(m, min(min(min(a, b), min(c, d)), min(min(e, f), min(g, h))));
    }
  }
  outColor = vec4(m, m, m, 1.0);
}
`;

/** Temporal EMA: mix current chroma matte with previous to kill sparkle flicker. */
export const FRAG_CHROMA_EMA = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_curr;
uniform sampler2D u_prev;
uniform float u_mix;
uniform float u_hasPrev;

void main() {
  float c = texture(u_curr, v_uv).r;
  float p = texture(u_prev, v_uv).r;
  float m = (u_hasPrev > 0.5) ? mix(c, p, clamp(u_mix, 0.0, 0.95)) : c;
  outColor = vec4(m, m, m, 1.0);
}
`;

export const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_sharp;
uniform sampler2D u_bg;      // blur plate OR virtual bg (already cover-fitted into tex)
uniform sampler2D u_mask;
uniform float u_useVirtual;  // 1.0 = sample u_bg as virtual cover, 0.0 = blur plate
uniform vec4 u_cover;        // sx, sy, sw, sh in bg texture UV
uniform float u_softEdge;    // light wrap strength 0..1 (blur only; virtual forces 0)
uniform float u_flipY;       // 1.0 if video textures need Y flip
uniform vec2 u_texel;        // 1/W, 1/H for 1-texel morphological erode

vec2 maybeFlip(vec2 uv) {
  return u_flipY > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv;
}

float sampleMaskEroded(vec2 uv) {
  float m = texture(u_mask, uv).r;
  m = min(m, texture(u_mask, uv + vec2(u_texel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv - vec2(u_texel.x, 0.0)).r);
  m = min(m, texture(u_mask, uv + vec2(0.0, u_texel.y)).r);
  m = min(m, texture(u_mask, uv - vec2(0.0, u_texel.y)).r);
  // Virtual path: also min diagonals (8-neigh) for stronger erode on plant fringe.
  if (u_useVirtual > 0.5) {
    m = min(m, texture(u_mask, uv + vec2(u_texel.x, u_texel.y)).r);
    m = min(m, texture(u_mask, uv + vec2(u_texel.x, -u_texel.y)).r);
    m = min(m, texture(u_mask, uv + vec2(-u_texel.x, u_texel.y)).r);
    m = min(m, texture(u_mask, uv + vec2(-u_texel.x, -u_texel.y)).r);
  }
  return m;
}

void main() {
  vec2 uv = maybeFlip(v_uv);
  vec4 sharp = texture(u_sharp, uv);
  // 1-texel morphological erode: shrinks chair fluff / plant attached to silhouette.
  float mask = sampleMaskEroded(uv);
  // Inward erode via tighter smoothstep — kills room rim + plant fringe on cap.
  float person = smoothstep(0.52, 0.68, mask);

  vec4 bg;
  if (u_useVirtual > 0.5) {
    vec2 buv = vec2(u_cover.x + v_uv.x * u_cover.z, u_cover.y + v_uv.y * u_cover.w);
    bg = texture(u_bg, buv);
  } else {
    bg = texture(u_bg, v_uv);
  }

  // Light wrap only for blur; virtual wrap added weird edge glow.
  float edge = person * (1.0 - person) * 4.0;
  float wrap = (u_useVirtual > 0.5) ? 0.0 : (clamp(u_softEdge, 0.0, 1.0) * edge * 0.12);
  float a = clamp(person - wrap, 0.0, 1.0);

  // Mid-edge spill suppression (dark fringe + color distance).
  // Plant chroma force-zero removed — fought real greens (shirt/plants).
  float sharpL = dot(sharp.rgb, vec3(0.299, 0.587, 0.114));
  float bgL = dot(bg.rgb, vec3(0.299, 0.587, 0.114));
  float mid = step(0.04, a) * step(a, 0.92);
  // Bias fringe to mid-range luma — skip near-black navy caps / dark clothing.
  float midLuma = smoothstep(0.10, 0.28, sharpL) * (1.0 - smoothstep(0.75, 0.92, sharpL));
  float darkFringe = mid * midLuma * clamp((bgL - sharpL - 0.04) / 0.20, 0.0, 1.0);
  float colorDist = length(sharp.rgb - bg.rgb);
  // Skin-like: r mildly above g and b — do not pull skin toward bg.
  float skinLike = step(sharp.g + 0.02, sharp.r) * step(sharp.b, sharp.r);
  float colorSpill = mid * (1.0 - skinLike) * smoothstep(0.15, 0.45, colorDist);
  vec3 sharpUse = sharp.rgb;
  sharpUse = mix(sharpUse, bg.rgb, max(darkFringe * 0.32, colorSpill * 0.45));

  // Classic chroma spill (virtual/green-screen path): pull green tint toward BG
  // near the matte edge — despill only, never force alpha to zero.
  float edgeBand = person * (1.0 - person) * 4.0;
  float gLead = max(0.0, sharp.g - max(sharp.r, sharp.b));
  float chromaSpill = (u_useVirtual > 0.5)
    ? edgeBand * smoothstep(0.015, 0.10, gLead)
    : 0.0;
  float despillG = mix((sharpUse.r + sharpUse.b) * 0.5, bg.g, 0.55);
  sharpUse.g = mix(sharpUse.g, despillG, clamp(chromaSpill * 0.85, 0.0, 1.0));
  sharpUse = mix(sharpUse, bg.rgb, chromaSpill * 0.25);

  // out = mix(bgOrBlur, sharpFrame, personAlpha)
  outColor = mix(bg, vec4(sharpUse, 1.0), a);
  outColor.a = 1.0;
}
`;

type GL = WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    try { gl.deleteShader(sh); } catch { /* ignore */ }
    return null;
  }
  return sh;
}

function link(gl: GL, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/** Cover crop in normalized bg UV: { sx, sy, sw, sh }. */
export function coverUv(
  iw: number, ih: number, W: number, H: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const w = Number(W) || 1, h = Number(H) || 1;
  const tw = Number(iw) || w, th = Number(ih) || h;
  if (tw <= 0 || th <= 0 || w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: 1, sh: 1 };
  const ar = tw / th, target = w / h;
  if (ar > target) {
    const sw = target / ar;
    return { sx: (1 - sw) / 2, sy: 0, sw, sh: 1 };
  }
  const sh = ar / target;
  return { sx: 0, sy: (1 - sh) / 2, sw: 1, sh };
}

/**
 * Probe whether a WebGL2 compositor can be created.
 * Pass { webgl2: true|false } from tests; otherwise try OffscreenCanvas / canvas.
 */
export function probeWebgl2(): boolean {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(1, 1);
      const gl = c.getContext("webgl2");
      if (gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        try { ext?.loseContext(); } catch { /* ignore */ }
        return true;
      }
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      if (gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        try { ext?.loseContext(); } catch { /* ignore */ }
        return true;
      }
    }
  } catch { /* no GL */ }
  return false;
}

export class QbgGl {
  private gl: GL | null = null;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quad: WebGLBuffer | null = null;

  private blurH: WebGLProgram | null = null;
  private blurV: WebGLProgram | null = null;
  private composite: WebGLProgram | null = null;
  private jbf: WebGLProgram | null = null;
  private chromaMask: WebGLProgram | null = null;
  private chromaMorph: WebGLProgram | null = null;
  private chromaEma: WebGLProgram | null = null;

  private frameTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private bgTex: WebGLTexture | null = null;
  private refinedMaskTex: WebGLTexture | null = null;
  private chromaScratchTex: WebGLTexture | null = null;
  private chromaPrevTex: WebGLTexture | null = null;
  private jbfFbo: WebGLFramebuffer | null = null;

  private fboA: WebGLFramebuffer | null = null;
  private fboB: WebGLFramebuffer | null = null;
  private texA: WebGLTexture | null = null;
  private texB: WebGLTexture | null = null;

  private w = 0;
  private h = 0;
  private halfW = 0;
  private halfH = 0;
  private maskW = 0;
  private maskH = 0;
  private maskBuf: Uint8Array | null = null;
  private readyFlag = false;
  /** True after a successful runJbf this session/frame. */
  private jbfLive = false;
  /** True after at least one chroma matte was stored in chromaPrevTex. */
  private chromaHasPrev = false;

  get isReady(): boolean { return this.readyFlag && !!this.gl; }

  /** The GL drawing surface — blit this into the 2d output canvas. */
  get surface(): OffscreenCanvas | HTMLCanvasElement | null { return this.canvas; }

  /**
   * Create an OffscreenCanvas (preferred) or HTML canvas with webgl2.
   * The optional hint canvas is NOT stolen (one-context-per-canvas rule).
   */
  init(_hint?: HTMLCanvasElement | OffscreenCanvas | null): boolean {
    this.destroy();
    try {
      let canvas: OffscreenCanvas | HTMLCanvasElement;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(2, 2);
      } else if (typeof document !== "undefined") {
        canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
      } else {
        return false;
      }
      const gl = canvas.getContext("webgl2", {
        premultipliedAlpha: false,
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      }) as GL | null;
      if (!gl) return false;

      const blurH = link(gl, VERT_SRC, FRAG_BLUR_H);
      const blurV = link(gl, VERT_SRC, FRAG_BLUR_V);
      const composite = link(gl, VERT_SRC, FRAG_COMPOSITE);
      // JBF is optional — if link fails, skip refine (current behavior).
      const jbfProg = link(gl, VERT_SRC, FRAG_JBF);
      // Chroma mask is required for green-screen Reliable; fail init of chroma
      // path later if missing, but do not block blur/image init.
      const chromaProg = link(gl, VERT_SRC, FRAG_CHROMA_MASK);
      // Morph + EMA optional — raw chroma still works if either fails to link.
      const chromaMorphProg = link(gl, VERT_SRC, FRAG_CHROMA_MORPH);
      const chromaEmaProg = link(gl, VERT_SRC, FRAG_CHROMA_EMA);
      if (!blurH || !blurV || !composite) {
        if (blurH) gl.deleteProgram(blurH);
        if (blurV) gl.deleteProgram(blurV);
        if (composite) gl.deleteProgram(composite);
        if (jbfProg) gl.deleteProgram(jbfProg);
        if (chromaProg) gl.deleteProgram(chromaProg);
        if (chromaMorphProg) gl.deleteProgram(chromaMorphProg);
        if (chromaEmaProg) gl.deleteProgram(chromaEmaProg);
        return false;
      }

      const vao = gl.createVertexArray();
      const quad = gl.createBuffer();
      if (!vao || !quad) return false;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      this.canvas = canvas;
      this.gl = gl;
      this.vao = vao;
      this.quad = quad;
      this.blurH = blurH;
      this.blurV = blurV;
      this.composite = composite;
      this.jbf = jbfProg;
      this.chromaMask = chromaProg;
      this.chromaMorph = chromaMorphProg;
      this.chromaEma = chromaEmaProg;
      this.frameTex = this.createTexture();
      this.maskTex = this.createTexture();
      this.bgTex = this.createTexture();
      this.refinedMaskTex = this.createTexture();
      this.chromaScratchTex = this.createTexture();
      this.chromaPrevTex = this.createTexture();
      this.jbfFbo = gl.createFramebuffer();
      this.readyFlag = true;
      return true;
    } catch {
      this.destroy();
      return false;
    }
  }

  resize(w: number, h: number): void {
    if (!this.gl || !this.canvas) return;
    const W = Math.max(1, Math.round(Number(w) || 1));
    const H = Math.max(1, Math.round(Number(h) || 1));
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;
    this.halfW = Math.max(1, Math.round(W / 2));
    this.halfH = Math.max(1, Math.round(H / 2));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.chromaHasPrev = false;
    this.rebuildPingPong();
  }

  destroy(): void {
    const gl = this.gl;
    if (gl) {
      try {
        if (this.fboA) gl.deleteFramebuffer(this.fboA);
        if (this.fboB) gl.deleteFramebuffer(this.fboB);
        if (this.texA) gl.deleteTexture(this.texA);
        if (this.texB) gl.deleteTexture(this.texB);
        if (this.frameTex) gl.deleteTexture(this.frameTex);
        if (this.maskTex) gl.deleteTexture(this.maskTex);
        if (this.bgTex) gl.deleteTexture(this.bgTex);
        if (this.refinedMaskTex) gl.deleteTexture(this.refinedMaskTex);
        if (this.chromaScratchTex) gl.deleteTexture(this.chromaScratchTex);
        if (this.chromaPrevTex) gl.deleteTexture(this.chromaPrevTex);
        if (this.jbfFbo) gl.deleteFramebuffer(this.jbfFbo);
        if (this.blurH) gl.deleteProgram(this.blurH);
        if (this.blurV) gl.deleteProgram(this.blurV);
        if (this.composite) gl.deleteProgram(this.composite);
        if (this.jbf) gl.deleteProgram(this.jbf);
        if (this.chromaMask) gl.deleteProgram(this.chromaMask);
        if (this.chromaMorph) gl.deleteProgram(this.chromaMorph);
        if (this.chromaEma) gl.deleteProgram(this.chromaEma);
        if (this.quad) gl.deleteBuffer(this.quad);
        if (this.vao) gl.deleteVertexArray(this.vao);
      } catch { /* teardown best-effort */ }
    }
    this.gl = null;
    this.canvas = null;
    this.vao = null;
    this.quad = null;
    this.blurH = this.blurV = this.composite = this.jbf = this.chromaMask = null;
    this.chromaMorph = this.chromaEma = null;
    this.frameTex = this.maskTex = this.bgTex = this.refinedMaskTex = null;
    this.chromaScratchTex = this.chromaPrevTex = null;
    this.jbfFbo = null;
    this.fboA = this.fboB = null;
    this.texA = this.texB = null;
    this.w = this.h = this.halfW = this.halfH = 0;
    this.maskW = this.maskH = 0;
    this.maskBuf = null;
    this.readyFlag = false;
    this.jbfLive = false;
    this.chromaHasPrev = false;
  }

  /**
   * Upload person alpha (0..255). If polarityInvert, flip so GPU always sees
   * person = 1. Inverts once on CPU into a reused buffer.
   */
  setMask(
    alphaUint8: ArrayLike<number>,
    mw: number,
    mh: number,
    polarityInvert: boolean,
  ): void {
    const gl = this.gl;
    if (!gl || !this.maskTex) return;
    const W = Math.max(1, Math.round(Number(mw) || 1));
    const H = Math.max(1, Math.round(Number(mh) || 1));
    const n = W * H;
    if (!this.maskBuf || this.maskBuf.length !== n || this.maskW !== W || this.maskH !== H) {
      this.maskBuf = new Uint8Array(n);
      this.maskW = W;
      this.maskH = H;
    }
    const dst = this.maskBuf;
    const invert = !!polarityInvert;
    const len = Math.min(n, alphaUint8.length);
    if (invert) {
      for (let i = 0; i < len; i++) dst[i] = 255 - (alphaUint8[i] as number);
    } else {
      for (let i = 0; i < len; i++) dst[i] = alphaUint8[i] as number;
    }
    for (let i = len; i < n; i++) dst[i] = 0;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, W, H, 0,
      gl.RED, gl.UNSIGNED_BYTE, dst,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Blur background (weighted) + composite sharp person. Returns false on failure. */
  drawBlur(frame: CanvasImageSource, blurPx: number): boolean {
    if (!this.isReady || !this.gl || !this.canvas) return false;
    if (this.w < 1 || this.h < 1) return false;
    try {
      this.uploadFrame(frame);
      this.runJbf();
      this.runBlurPasses(Math.max(1, Number(blurPx) || 1));
      this.runComposite(/* virtual */ false, null, LIGHT_WRAP_BLUR);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Virtual image/video background + sharp person.
   * softEdge: 0..1 light-wrap strength at the matte boundary.
   */
  drawImageBg(
    frame: CanvasImageSource,
    bg: CanvasImageSource,
    softEdge: number = 0,
  ): boolean {
    if (!this.isReady || !this.gl || !this.canvas) return false;
    if (this.w < 1 || this.h < 1) return false;
    try {
      this.uploadFrame(frame);
      this.uploadBg(bg);
      this.runJbf();
      this.runComposite(/* virtual */ true, bg, softEdge);
      return true;
    } catch {
      return false;
    }
  }


  /**
   * Green-screen Reliable: chroma-key mask from camera RGB → sharp person over
   * a chosen virtual plate (image/video) or a neutral dark-gray studio when
   * none is set. NEVER blur the camera as the plate (green cloth stays olive).
   * softEdge matches drawImageBg (image path uses 0). Skips MediaPipe / JBF.
   */
  drawChroma(frame: CanvasImageSource, bg: CanvasImageSource | null, softEdge: number = 0): boolean {
    if (!this.isReady || !this.gl || !this.canvas || !this.chromaMask) return false;
    if (this.w < 1 || this.h < 1) return false;
    try {
      this.uploadFrame(frame);
      if (!this.runChromaMask()) return false;
      // runChromaMask sets jbfLive so activePersonMask() uses the chroma matte.
      if (bg) {
        this.uploadBg(bg);
        this.runComposite(/* virtual */ true, bg, softEdge);
      } else {
        this.uploadSolidBg(0x1c, 0x1f, 0x26);
        this.runComposite(/* virtual */ true, null, 0);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Write person alpha (1 = not green) into refinedMaskTex at full frame size.
   *  Pipeline: raw key → morphological close (fill holes) → light open (kill
   *  sparkles) → temporal EMA with previous matte. */
  private runChromaMask(): boolean {
    const gl = this.gl;
    if (!gl || !this.chromaMask || !this.maskTex || !this.frameTex) return false;
    const W = this.w, H = this.h;
    if (!this.refinedMaskTex || !this.jbfFbo) return false;

    this.allocFullMask(this.refinedMaskTex, W, H);
    if (this.chromaScratchTex) this.allocFullMask(this.chromaScratchTex, W, H);
    if (this.chromaPrevTex) this.allocFullMask(this.chromaPrevTex, W, H);

    // 1) Raw chroma key → refinedMaskTex
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.jbfFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.refinedMaskTex, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.chromaMask);
    const locFrame = gl.getUniformLocation(this.chromaMask, "u_frame");
    const locFlip = gl.getUniformLocation(this.chromaMask, "u_flipY");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(locFrame, 0);
    gl.uniform1f(locFlip, 0);
    this.drawQuad();

    // 2) Close then open (SE ~2px) when morph program + scratch are available.
    if (this.chromaMorph && this.chromaScratchTex) {
      const R = CHROMA_MORPH_RADIUS;
      // close: dilate → erode
      this.runChromaMorph(this.refinedMaskTex, this.chromaScratchTex, R, /* dilate */ 0);
      this.runChromaMorph(this.chromaScratchTex, this.refinedMaskTex, R, /* erode */ 1);
      // open: erode → dilate (slightly lighter SE keeps person edges)
      const openR = Math.max(1, R - 0.5);
      this.runChromaMorph(this.refinedMaskTex, this.chromaScratchTex, openR, /* erode */ 1);
      this.runChromaMorph(this.chromaScratchTex, this.refinedMaskTex, openR, /* dilate */ 0);
    }

    // 3) Temporal EMA with previous matte → scratch, then identity-copy to refined+prev.
    if (this.chromaEma && this.chromaScratchTex && this.chromaPrevTex) {
      this.runChromaEmaPass(
        this.refinedMaskTex,
        this.chromaPrevTex,
        this.chromaScratchTex,
        CHROMA_MASK_EMA,
        this.chromaHasPrev,
      );
      // Identity copy (hasPrev=0) into refined (composite samples this) and prev.
      this.runChromaEmaPass(this.chromaScratchTex, this.chromaScratchTex, this.refinedMaskTex, 0, false);
      this.runChromaEmaPass(this.chromaScratchTex, this.chromaScratchTex, this.chromaPrevTex, 0, false);
      this.chromaHasPrev = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.jbfLive = true;
    return true;
  }

  /** Allocate / resize a full-frame RGBA8 mask texture. */
  private allocFullMask(tex: WebGLTexture, W: number, H: number): void {
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** One morph pass: sample src into dst FBO (dilate mode=0 / erode mode=1). */
  private runChromaMorph(
    src: WebGLTexture,
    dst: WebGLTexture,
    radius: number,
    mode: number,
  ): void {
    const gl = this.gl!;
    if (!this.chromaMorph || !this.jbfFbo) return;
    const W = this.w, H = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.jbfFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.chromaMorph);
    const locMask = gl.getUniformLocation(this.chromaMorph, "u_mask");
    const locTexel = gl.getUniformLocation(this.chromaMorph, "u_texel");
    const locR = gl.getUniformLocation(this.chromaMorph, "u_radius");
    const locMode = gl.getUniformLocation(this.chromaMorph, "u_mode");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(locMask, 0);
    gl.uniform2f(locTexel, 1 / Math.max(1, W), 1 / Math.max(1, H));
    // Shader clamps radius to [1,3]; for identity copy use mode dilate with
    // a tiny radius still samples neighbors — prefer EMA copy path instead.
    gl.uniform1f(locR, Math.max(1, radius));
    gl.uniform1f(locMode, mode);
    this.drawQuad();
  }

  /** EMA (or identity when hasPrev=false / mix=0) from curr[/prev] into dst. */
  private runChromaEmaPass(
    curr: WebGLTexture,
    prev: WebGLTexture,
    dst: WebGLTexture,
    mix: number,
    hasPrev: boolean,
  ): void {
    const gl = this.gl!;
    if (!this.chromaEma || !this.jbfFbo) return;
    const W = this.w, H = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.jbfFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.chromaEma);
    const locCurr = gl.getUniformLocation(this.chromaEma, "u_curr");
    const locPrev = gl.getUniformLocation(this.chromaEma, "u_prev");
    const locMix = gl.getUniformLocation(this.chromaEma, "u_mix");
    const locHas = gl.getUniformLocation(this.chromaEma, "u_hasPrev");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, curr);
    gl.uniform1i(locCurr, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev);
    gl.uniform1i(locPrev, 1);
    gl.uniform1f(locMix, mix);
    gl.uniform1f(locHas, hasPrev ? 1 : 0);
    this.drawQuad();
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Prefer refined matte when JBF succeeded this frame; else raw maskTex. */
  private activePersonMask(): WebGLTexture {
    return (this.jbfLive && this.refinedMaskTex) ? this.refinedMaskTex! : this.maskTex!;
  }

  /**
   * Meet-style joint bilateral refine: guided by full-res RGB luminance,
   * write refined mask into refinedMaskTex FBO. No-op if JBF program missing.
   */
  private runJbf(): void {
    const gl = this.gl;
    this.jbfLive = false;
    if (!gl || !this.jbf || !this.refinedMaskTex || !this.jbfFbo || !this.maskTex || !this.frameTex) return;
    if (this.w < 1 || this.h < 1) return;
    const W = this.w, H = this.h;

    gl.bindTexture(gl.TEXTURE_2D, this.refinedMaskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.jbfFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.refinedMaskTex, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.jbf);

    const locMask = gl.getUniformLocation(this.jbf, "u_mask");
    const locGuide = gl.getUniformLocation(this.jbf, "u_guide");
    const locTexel = gl.getUniformLocation(this.jbf, "u_texel");
    const locR = gl.getUniformLocation(this.jbf, "u_radius");
    const locSS = gl.getUniformLocation(this.jbf, "u_sigmaSpace");
    const locSR = gl.getUniformLocation(this.jbf, "u_sigmaRange");

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(locMask, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(locGuide, 1);

    gl.uniform2f(locTexel, 1 / Math.max(1, W), 1 / Math.max(1, H));
    gl.uniform1f(locR, JBF_RADIUS);
    gl.uniform1f(locSS, JBF_SIGMA_SPACE);
    gl.uniform1f(locSR, JBF_SIGMA_RANGE);

    this.drawQuad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.jbfLive = true;
  }


  private createTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const t = gl.createTexture();
    if (!t) return null;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private rebuildPingPong(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.fboA) gl.deleteFramebuffer(this.fboA);
    if (this.fboB) gl.deleteFramebuffer(this.fboB);
    if (this.texA) gl.deleteTexture(this.texA);
    if (this.texB) gl.deleteTexture(this.texB);
    this.texA = this.createTexture();
    this.texB = this.createTexture();
    this.fboA = gl.createFramebuffer();
    this.fboB = gl.createFramebuffer();
    const hw = this.halfW, hh = this.halfH;
    for (const [tex, fbo] of [[this.texA, this.fboA], [this.texB, this.fboB]] as const) {
      if (!tex || !fbo) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, hw, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private uploadFrame(frame: CanvasImageSource): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    // texImage2D with CanvasImageSource / VideoFrame
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as any);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadBg(bg: CanvasImageSource): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg as any);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** 1×1 solid into bgTex for chroma with no BG file (neutral studio plate). */
  private uploadSolidBg(r: number, g: number, b: number): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([r & 255, g & 255, b & 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private drawQuad(): void {
    const gl = this.gl!;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private runBlurPasses(blurPx: number): void {
    const gl = this.gl!;
    const hw = this.halfW, hh = this.halfH;
    // Radius at half-res: scale so visual blur matches full-res intent.
    const radius = Math.max(1, blurPx * (hw / Math.max(1, this.w)));

    // Pass H: frame (full) -> FBO A (half). Sample mask at same UV.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, hw, hh);
    gl.useProgram(this.blurH);
    this.bindBlurUniforms(this.blurH!, this.frameTex!, 1 / Math.max(1, this.w), 0, radius);
    this.drawQuad();

    // Pass V: texA -> FBO B
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.viewport(0, 0, hw, hh);
    gl.useProgram(this.blurV);
    this.bindBlurUniforms(this.blurV!, this.texA!, 0, 1 / hh, radius);
    // After H, mask weighting still applies on V using original mask.
    this.drawQuad();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private bindBlurUniforms(
    prog: WebGLProgram,
    src: WebGLTexture,
    texelX: number,
    texelY: number,
    radius: number,
  ): void {
    const gl = this.gl!;
    const locFrame = gl.getUniformLocation(prog, "u_frame");
    const locMask = gl.getUniformLocation(prog, "u_mask");
    const locTexel = gl.getUniformLocation(prog, "u_texel");
    const locMaskTexel = gl.getUniformLocation(prog, "u_maskTexel");
    const locRadius = gl.getUniformLocation(prog, "u_radius");

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(locFrame, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.activePersonMask());
    gl.uniform1i(locMask, 1);

    gl.uniform2f(locTexel, texelX, texelY);
    gl.uniform2f(locMaskTexel, 1 / Math.max(1, this.w), 1 / Math.max(1, this.h));
    gl.uniform1f(locRadius, radius);
  }

  private runComposite(
    virtual: boolean,
    bgSrc: CanvasImageSource | null,
    softEdge: number,
  ): void {
    const gl = this.gl!;
    const W = this.w, H = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.composite);

    const locSharp = gl.getUniformLocation(this.composite!, "u_sharp");
    const locBg = gl.getUniformLocation(this.composite!, "u_bg");
    const locMask = gl.getUniformLocation(this.composite!, "u_mask");
    const locUse = gl.getUniformLocation(this.composite!, "u_useVirtual");
    const locCover = gl.getUniformLocation(this.composite!, "u_cover");
    const locSoft = gl.getUniformLocation(this.composite!, "u_softEdge");
    const locFlip = gl.getUniformLocation(this.composite!, "u_flipY");
    const locTexel = gl.getUniformLocation(this.composite!, "u_texel");

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(locSharp, 0);

    gl.activeTexture(gl.TEXTURE1);
    if (virtual) {
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.texB);
    }
    gl.uniform1i(locBg, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.activePersonMask());
    gl.uniform1i(locMask, 2);

    gl.uniform1f(locUse, virtual ? 1 : 0);
    gl.uniform1f(locSoft, Math.max(0, Math.min(1, Number(softEdge) || 0)));
    gl.uniform1f(locFlip, 0);
    gl.uniform2f(locTexel, 1 / Math.max(1, W), 1 / Math.max(1, H));

    if (virtual && bgSrc) {
      const iw = Number((bgSrc as any).videoWidth || (bgSrc as any).width || W) || W;
      const ih = Number((bgSrc as any).videoHeight || (bgSrc as any).height || H) || H;
      const c = coverUv(iw, ih, W, H);
      gl.uniform4f(locCover, c.sx, c.sy, c.sw, c.sh);
    } else {
      gl.uniform4f(locCover, 0, 0, 1, 1);
    }

    this.drawQuad();
  }
}
