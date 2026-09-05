/**
 * WebGL2 Meet-style background compositor — file/source guards.
 * Run: node lib/qbg-gl.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  webglCompositeReady,
} from "./effects.ts";
import {
  VERT_SRC, FRAG_BLUR_H, FRAG_BLUR_V, FRAG_COMPOSITE, FRAG_JBF, FRAG_CHROMA_MASK,
  FRAG_CHROMA_MORPH, FRAG_CHROMA_EMA,
  JBF_RADIUS, JBF_SIGMA_SPACE, JBF_SIGMA_RANGE, LIGHT_WRAP_BLUR,
  CHROMA_MASK_EMA, CHROMA_MORPH_RADIUS, DARK_FRINGE_MIX, coverUv,
} from "./qbg-gl.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const glSrc = readFileSync(new URL("./qbg-gl.ts", import.meta.url), "utf8");
const qbg = readFileSync(new URL("./qbg.ts", import.meta.url), "utf8");
const effects = readFileSync(new URL("./effects.ts", import.meta.url), "utf8");

// No getImageData in the GL hot path
{
  const code = glSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok(!/\.getImageData\s*\(/.test(code), "qbg-gl has ZERO getImageData");
}

// Shader sources: weighted blur + mix composite
ok(typeof VERT_SRC === "string" && VERT_SRC.includes("a_pos"), "VERT_SRC exported");
ok(!/1\.0 - p\.y/.test(VERT_SRC),
  "vertex UV must NOT Y-flip (upright is 2d blit only; vertex flip broke FBO)");
ok(/smoothstep\s*\(\s*0\.15\s*,\s*0\.45\s*,\s*m\)/.test(FRAG_BLUR_H) && /room/.test(FRAG_BLUR_H),
  "blur H weights samples by hard room smoothstep exclusion");
ok(/smoothstep\s*\(\s*0\.15\s*,\s*0\.45\s*,\s*m\)/.test(FRAG_BLUR_V) && /room/.test(FRAG_BLUR_V),
  "blur V weights samples by hard room smoothstep exclusion");
ok(/wsum/.test(FRAG_BLUR_H) && /wsum/.test(FRAG_BLUR_V),
  "blur frags renormalize by weight sum");
ok(/wsum > 1e-3/.test(FRAG_BLUR_H) && /wsum > 1e-3/.test(FRAG_BLUR_V),
  "blur H/V renormalize when wsum > 1e-3");
ok(/mix\(vec4\(0\.15,\s*0\.15,\s*0\.16/.test(FRAG_BLUR_H) && /mix\(vec4\(0\.15,\s*0\.15,\s*0\.16/.test(FRAG_BLUR_V),
  "blur H/V low-wsum uses neutral/far room fill — never sharp FG");
ok(!/outColor = texture\(u_frame,\s*v_uv\);/.test(FRAG_BLUR_H) && !/outColor = texture\(u_frame,\s*v_uv\);/.test(FRAG_BLUR_V),
  "blur shaders have no sharp-frame fallback (Meet-safe plate)");
ok(FRAG_COMPOSITE.includes("mix(") && /mix\s*\(\s*bg/.test(FRAG_COMPOSITE),
  "composite frag mixes bg and sharp by person alpha");
ok(/smoothstep\s*\(\s*0\.35\s*,\s*0\.55/.test(FRAG_COMPOSITE),
  "blur-path composite uses softer smoothstep(0.35, 0.55, mask)");
ok(/u_useVirtual\s*>\s*0\.5[\s\S]{0,80}smoothstep\s*\(\s*0\.52\s*,\s*0\.68/.test(FRAG_COMPOSITE),
  "virtual/chroma composite keeps tighter smoothstep(0.52, 0.68, mask)");
ok(/sampleMaskEroded/.test(FRAG_COMPOSITE) && /sampleMaskEroded/.test(FRAG_BLUR_H) && /sampleMaskEroded/.test(FRAG_BLUR_V),
  "composite + blur frags use sampleMaskEroded (1-texel min of 4-neigh)");
ok(!/greenSpill/.test(FRAG_COMPOSITE) && !/greenExcess/.test(FRAG_COMPOSITE),
  "composite has no plant greenSpill (fought real greens)");
ok(/u_useVirtual\s*>\s*0\.5\)\s*\?\s*0\.0/.test(FRAG_COMPOSITE) || /wrap = \(u_useVirtual > 0\.5\) \? 0\.0/.test(FRAG_COMPOSITE),
  "composite zeros softEdge wrap when virtual");

// Class API surface
ok(/class QbgGl/.test(glSrc) && /init\(/.test(glSrc) && /resize\(/.test(glSrc) && /destroy\(/.test(glSrc),
  "QbgGl exposes init/resize/destroy");
ok(/setMask\(/.test(glSrc) && /polarityInvert/.test(glSrc),
  "setMask accepts polarityInvert so GPU always sees person=1");
ok(/drawBlur\(/.test(glSrc) && /drawImageBg\(/.test(glSrc),
  "QbgGl exposes drawBlur and drawImageBg");
ok(/createFramebuffer|fboA|ping/.test(glSrc) && /halfW|half/.test(glSrc),
  "FBO ping-pong blur at half res");

// Cover UV helper
{
  const wide = coverUv(1920, 1080, 1280, 720); // same AR
  ok(Math.abs(wide.sw - 1) < 1e-6 && Math.abs(wide.sh - 1) < 1e-6, "cover same-AR uses full texture");
  const taller = coverUv(100, 200, 200, 100); // portrait into landscape → crop height
  ok(taller.sw === 1 && taller.sh < 1, "cover crops the excess axis");
}

// webglCompositeReady probe
ok(webglCompositeReady({ webgl2: true }) === true, "webglCompositeReady({webgl2:true})");
ok(webglCompositeReady({ webgl2: false }) === false, "webglCompositeReady({webgl2:false})");
ok(/export function webglCompositeReady/.test(effects), "effects exports webglCompositeReady");

// qbg wires GL with 2d blit fallback
ok(/from "\.\/qbg-gl"/.test(qbg) && /new QbgGl/.test(qbg), "qbg constructs QbgGl");
ok(/webglCompositeReady\(/.test(qbg), "qbg gates GL on webglCompositeReady");
ok(/drawImage\(this\.gl\.surface/.test(qbg) || /drawImage\(this\.gl\.surface as any/.test(qbg),
  "qbg blits GL surface into 2d output canvas once per frame");
ok(/setTransform\(1,\s*0,\s*0,\s*-1,\s*0,\s*H[i]?\)/.test(qbg) || (/translate\(0,\s*H\)/.test(qbg) && /scale\(1,\s*-1\)/.test(qbg)),
  "qbg blit flips Y with setTransform (or translate+scale) (not vertex UV)");
ok(/drawBlur\(/.test(qbg) && /drawImageBg\(/.test(qbg),
  "paintMasked calls GL drawBlur / drawImageBg");
ok(/Fall through to canvas2d|canvas2d fallback/.test(qbg),
  "GL failure falls through to canvas2d — no hard crash");

ok(/softEdge:\s*number\s*=\s*0[,\)]/.test(glSrc),
  "drawImageBg softEdge default is 0 (no virtual wrap glow)");
ok(/wsum > 1e-3/.test(FRAG_BLUR_H) && /sampleMaskEroded\(v_uv \+ vec2\(u_texel\.x, u_texel\.y\) \* u_radius\)/.test(FRAG_BLUR_H),
  "blur low-wsum samples far tap with room weight — not sharp center");


// Meet-style JBF + landscape + blit overscan
ok(typeof FRAG_JBF === "string" && /u_guide/.test(FRAG_JBF) && /u_mask/.test(FRAG_JBF),
  "FRAG_JBF exported with mask+guide uniforms");
ok(/sigmaSpace|u_sigmaSpace/.test(FRAG_JBF) && /u_sigmaRange/.test(FRAG_JBF),
  "FRAG_JBF has spatial and range sigma uniforms");
ok(JBF_RADIUS >= 4 && JBF_RADIUS <= 6, "JBF_RADIUS in Meet-like 4..6");
ok(JBF_SIGMA_SPACE >= 2 && JBF_SIGMA_SPACE <= 3, "JBF_SIGMA_SPACE ~2..3");
ok(JBF_SIGMA_RANGE >= 0.08 && JBF_SIGMA_RANGE <= 0.12, "JBF_SIGMA_RANGE ~0.08..0.12");
ok(/runJbf\(/.test(glSrc) && /refinedMaskTex/.test(glSrc),
  "pipeline has runJbf and refinedMaskTex");
ok(/drawBlur[\s\S]*runJbf|runJbf[\s\S]*runBlurPasses/.test(glSrc.replace(/\n/g, " ")),
  "drawBlur calls runJbf before blur passes");
ok(/selfie_segmenter_landscape/.test(qbg), "qbg source uses landscape model path");
ok(/Hi \+ 2|0,\s*-1,\s*Wi,\s*Hi/.test(qbg) || /drawImage\([\s\S]*0,\s*-1/.test(qbg),
  "qbg blit overscan present for cyan seam");
ok(/joint bilateral|Joint bilateral/i.test(glSrc),
  "comment cites joint bilateral / Meet edge refine");



// v3: stronger fringe decontam + mild JBF shrink bias
ok(/darkFringe/.test(FRAG_COMPOSITE) && /midLuma/.test(FRAG_COMPOSITE),
  "composite darkFringe gated by midLuma (skip near-black caps)");
ok(typeof DARK_FRINGE_MIX === "number" && DARK_FRINGE_MIX >= 0.25 && DARK_FRINGE_MIX <= 0.4,
  "DARK_FRINGE_MIX mild for navy-cap fringe");
ok(/darkFringe \* 0\.32/.test(FRAG_COMPOSITE),
  "composite uses reduced darkFringe mix (~0.32)");
ok(/nMin/.test(FRAG_JBF) && /outM > centerM/.test(FRAG_JBF),
  "JBF has mild shrink bias when filter would expand matte");
ok(!/lateralPersonGate\(this\.smooth/.test(qbg) && !/torsoGateMask\(this\.smooth/.test(qbg),
  "qbg does not wire lateralPersonGate or torsoGateMask");

// edge spill hotfix: erode + green fringe
ok(/darkFringe/.test(FRAG_COMPOSITE) && /colorSpill/.test(FRAG_COMPOSITE),
  "composite keeps darkFringe and colorSpill (no plant greenSpill)");
ok(/drawImageBg\(frame as any, src, 0\)/.test(qbg),
  "qbg passes softEdge 0 on image path");

// PR2: plant greenSpill removed; virtual 8-neigh erode kept
ok(!/greenSpill\s*>\s*0\.55/.test(FRAG_COMPOSITE),
  "composite does not force a=0 on greenSpill");
ok(!/a = a \* \(1\.0 - greenSpill\)/.test(FRAG_COMPOSITE),
  "composite does not multiply alpha by greenSpill");
ok(typeof LIGHT_WRAP_BLUR === "number" && LIGHT_WRAP_BLUR >= 0.15 && LIGHT_WRAP_BLUR <= 0.25,
  "LIGHT_WRAP_BLUR exported ~0.2 (less edge darkening on blur)");
ok(/runComposite\([\s\S]*LIGHT_WRAP_BLUR\)/.test(glSrc) || /runComposite\(\/\* virtual \*\/ false, null, LIGHT_WRAP_BLUR\)/.test(glSrc),
  "drawBlur passes LIGHT_WRAP_BLUR softEdge");
ok(/u_useVirtual > 0\.5/.test(FRAG_COMPOSITE) && /u_texel\.x, u_texel\.y/.test(FRAG_COMPOSITE),
  "composite sampleMaskEroded adds diagonal neighbors when virtual");
ok(!/suppressCrownProtrusions\(this\.smooth/.test(qbg) && !/torsoGateMask\(this\.smooth/.test(qbg),
  "qbg does NOT call suppressCrownProtrusions; still no torsoGate");


ok(!/FaceDetector/.test(qbg) && !/applyFaceHullMask\(this\.smooth/.test(qbg) && !/blaze_face/.test(qbg),
  "qbg does NOT wire FaceDetector / applyFaceHullMask / blaze_face");
ok((qbg.match(/keepCenterPersonIsland\(this\.smooth/g) || []).length === 1,
  "qbg calls keepCenterPersonIsland exactly once");
ok(/hardenPersonMatte\(this\.smooth[\s\S]*?openPersonMask\(this\.smooth[\s\S]*?keepCenterPersonIsland\(this\.smooth/.test(qbg),
  "qbg order: harden → open → island");
ok(!/lateralPersonGate\(this\.smooth/.test(qbg) && !/despecklePersonMask\(this\.smooth/.test(qbg) && !/suppressLeafLeaks\(this\.smooth/.test(qbg),
  "qbg does not wire lateral / despeckle / leaf on live path");
ok(!/suppressDarkEdgeLeaks\(this\.smooth/.test(qbg),
  "qbg does NOT call suppressDarkEdgeLeaks");


// ── PR1: green screen Reliable (chroma) ──────────────────────────────────
ok(typeof FRAG_CHROMA_MASK === "string" && /greenDom|ycbcrKey|person|olive|greenAmt/.test(FRAG_CHROMA_MASK),
  "FRAG_CHROMA_MASK exported with green/olive key → person alpha");
ok(/olive/.test(FRAG_CHROMA_MASK) && /greenAmt/.test(FRAG_CHROMA_MASK),
  "chroma key allows olive/yellow-green (g-r and g-b both positive)");
ok(/smoothstep\s*\(\s*0\.02\s*,\s*0\.14/.test(FRAG_CHROMA_MASK),
  "chroma greenAmt thresholds widened (0.02..0.14)");
ok(/smoothstep\s*\(\s*0\.08\s*,\s*0\.28/.test(FRAG_CHROMA_MASK),
  "chroma sat thresholds widened (0.08..0.28)");
ok(/drawChroma\(/.test(glSrc) && /runChromaMask\(/.test(glSrc),
  "QbgGl exposes drawChroma / runChromaMask");
ok(/opts\.kind === ["']chroma["']/.test(qbg) && /paintChroma\(/.test(qbg),
  "qbg paints chroma path when kind is chroma");
ok(/skipSeg|kind !== ["']chroma["']|kind === ["']chroma["']/.test(qbg) && !/ImageSegmenter\.createFromOptions[\s\S]{0,200}chroma/.test(qbg),
  "qbg skips MediaPipe segment stack for chroma");
ok(/drawChroma\(frame as any/.test(qbg) || /this\.gl\.drawChroma/.test(qbg),
  "paintChroma calls GL drawChroma");
ok(/drawChroma\(frame: CanvasImageSource, bg:/.test(glSrc) && !/drawChroma\(frame: CanvasImageSource, blurPx/.test(glSrc),
  "drawChroma takes bg source (not blurPx) — paint plate, not blur-of-green");
ok(/uploadSolidBg\(/.test(glSrc) && /0x1c,\s*0x1f,\s*0x26/.test(glSrc),
  "chroma with no BG file uses neutral dark-gray studio plate");
ok(!/drawChroma[\s\S]{0,400}runBlurPasses/.test(glSrc),
  "drawChroma does not runBlurPasses on the camera frame");
ok(/runComposite\(\/\* virtual \*\/ true/.test(glSrc),
  "drawChroma composites virtual plate over chroma matte");
ok(/bgSrc|this\.bgVideo|this\.bg \|\| null/.test(qbg) && /drawChroma\(frame as any, bgSrc/.test(qbg),
  "paintChroma passes loaded bg/video (or null) to drawChroma");
ok(/#1c1f26/.test(qbg) && !/paintChromaCanvas2d[\s\S]{0,800}this\.blurred\(frame/.test(qbg),
  "canvas2d chroma fallback paints gray/image — never blur(frame)");
ok(!/face-hull|suppressDarkEdgeLeaks\(this\.smooth/.test(qbg),
  "PR1 does not reintroduce face-hull / dark-edge heuristics on live path");

// ── Chroma harden: morph close/open + EMA + spill ─────────────────────────
ok(typeof FRAG_CHROMA_MORPH === "string" && /u_mode/.test(FRAG_CHROMA_MORPH) && /u_radius/.test(FRAG_CHROMA_MORPH),
  "FRAG_CHROMA_MORPH dilate/erode with small SE");
ok(typeof FRAG_CHROMA_EMA === "string" && /u_mix/.test(FRAG_CHROMA_EMA) && /u_hasPrev/.test(FRAG_CHROMA_EMA),
  "FRAG_CHROMA_EMA temporal mix with previous matte");
ok(typeof CHROMA_MASK_EMA === "number" && CHROMA_MASK_EMA >= 0.6 && CHROMA_MASK_EMA <= 0.75,
  "CHROMA_MASK_EMA in 0.6..0.75");
ok(typeof CHROMA_MORPH_RADIUS === "number" && CHROMA_MORPH_RADIUS >= 2 && CHROMA_MORPH_RADIUS <= 3,
  "CHROMA_MORPH_RADIUS small SE 2..3px");
ok(/runChromaMorph\(/.test(glSrc) && /close|dilate/.test(glSrc) && /CHROMA_MORPH_RADIUS/.test(glSrc),
  "runChromaMask applies morphological close then open");
ok(/runChromaEmaPass\(/.test(glSrc) && /CHROMA_MASK_EMA/.test(glSrc) && /chromaHasPrev/.test(glSrc),
  "runChromaMask applies temporal EMA on chroma matte");
ok(/Despeckle|false-FG cloth flecks/.test(glSrc) && /runChromaMorph\([\s\S]*2\.5[\s\S]*\/\* erode \*\/ 1\)/.test(glSrc) && /runChromaMorph\([\s\S]*1\.5[\s\S]*\/\* dilate \*\/ 0\)/.test(glSrc),
  "runChromaMask despeckles after EMA (erode then light dilate)");
ok(/chromaSpill/.test(FRAG_COMPOSITE) && /despillG/.test(FRAG_COMPOSITE),
  "composite has classic chromaSpill despill toward BG (not plant greenSpill)");
ok(!/greenSpill/.test(FRAG_COMPOSITE) && !/a = a \* \(1\.0 - greenSpill\)/.test(FRAG_COMPOSITE),
  "chromaSpill does not reintroduce plant alpha-kill greenSpill");
ok(/midLuma/.test(FRAG_COMPOSITE) && /smoothstep\s*\(\s*0\.10\s*,\s*0\.28\s*,\s*sharpL\)/.test(FRAG_COMPOSITE),
  "darkFringe midLuma gate protects navy/near-black clothing");
ok(!/suppressLeafLeaks|lateralPersonGate|suppressCrownProtrusions/.test(glSrc),
  "GL path does not reintroduce plant/lateral/leaf heuristics");
ok(/olive|greenAmt/.test(qbg) && /morph\(morph\(alpha/.test(qbg),
  "canvas2d chroma fallback widens green + morph close/open");


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
