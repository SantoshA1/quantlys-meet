/**
 * MAYA RENDER CHECK — the live-notes rail, measured, not believed.
 *
 * FIELD 2026-08-18, his screenshot: the rail shipped collapsed to a few
 * pixels, tangled with the manage panel, and FLAG did nothing. tsc passed,
 * the build passed, the suites passed — because the bug was GEOMETRY: an
 * absolutely-positioned rail resolving against a 44px header. Only a
 * rendered page can catch that class, so this joins a real room through the
 * real lobby and measures the pixels.
 *
 * Run (needs livekit :7880 + next :3100 up): node railcheck.mjs
 */
import { chromium } from "playwright";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
         "--autoplay-policy=no-user-gesture-required"],
});
const page = await (await b.newContext({
  viewport: { width: 1600, height: 900 },
  permissions: ["microphone", "camera"],
})).newPage();

await page.goto("http://127.0.0.1:3100/room/qm-railcheck", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);

// Through the REAL lobby: name + consent + join.
await page.fill('input[placeholder="Your name"]', "Maya");
const consent = page.locator('input[type="checkbox"]').first();
if (await consent.count()) await consent.check();
await page.getByRole("button", { name: /join/i }).first().click();
await page.waitForTimeout(9000);

const rail = page.locator(".qmr-liverail");
ok(await rail.count() === 1, "the rail is on screen by default at desktop width");

const box = await rail.boundingBox();
const header = await page.locator(".qmr-bar").boundingBox();
ok(!!box && box.height > 300,
  `the rail is a PANEL, not a squashed strip — height ${box ? Math.round(box.height) : "?"}px (the shipped bug was ~40px)`);
ok(!!box && Math.round(box.width) >= 300 && Math.round(box.width) <= 340,
  "…at its designed width");
ok(!!box && !!header && box.y >= header.y + header.height - 2,
  "…and it starts BELOW the header instead of tangled inside it");
ok(!!box && box.y + box.height < 900 - 60,
  "…and stops above the control bar");

const title = await page.locator(".qmr-lrtitle").boundingBox();
ok(!!title && title.height < 22,
  "LIVE NOTES sits on one line — the collapsed version wrapped it into soup");

// A guest with no captions and no recording: the flag button TEACHES instead
// of silently doing nothing.
const flag = page.locator(".qmr-lrflag");
ok(await flag.isDisabled(),
  "with no clock to anchor to, FLAG is disabled — not enabled-and-useless");
const tip = await flag.getAttribute("title");
ok(/captions|record/i.test(tip || ""),
  "…and its tooltip says what to do about it");

// The close/open toggle round-trips.
await page.locator(".qmr-lrclose").click();
await page.waitForTimeout(400);
ok(await page.locator(".qmr-liverail").count() === 0, "the × really closes it");
await page.getByRole("button", { name: /live notes/i }).click();
await page.waitForTimeout(400);
ok(await page.locator(".qmr-liverail").count() === 1, "…and the header button brings it back");

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
