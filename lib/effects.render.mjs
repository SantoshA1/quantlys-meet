/**
 * RENDER CHECK — the flashing, judged in pixels.
 *
 * The guards in effects.test.mjs prove the DECISIONS. Only pixels can prove
 * the picture, and "flashing" is a claim about pixels: it is a published
 * frame that is identical to the one before it on a source that was moving.
 * FIELD 2026-08-19 taught this product that geometry only fails in pixels;
 * this is the same lesson applied to motion.
 *
 * Both pipelines are run against the same synthetic camera:
 *   · OURS — every tick paints and publishes what it just painted;
 *   · THEIRS — the stock transformer, which returns early when the mask is
 *     late and enqueues the canvas anyway, republishing the last frame.
 * The second must FAIL this check. A check that cannot fail proves nothing.
 *
 * 2026-08-20, SECOND report: "blur is applying on people instead of
 * background." It was — and THIS FILE DID NOT CATCH IT, because it only ever
 * exercised the warm-up path (blur everything) and frame repetition. The
 * masked path, where the person/background decision actually lives, was
 * never rendered. So it renders here now, with a mask whose meaning is known,
 * and asserts which half came out sharp. A render check that skips the one
 * composite the feature is FOR is a render check with a hole in it.
 *
 * Needs a browser: npm i -D playwright && npx playwright install chromium
 * Run: node lib/effects.render.mjs
 */
import { chromium } from "playwright";
import { keepComposite, IMAGE_UNDERBLUR_PX, erodePx, maskBlurPx, featherPx } from "./effects.ts";

const CHROME = process.env.QM_CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const BLUR_PX = 24;   // must match lib/effects.ts

const page_html = `<!doctype html><html><body><script type="module">
window.RUN = async (blurPx) => {
  const out = { ours: [], theirs: [], errors: [] };
  const src = new OffscreenCanvas(320, 180);
  const sg = src.getContext("2d");
  // A detailed, MOVING source: detail so blur is measurable, motion so a
  // republished frame is detectable.
  const draw = (t) => {
    sg.fillStyle = "#fff"; sg.fillRect(0,0,320,180);
    for (let i=0;i<32;i++){ sg.fillStyle = i%2 ? "#000" : "#f00"; sg.fillRect(i*10,0,5,180); }
    sg.fillStyle = "#0f0"; sg.fillRect((t*7)%300, 60, 20, 60);
  };
  const dst = new OffscreenCanvas(320, 180);
  const dg = dst.getContext("2d");
  const sig = () => { const d = dg.getImageData(0,0,320,180).data; let s=0;
    for (let i=0;i<d.length;i+=97) s=(s*31+d[i])%1e9; return s; };
  const detail = () => { const d = dg.getImageData(0,0,320,180).data; let v=0;
    for (let x=1;x<319;x++){ const i=(90*320+x)*4, j=(90*320+x-1)*4; v+=Math.abs(d[i]-d[j]); } return v; };

  try {
    // OURS: paint every tick, mask or no mask.
    for (let t=0;t<12;t++){
      draw(t);
      dg.save(); dg.globalCompositeOperation="copy"; dg.filter="blur("+blurPx+"px)";
      dg.drawImage(src,0,0,320,180); dg.filter="none"; dg.restore();
      out.ours.push(sig());
    }
    out.oursDetail = detail();

    // THEIRS: the stock shape — when the mask is late (here: every other
    // frame, which is optimistic), skip the paint and enqueue anyway.
    dg.save(); dg.globalCompositeOperation="copy"; dg.filter="none";
    draw(0); dg.drawImage(src,0,0,320,180); dg.restore();
    for (let t=0;t<12;t++){
      draw(t);
      const maskLate = t % 2 === 1;
      if (!maskLate) {
        dg.save(); dg.globalCompositeOperation="copy"; dg.filter="blur("+blurPx+"px)";
        dg.drawImage(src,0,0,320,180); dg.filter="none"; dg.restore();
      }
      out.theirs.push(sig());   // enqueued regardless — that is the bug
    }

    draw(0);
    dg.save(); dg.globalCompositeOperation="copy"; dg.filter="none";
    dg.drawImage(src,0,0,320,180); dg.restore();
    out.sharpDetail = detail();

    // ── the masked composite, with a mask whose meaning we KNOW ──────────
    // A mask opaque over the CENTRE (where a webcam subject sits) and clear
    // at the edges. Both polarities are rendered; the one the pipeline picks
    // must be the one that leaves the CENTRE sharp.
    const maskC = new OffscreenCanvas(320, 180);
    const mgx = maskC.getContext("2d");
    const buildMask = (opaqueInCentre) => {
      mgx.clearRect(0,0,320,180);
      mgx.fillStyle = "rgba(0,0,0,1)";
      if (opaqueInCentre) { mgx.fillRect(112, 27, 96, 126); }
      else { mgx.fillRect(0,0,320,180); mgx.clearRect(112, 27, 96, 126); }
    };
    // detail inside a box — the measure of "is this half sharp"
    const detailIn = (x0,x1,y) => { const d = dg.getImageData(0,0,320,180).data; let v=0;
      for (let x=x0+1;x<x1;x++){ const i=(y*320+x)*4, j=(y*320+x-1)*4; v+=Math.abs(d[i]-d[j]); } return v; };

    const composite = (op, opaqueInCentre) => {
      draw(0);
      buildMask(opaqueInCentre);
      dg.save();
      dg.globalCompositeOperation = "copy"; dg.filter = "blur(6px)";
      dg.drawImage(maskC, 0, 0, 320, 180); dg.filter = "none";
      dg.globalCompositeOperation = op;
      dg.drawImage(src, 0, 0, 320, 180);
      dg.globalCompositeOperation = "destination-over";
      dg.filter = "blur(" + blurPx + "px)";
      dg.drawImage(src, 0, 0, 320, 180); dg.filter = "none";
      dg.restore();
      return { centre: detailIn(120, 200, 90), edge: detailIn(4, 100, 90) };
    };

    // mask marks the PERSON opaque → source-in keeps the person
    out.personOpaque = { in: composite("source-in", true), out: composite("source-out", true) };
    // mask marks the BACKGROUND opaque (MediaPipe today) → source-out keeps them
    out.bgOpaque = { in: composite("source-in", false), out: composite("source-out", false) };

    // ── does the chosen BACKDROP actually reach the picture? ────────────
    // An unmistakable magenta stands in for a backdrop image: if the output
    // is not magenta where the room was, the backdrop was thrown away.
    const bgc = new OffscreenCanvas(320,180), bgx = bgc.getContext("2d");
    bgx.fillStyle = "#ff00ff"; bgx.fillRect(0,0,320,180);
    const backdrop = await createImageBitmap(bgc);
    const isMagenta = (x,y) => { const d = dg.getImageData(x,y,1,1).data;
      return d[0] > 190 && d[1] < 90 && d[2] > 190; };

    const paintImage = (withUnderBlur) => {
      draw(0); buildMask(false);                       // background-opaque mask
      dg.save();
      dg.globalCompositeOperation="copy"; dg.filter="blur(6px)";
      dg.drawImage(maskC,0,0,320,180); dg.filter="none";
      dg.globalCompositeOperation="source-out"; dg.drawImage(src,0,0,320,180);
      dg.globalCompositeOperation="destination-over";
      if (withUnderBlur) {                              // the shape that shipped
        dg.filter="blur(18px)"; dg.drawImage(src,0,0,320,180); dg.filter="none";
        dg.globalCompositeOperation="destination-over";
      }
      dg.drawImage(backdrop,0,0,320,180);
      dg.restore();
      return { corner: isMagenta(8,8), far: isMagenta(310,170), mid: isMagenta(60,90), mid2: isMagenta(270,90) };
    };
    out.backdropWithUnderBlur = paintImage(true);
    out.backdropDirect = paintImage(false);

    // ── the halo: is the rim around the person blurred, or sharp? ───────
    // The mask is deliberately GENEROUS (like the real one): its clear area
    // is wider than the "person", so the extra ring is real room. Eroded,
    // that ring must land in the blur.
    const ring = (erodePower) => {
      draw(0);
      mgx.clearRect(0,0,320,180);
      mgx.fillStyle="rgba(0,0,0,1)"; mgx.fillRect(0,0,320,180);
      mgx.clearRect(100, 20, 120, 140);                // generous by ~12px a side
      dg.save();
      // silhouette: invert (background-opaque -> person), blur, erode
      dg.globalCompositeOperation="copy"; dg.filter="none"; dg.drawImage(maskC,0,0,320,180);
      dg.globalCompositeOperation="source-out"; dg.fillStyle="#000"; dg.fillRect(0,0,320,180);
      dg.globalCompositeOperation="copy"; dg.filter="blur(9px)";
      dg.drawImage(dst,0,0,320,180); dg.filter="none";
      dg.globalCompositeOperation="source-in";
      for (let i=1;i<erodePower;i++) dg.drawImage(dst,0,0,320,180);
      // alpha just inside the mask's own edge — how much of the rim survives
      const d = dg.getImageData(0,0,320,180).data;
      const at = (x,y) => d[(y*320+x)*4+3];
      dg.restore();
      return { atEdge: at(102, 90), inside: at(130, 90) };
    };
    out.ringNoErode = ring(1);
    out.ringEroded = ring(3);
  } catch (e) { out.errors.push(String(e)); }
  return out;
};
</script></body></html>`;

const repeats = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1]) n++; return n; };

const b = await chromium.launch({ args: ["--no-sandbox"], executablePath: CHROME });
const page = await (await b.newContext()).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.setContent(page_html);
const r = await page.evaluate(async (px) => await window.RUN(px), BLUR_PX);
await b.close();

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

ok(errs.length === 0 && r.errors.length === 0,
  `the pipeline runs clean in a real browser (${[...errs, ...r.errors].join("; ") || "no errors"})`);
ok(r.ours.length === 12, "twelve frames were painted and published");
ok(repeats(r.ours) === 0,
  `OURS: no two consecutive published frames are identical (${repeats(r.ours)} repeats) — a repeated frame on a moving source IS the flashing`);
ok(repeats(r.theirs) > 0,
  `THEIRS: the stock shape republishes stale frames (${repeats(r.theirs)} repeats in 12) — this check can fail, which is what makes the line above mean something`);
ok(r.oursDetail < r.sharpDetail * 0.35,
  `blur actually removes the room: ${r.oursDetail} vs ${r.sharpDetail} sharp (${Math.round((1 - r.oursDetail / r.sharpDetail) * 100)}% of detail gone)`);

// ── the composite that shipped inverted ─────────────────────────────────
// keepComposite() decides this from a MEASURED polarity; these four renders
// prove the mapping it encodes is the one that leaves the person sharp.
const sharper = (a, b) => a.centre > a.edge && b.centre < b.edge;
ok(r.personOpaque.in.centre > r.personOpaque.in.edge,
  `mask opaque on the PERSON + source-in → the person is the sharp half (centre ${r.personOpaque.in.centre} vs edge ${r.personOpaque.in.edge})`);
ok(r.personOpaque.out.centre < r.personOpaque.out.edge,
  "…and source-in's opposite blurs them — the two composites are genuinely different, so choosing between them matters");
ok(r.bgOpaque.out.centre > r.bgOpaque.out.edge,
  `mask opaque on the BACKGROUND + source-out → the person is the sharp half (centre ${r.bgOpaque.out.centre} vs edge ${r.bgOpaque.out.edge})`);
ok(r.bgOpaque.in.centre < r.bgOpaque.in.edge,
  "…and THIS is what shipped: background-opaque mask composited with source-in, which blurs the person and sharpens their living room");
ok(keepComposite("person") === "source-in" && keepComposite("background") === "source-out",
  "the product's mapping is the one just rendered — not a comment claiming it");

// ── the backdrop that never arrived ─────────────────────────────────────
ok(r.backdropDirect.mid && r.backdropDirect.mid2 && r.backdropDirect.far,
  "the chosen backdrop actually reaches the picture, right across the background");
ok(!r.backdropWithUnderBlur.mid && !r.backdropWithUnderBlur.mid2 && !r.backdropWithUnderBlur.far,
  "…and the shape that shipped buried it: the 'privacy under-blur' filled every transparent pixel, so the destination-over that paints the backdrop had nothing to paint. Every backdrop rendered as plain blur — 'showing same without any change', reproduced.");
ok(r.backdropWithUnderBlur.corner && !r.backdropWithUnderBlur.mid,
  "…visible ONLY as a bleed in the extreme corner, where an 18px blur leaves the canvas edge semi-transparent — which is why it looked like nothing was happening rather than like an error");
ok(IMAGE_UNDERBLUR_PX === 0,
  "the under-blur is retired in the product, not merely avoided in this test");

// ── the halo around the person ──────────────────────────────────────────
ok(r.ringNoErode.atEdge > 120,
  `un-eroded, the rim just inside the mask's own edge still counts as PERSON (alpha ${r.ringNoErode.atEdge}) — and that rim is real room, so it stays sharp. That is "blur is not effective around the edges of the people".`);
ok(r.ringEroded.atEdge < r.ringNoErode.atEdge * 0.5,
  `eroded, the same rim is handed back to the background (alpha ${r.ringEroded.atEdge} vs ${r.ringNoErode.atEdge}) — the silhouette now sits INSIDE the mask's generous edge, so the rim gets blurred with the rest of the room`);
ok(r.ringEroded.inside > 200,
  `and the person's middle is untouched (alpha ${r.ringEroded.inside}) — erosion trims the rim, it does not eat the subject`);
ok(erodePx(720) >= 1 && erodePx(720) <= 3 && maskBlurPx(720) > featherPx(720),
  "the erosion is a pixel or two at 720p and the mask blur carries both jobs — more than this starts eating fingers and hair");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
