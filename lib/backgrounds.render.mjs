/**
 * RENDER CHECK — "the backgrounds and the blur quality is really bad".
 *
 * FIELD 2026-08-24, two screenshots: a person with a smeared halo forty
 * pixels wide sitting in front of a drawn cartoon, and a blur with a dark
 * border around the whole frame.
 *
 * effects.test.mjs proves the DECISIONS. This proves the PICTURE, because
 * both of those complaints are claims about pixels and neither is visible in
 * a number until something renders it. Every measurement below runs the OLD
 * pipeline and the NEW one against the same synthetic scene, and the old one
 * must FAIL its own threshold — a check that cannot fail proves nothing.
 *
 * THE LESSON THIS FILE EXISTS TO KEEP (2026-08-24): the first probe for the
 * dark border measured LUMINANCE and found nothing — every channel came back
 * at exactly 128, and the fix looked unnecessary. The blur does not darken
 * the edge, it makes it TRANSPARENT: alpha 70 in the corner against 255 in
 * the middle, because the Gaussian averages in the nothing outside the source
 * rectangle. Colour survives; alpha does not. Measure the channel the bug is
 * actually in, or a real bug reads as a clean bill of health.
 *
 * Needs a browser: npm i -D playwright && npx playwright install chromium
 * Run: node lib/backgrounds.render.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import {
  BLUR_PX, overscanRect, bokehPass, confidenceToAlpha,
  maskBlurPx, ERODE_POWER,
} from "./effects.ts";

const CHROME = process.env.QM_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = process.env.QM_SHOTS || "";
const W = 640, H = 360;

// What shipped on 2026-08-20 and is being replaced.
const OLD = { maskBlur: 14, erode: 3, overscan: null, bokeh: null };

const html = `<!doctype html><html><body style="margin:0"><canvas id=c width=${W} height=${H}></canvas>
<script type="module">
window.RUN = async (cfg) => {
  const out = {};
  const c = document.getElementById("c");
  const d = c.getContext("2d", { willReadFrequently: true });
  const A = (x, y) => d.getImageData(x, y, 1, 1).data[3];
  const detail = (y) => detailIn(0, ${W}, y);
  // Windowed, because a full-width row across the face also crosses the
  // background — and the background is SUPPOSED to be blurred. The first
  // version of this check compared a face-plus-blurred-room row against a
  // face-plus-sharp-room row, called the difference "the face is not sharp",
  // and was measuring the feature working.
  const detailIn = (x0, x1, y) => { const r = d.getImageData(0, y, ${W}, 1).data; let v = 0;
    for (let x = x0 + 1; x < x1; x++) v += Math.abs(r[x*4] - r[(x-1)*4]); return v; };

  // ── the scene: a bright window, hard detail, and a person in the middle ──
  const scene = new OffscreenCanvas(${W}, ${H}), s = scene.getContext("2d");
  const paint = () => {
    const g = s.createLinearGradient(0, 0, ${W}, ${H});
    g.addColorStop(0, "#f6f2e8"); g.addColorStop(1, "#5c6470");
    s.fillStyle = g; s.fillRect(0, 0, ${W}, ${H});
    for (let i = 0; i < 64; i++) { s.fillStyle = i % 2 ? "#12161c" : "#e8e4da"; s.fillRect(i*10, 24, 5, 150); }
    for (let i = 0; i < 8; i++) { s.fillStyle = "hsl(" + (i*40) + " 55% 45%)"; s.fillRect(i*80, 232, 62, 84); }
    // The subject needs TEXTURE or the before/after proves nothing to a human:
    // a flat ellipse looks identical sharp and blurred, and the first version
    // of this harness shipped exactly that picture.
    s.save();
    s.beginPath(); s.ellipse(${W/2}, ${Math.round(H*0.72)}, 96, 128, 0, 0, 7); s.clip();
    s.fillStyle = "#7d4f3c"; s.fillRect(0, 0, ${W}, ${H});
    for (let i = 0; i < 30; i++) { s.fillStyle = i % 2 ? "#5e3a2c" : "#96604a"; s.fillRect(${W/2} - 96 + i*7, 0, 3, ${H}); }
    s.restore();
    s.save();
    s.beginPath(); s.ellipse(${W/2}, ${Math.round(H*0.44)}, 56, 68, 0, 0, 7); s.clip();
    s.fillStyle = "#c78f6b"; s.fillRect(0, 0, ${W}, ${H});
    for (let i = 0; i < 22; i++) { s.fillStyle = i % 2 ? "#b07a58" : "#d79c78"; s.fillRect(${W/2} - 56, ${Math.round(H*0.44)} - 68 + i*6, 112, 3); }
    s.fillStyle = "#241a14"; s.fillRect(${W/2} - 46, ${Math.round(H*0.44)} - 68, 92, 26);   // hair
    s.fillStyle = "#15181d"; s.fillRect(${W/2} - 40, ${Math.round(H*0.44)} - 8, 30, 11);    // glasses
    s.fillRect(${W/2} + 10, ${Math.round(H*0.44)} - 8, 30, 11);
    s.fillRect(${W/2} - 10, ${Math.round(H*0.44)} - 4, 20, 3);
    s.restore();
  };
  paint();

  // ── 1. THE DARK BORDER, measured in the channel it lives in ────────────
  const flat = new OffscreenCanvas(${W}, ${H}), fg = flat.getContext("2d");
  fg.fillStyle = "#808080"; fg.fillRect(0, 0, ${W}, ${H});
  const edgeAlpha = (os) => {
    d.clearRect(0, 0, ${W}, ${H});
    d.save(); d.globalCompositeOperation = "copy"; d.filter = "blur(" + cfg.blur + "px)";
    if (os) d.drawImage(flat, os.x, os.y, os.w, os.h); else d.drawImage(flat, 0, 0, ${W}, ${H});
    d.filter = "none"; d.restore();
    return { corner: A(0,0), edge: A(${W/2},0), side: A(0,${H/2}), centre: A(${W/2},${H/2}) };
  };
  out.alphaOld = edgeAlpha(null);
  out.alphaNew = edgeAlpha(cfg.overscan);

  // ── 2. HOW BLURRY IS BLURRY — the promise the button makes ─────────────
  const bg = (bokeh) => {
    d.save(); d.globalCompositeOperation = "copy";
    if (bokeh) {
      const sm = new OffscreenCanvas(bokeh.w, bokeh.h), sc = sm.getContext("2d");
      sc.filter = "blur(" + bokeh.radius + "px)";
      sc.drawImage(scene, cfg.bokehOverscan.x, cfg.bokehOverscan.y, cfg.bokehOverscan.w, cfg.bokehOverscan.h);
      sc.filter = "none";
      d.filter = "none"; d.drawImage(sm, 0, 0, ${W}, ${H});
    } else {
      d.filter = "blur(" + cfg.blur + "px)"; d.drawImage(scene, 0, 0, ${W}, ${H}); d.filter = "none";
    }
    d.restore();
    return { hi: detail(100), lo: detail(270) };
  };
  out.blurOld = bg(null);
  out.blurNew = bg(cfg.bokeh);

  // ── 3. THE HALO — how many pixels the edge takes to cross ──────────────
  const mask = new OffscreenCanvas(${W}, ${H}), mg = mask.getContext("2d");
  const buildMask = (soft) => {
    mg.clearRect(0, 0, ${W}, ${H});
    if (!soft) {
      // a CATEGORY mask: 0 or 255, nothing between — what shipped
      mg.fillStyle = "#000"; mg.beginPath();
      mg.ellipse(${W/2}, ${Math.round(H*0.72)}, 96, 128, 0, 0, 7); mg.fill();
      return;
    }
    // a CONFIDENCE mask through the S-curve: a real ramp, the width a selfie
    // model actually gives around a body
    const img = mg.createImageData(${W}, ${H});
    for (let y = 0; y < ${H}; y++) for (let x = 0; x < ${W}; x++) {
      const dx = (x - ${W/2}) / 96, dy = (y - ${Math.round(H*0.72)}) / 128;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const conf = Math.max(0, Math.min(1, (1.03 - dist) / 0.06));
      img.data[(y*${W}+x)*4+3] = cfg.curve[Math.round(conf*100)];
    }
    mg.putImageData(img, 0, 0);
  };
  const sil = new OffscreenCanvas(${W}, ${H}), sx = sil.getContext("2d", { willReadFrequently: true });
  const silhouette = (soft, maskBlur, erode) => {
    buildMask(soft);
    sx.save();
    sx.globalCompositeOperation = "copy"; sx.filter = "none"; sx.drawImage(mask, 0, 0, ${W}, ${H});
    sx.globalCompositeOperation = "copy"; sx.filter = "blur(" + maskBlur + "px)"; sx.drawImage(sil, 0, 0, ${W}, ${H});
    sx.filter = "none";
    sx.globalCompositeOperation = "source-in";
    for (let i = 1; i < erode; i++) sx.drawImage(sil, 0, 0, ${W}, ${H});
    sx.restore();
    return sil;
  };
  const crossing = (soft, maskBlur, erode) => {
    silhouette(soft, maskBlur, erode);
    const row = sx.getImageData(0, ${Math.round(H*0.72)}, ${W}, 1).data;
    let hi = -1, lo = -1;
    for (let x = ${W/2}; x < ${W}; x++) {
      const a = row[x*4+3];
      if (hi < 0 && a <= 230) hi = x;
      if (hi >= 0 && lo < 0 && a <= 25) { lo = x; break; }
    }
    return (hi >= 0 && lo >= 0) ? lo - hi : -1;
  };
  out.edgeOld = crossing(false, cfg.old.maskBlur, cfg.old.erode);
  out.edgeNew = crossing(true, cfg.maskBlur, cfg.erode);

  // ── the whole picture, for a person to look at ─────────────────────────
  const shot = (soft, maskBlur, erode, bokeh, os) => {
    paint();
    const sl = silhouette(soft, maskBlur, erode);
    d.save();
    d.globalCompositeOperation = "copy"; d.filter = "none"; d.drawImage(sl, 0, 0, ${W}, ${H});
    d.globalCompositeOperation = "source-in"; d.drawImage(scene, 0, 0, ${W}, ${H});
    d.globalCompositeOperation = "destination-over";
    if (bokeh) {
      const sm = new OffscreenCanvas(bokeh.w, bokeh.h), sc = sm.getContext("2d");
      sc.filter = "blur(" + bokeh.radius + "px)";
      sc.drawImage(scene, os.x, os.y, os.w, os.h); sc.filter = "none";
      d.drawImage(sm, 0, 0, ${W}, ${H});
    } else {
      d.filter = "blur(" + cfg.blur + "px)"; d.drawImage(scene, 0, 0, ${W}, ${H}); d.filter = "none";
    }
    d.restore();
    return c.toDataURL("image/png");
  };
  // Is the person still sharp? Detail across the face, in the output.
  const faceDetail = () => detailIn(${Math.round(W/2)-46}, ${Math.round(W/2)+46}, ${Math.round(H*0.44)});
  paint();
  d.save(); d.globalCompositeOperation = "copy"; d.filter = "none"; d.drawImage(scene, 0, 0, ${W}, ${H}); d.restore();
  out.faceSharp = faceDetail();

  out.pngOld = shot(false, cfg.old.maskBlur, cfg.old.erode, null, null);
  out.faceOld = faceDetail();
  out.pngNew = shot(true, cfg.maskBlur, cfg.erode, cfg.bokeh, cfg.bokehOverscan);
  out.faceNew = faceDetail();
  return out;
};
</script></body></html>`;

const bokeh = bokehPass(W, H, BLUR_PX);
const cfg = {
  blur: BLUR_PX,
  overscan: overscanRect(W, H, BLUR_PX),
  bokeh,
  bokehOverscan: overscanRect(bokeh.w, bokeh.h, bokeh.radius),
  curve: Array.from({ length: 101 }, (_, i) => confidenceToAlpha(i / 100)),
  maskBlur: maskBlurPx(H),
  erode: ERODE_POWER,
  old: OLD,
};

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: CHROME });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.setContent(html);
const r = await page.evaluate(async (c) => await window.RUN(c), cfg);
await browser.close();

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

console.log("=".repeat(74));
console.log("  RENDER CHECK — background quality, in pixels");
console.log("=".repeat(74));
ok(errs.length === 0, "the page ran without throwing" + (errs.length ? ` — ${errs[0]}` : ""));

console.log(`\n  edge of a blurred frame, ALPHA (255 = opaque):`);
console.log(`    old  corner ${r.alphaOld.corner}  edge ${r.alphaOld.edge}  side ${r.alphaOld.side}  centre ${r.alphaOld.centre}`);
console.log(`    new  corner ${r.alphaNew.corner}  edge ${r.alphaNew.edge}  side ${r.alphaNew.side}  centre ${r.alphaNew.centre}`);
ok(r.alphaOld.corner < 120,
  "NEGATIVE CONTROL: the old blur really does leave the corner of the frame half transparent — over a dark meeting UI that is the dark border in the screenshot");
ok(r.alphaNew.corner >= 250 && r.alphaNew.edge >= 250 && r.alphaNew.side >= 250,
  "the overscanned blur leaves every edge opaque: no dark border, at any radius");
ok(r.alphaOld.centre === 255 && r.alphaNew.centre === 255, "…and neither one touches the middle, which is why nobody could see what was wrong");

console.log(`\n  detail surviving in the background (lower = blurrier):`);
console.log(`    old  high-frequency ${r.blurOld.hi}  low-frequency ${r.blurOld.lo}`);
console.log(`    new  high-frequency ${r.blurNew.hi}  low-frequency ${r.blurNew.lo}`);
ok(r.blurNew.hi <= r.blurOld.hi && r.blurNew.lo <= r.blurOld.lo,
  "the new blur is at least as blurry as the old one on BOTH frequencies — a cheaper blur that makes the room readable again would break the only promise the button makes");

console.log(`\n  detail across the FACE (higher = sharper). camera itself: ${r.faceSharp}`);
console.log(`    old ${r.faceOld}   new ${r.faceNew}`);
ok(r.faceNew > r.faceOld,
  "the person comes out SHARPER than before — the old feather was wide enough to eat into the face itself, which is why a hat brim dissolved");
ok(r.faceNew > r.faceSharp * 0.75,
  "…and within a quarter of what the camera itself sent, measured INSIDE the face. NEGATIVE CONTROL for the whole feature: if the mask polarity ever flips and the blur lands on the person, this is the row that fails");

console.log(`\n  edge crossing, 90% alpha to 10% alpha: old ${r.edgeOld}px, new ${r.edgeNew}px (at ${H}p)`);
ok(r.edgeOld >= 18,
  "NEGATIVE CONTROL: the old feather really does smear the boundary across ~20px at 360p — that is the halo eating the hat brim");
ok(r.edgeNew > 0 && r.edgeNew <= 8,
  "the new edge crosses inside 8px: soft enough not to read as a cut-out, tight enough to read as a shoulder");
ok(r.edgeNew * 2 < r.edgeOld, "…less than half the old width, measured rather than asserted");

if (OUT) {
  writeFileSync(`${OUT}/background-before.png`, Buffer.from(r.pngOld.split(",")[1], "base64"));
  writeFileSync(`${OUT}/background-after.png`, Buffer.from(r.pngNew.split(",")[1], "base64"));
  console.log(`\n  wrote ${OUT}/background-before.png and ${OUT}/background-after.png`);
}

console.log("-".repeat(74));
console.log(`  ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
