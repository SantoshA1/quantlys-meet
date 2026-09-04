/**
 * WebGL2 Meet-style background compositor — file/source guards.
 * Run: node lib/qbg-gl.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  webglCompositeReady,
} from "./effects.ts";
import {
  VERT_SRC, FRAG_BLUR_H, FRAG_BLUR_V, FRAG_COMPOSITE, FRAG_JBF,
  JBF_RADIUS, JBF_SIGMA_SPACE, JBF_SIGMA_RANGE, coverUv,
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
  "blur H/V fallback when wsum > 1e-3 else sample frame (no black holes)");
ok(FRAG_COMPOSITE.includes("mix(") && /mix\s*\(\s*bg/.test(FRAG_COMPOSITE),
  "composite frag mixes bg and sharp by person alpha");
ok(/smoothstep\s*\(\s*0\.52\s*,\s*0\.68/.test(FRAG_COMPOSITE),
  "composite pulls matte inward with smoothstep(0.52, 0.68, mask)");
ok(/sampleMaskEroded/.test(FRAG_COMPOSITE) && /sampleMaskEroded/.test(FRAG_BLUR_H) && /sampleMaskEroded/.test(FRAG_BLUR_V),
  "composite + blur frags use sampleMaskEroded (1-texel min of 4-neigh)");
ok(/greenSpill/.test(FRAG_COMPOSITE) && /greenExcess/.test(FRAG_COMPOSITE),
  "composite has Meet-style greenSpill chroma suppression");
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
ok(/wsum > 1e-3/.test(FRAG_BLUR_H) && /texture\(u_frame,\s*v_uv\)/.test(FRAG_BLUR_H),
  "blur keeps wsum fallback to sharp frame sample");


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
ok(/darkFringe/.test(FRAG_COMPOSITE) && /0\.55/.test(FRAG_COMPOSITE),
  "composite strengthens dark-fringe decontam mix toward bg");
ok(/nMin/.test(FRAG_JBF) && /outM > centerM/.test(FRAG_JBF),
  "JBF has mild shrink bias when filter would expand matte");
ok(/lateralPersonGate/.test(qbg) && !/torsoGateMask\(this\.smooth/.test(qbg),
  "qbg wires lateralPersonGate and not torsoGateMask");

// edge spill hotfix: erode + green fringe
ok(/darkFringe/.test(FRAG_COMPOSITE) && /greenSpill/.test(FRAG_COMPOSITE),
  "composite keeps darkFringe and adds greenSpill");
ok(/drawImageBg\(frame as any, src, 0\)/.test(qbg),
  "qbg passes softEdge 0 on image path");

// cap-crown leaf: stronger greenSpill + virtual 8-neigh erode
ok(/smoothstep\s*\(\s*0\.01\s*,\s*0\.08/.test(FRAG_COMPOSITE),
  "composite greenSpill uses smoothstep(0.01, 0.08, ...)");
ok(/min\(sharp\.g - sharp\.r,\s*sharp\.g - sharp\.b\)/.test(FRAG_COMPOSITE),
  "composite catches yellow-green via min(g-r, g-b)");
ok(/a = a \* \(1\.0 - greenSpill\)/.test(FRAG_COMPOSITE),
  "composite multiplies alpha by (1 - greenSpill) fully");
ok(/greenSpill > 0\.55/.test(FRAG_COMPOSITE) && /a = 0\.0/.test(FRAG_COMPOSITE),
  "composite forces a=0 when greenSpill clearly leaf");
ok(/u_useVirtual > 0\.5/.test(FRAG_COMPOSITE) && /u_texel\.x, u_texel\.y/.test(FRAG_COMPOSITE),
  "composite sampleMaskEroded adds diagonal neighbors when virtual");
ok(!/suppressCrownProtrusions\(this\.smooth/.test(qbg) && !/torsoGateMask\(this\.smooth/.test(qbg),
  "qbg does NOT call suppressCrownProtrusions; still no torsoGate");


ok(/FaceDetector/.test(qbg) && /applyFaceHullMask/.test(qbg) && /blaze_face/.test(qbg),
  "qbg FaceDetector / applyFaceHullMask / blaze_face wired");
ok(/applyFaceHullMask\(this\.smooth/.test(qbg), "qbg calls applyFaceHullMask on smooth mask");
ok(/applyFaceHullMask\(this\.smooth[\s\S]*?axes:\s*[\"']x[\"']/.test(qbg),
  "qbg applyFaceHullMask axes x only");

ok(/smallCanvas!\.width|ox \/ sw/.test(qbg) || /const sw = Math.max\(1, this\.smallCanvas/.test(qbg),
  "face hull normalizes with smallCanvas size (not mask mw)");
ok(/delegate:\s*[\"']CPU[\"']/.test(qbg),
  "FaceDetector falls back to CPU if GPU init fails");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
