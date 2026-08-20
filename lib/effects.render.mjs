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
 * Needs a browser: npm i -D playwright && npx playwright install chromium
 * Run: node lib/effects.render.mjs
 */
import { chromium } from "playwright";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
