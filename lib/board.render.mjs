/**
 * RENDER CHECK — why the whiteboard's Text tool did nothing.
 *
 * FIELD 2026-08-25: "the whiteboard design when users are trying to type. The
 * text button doesn't work."
 *
 * The code was all there — a `text` tool, an input that mounts where you
 * clicked, Enter to commit, a renderer that draws it. So this is a claim about
 * the BROWSER, not about the logic, and the only honest way to settle it is to
 * put the exact interaction in a real browser and look.
 *
 * THE SUSPECT: `onDown` calls `setPointerCapture` on the canvas BEFORE the
 * text branch runs, and the input mounts with `autoFocus`. The native
 * mousedown then completes on the canvas, and its default action moves focus
 * off whatever had it. `onBlur={commitText}` fires with an empty value,
 * removes the input, and the person sees a box flash and vanish.
 *
 * MAYA V2-6: the repro is built BEFORE the fix, both shapes are run, and the
 * broken one must FAIL. A check that only ever sees the fixed code proves the
 * fix compiles, not that it fixes anything.
 *
 * Needs a browser: npm i -D playwright && npx playwright install chromium
 * Run: node lib/board.render.mjs
 */
import { chromium } from "playwright";

const CHROME = process.env.QM_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const page_html = (preventDefault) => `<!doctype html><html><body style="margin:0">
<div id="wrap" style="position:relative;width:600px;height:400px">
  <canvas id="c" width="600" height="400" style="display:block;background:#eee"></canvas>
</div>
<script>
window.RESULT = { mounted: false, focusedAfterMount: false, focusedAfterClick: false, blurFired: false, committed: null };
const wrap = document.getElementById("wrap");
const c = document.getElementById("c");

c.addEventListener("pointerdown", (e) => {
  ${preventDefault ? "e.preventDefault();" : ""}
  c.setPointerCapture && c.setPointerCapture(e.pointerId);

  // the input the text tool mounts, with autoFocus, exactly as React would
  const input = document.createElement("input");
  input.id = "t";
  input.style.cssText = "position:absolute;left:100px;top:100px";
  input.addEventListener("blur", () => {
    window.RESULT.blurFired = true;
    // commitText(): an empty value commits nothing and removes the box
    window.RESULT.committed = input.value.trim() || null;
    input.remove();
  });
  wrap.appendChild(input);
  input.focus();
  window.RESULT.mounted = true;
  window.RESULT.focusedAfterMount = document.activeElement === input;
});
</script></body></html>`;

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: CHROME });

async function run(preventDefault) {
  const page = await (await browser.newContext()).newPage();
  await page.setContent(page_html(preventDefault));
  // A REAL click: mousedown, mouseup, click — the sequence the browser makes,
  // not a synthetic dispatch that skips the default action being tested.
  await page.mouse.click(300, 200);
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => ({
    ...window.RESULT,
    stillThere: !!document.getElementById("t"),
    focusedNow: document.activeElement?.id === "t",
  }));
  await page.close();
  return r;
}

const broken = await run(false);
const fixed = await run(true);
await browser.close();

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

console.log("=".repeat(74));
console.log("  RENDER CHECK — the whiteboard Text tool, in a real browser");
console.log("=".repeat(74));
console.log(`  without preventDefault: mounted=${broken.mounted} focusedAtMount=${broken.focusedAfterMount} blurFired=${broken.blurFired} stillThere=${broken.stillThere}`);
console.log(`  with    preventDefault: mounted=${fixed.mounted} focusedAtMount=${fixed.focusedAfterMount} blurFired=${fixed.blurFired} stillThere=${fixed.stillThere}`);

ok(broken.mounted && fixed.mounted, "the input mounts either way — the tool was never 'missing', which is why reading the code found nothing");
ok(broken.focusedAfterMount, "…and it even has focus at the moment it mounts, which is what makes this so hard to see by inspection");
ok(broken.blurFired && !broken.stillThere,
  "THE BUG, REPRODUCED: without preventDefault the native mousedown completes on the canvas, focus leaves the input, blur fires, commitText() finds an empty value and removes the box. A person sees it flash and vanish");
ok(!fixed.blurFired && fixed.stillThere && fixed.focusedNow,
  "THE FIX: preventDefault on pointerdown stops the canvas taking focus, so the box stays up and keeps the caret");
ok(broken.committed === null, "…and the empty commit is why nothing was ever drawn: it committed nothing, silently");

console.log("-".repeat(74));
console.log(`  ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
