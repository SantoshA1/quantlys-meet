/**
 * WebGL2 Meet-style background compositor — file/source guards.
 * Run: node lib/qbg-gl.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  webglCompositeReady,
} from "./effects.ts";
import {
  VERT_SRC, FRAG_BLUR_H, FRAG_BLUR_V, FRAG_COMPOSITE, coverUv,
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
ok(/1\.0 - p\.y/.test(VERT_SRC),
  "vertex UV flips Y so the 2d blit is upright (Blur upside-down bug)");
ok(FRAG_BLUR_H.includes("(1.0 - m)") || FRAG_BLUR_H.includes("(1.0 - personMask)"),
  "blur H weights samples by (1.0 - mask)");
ok(FRAG_BLUR_V.includes("(1.0 - m)") || FRAG_BLUR_V.includes("(1.0 - personMask)"),
  "blur V weights samples by (1.0 - mask)");
ok(/wsum/.test(FRAG_BLUR_H) && /wsum/.test(FRAG_BLUR_V),
  "blur frags renormalize by weight sum");
ok(FRAG_COMPOSITE.includes("mix(") && /mix\s*\(\s*bg/.test(FRAG_COMPOSITE),
  "composite frag mixes bg and sharp by person alpha");
ok(/smoothstep\s*\(\s*0\.45\s*,\s*0\.55/.test(FRAG_COMPOSITE),
  "composite hardens mask with smoothstep(0.45, 0.55, mask)");

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
ok(/drawBlur\(/.test(qbg) && /drawImageBg\(/.test(qbg),
  "paintMasked calls GL drawBlur / drawImageBg");
ok(/Fall through to canvas2d|canvas2d fallback/.test(qbg),
  "GL failure falls through to canvas2d — no hard crash");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
