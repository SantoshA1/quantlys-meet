/**
 * MAYA GUARD — the backdrops, and the slot for your own picture.
 *
 * Maya asks: "I clicked Nebula, then Gridline, then Dusk. Nothing changed —
 * they were all just blur. And none of them looked like a room I could be
 * sitting in anyway. Can I put my own photo behind me?"
 *
 * FIELD 2026-08-20: all four abstract backdrops rendered identically (a
 * compositing bug, guarded in effects.test.mjs) and none of them looked like
 * a place. Replaced with five rooms and a slot for a person's own picture.
 *
 * Run: node lib/backgrounds.test.mjs
 */
import { readFileSync } from "node:fs";
import { SLOTS, CUSTOM_ID, CUSTOM_PLACEHOLDER, sourcesFor, acceptCustom } from "./backgrounds.ts";
import { EFFECTS, effectById, effectSrc, customReady, processorFor } from "./camera.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── the shelf is rooms now ───────────────────────────────────────────────
const want = ["office", "library", "loft", "city", "lounge"];
ok(want.every((id) => SLOTS.some((s) => s.id === id)),
  "Office Cubicle, Library, Sunlit Loft, City View and Cozy Lounge are all there — the five that were asked for");
ok(SLOTS.length === 5, "…and only those five: a shelf is a choice, not a catalogue");
ok(!EFFECTS.some((e) => ["nebula", "gridline", "dusk", "boardroom"].includes(e.id)),
  "the abstract gradients are gone — nobody wants to appear to be sitting inside a purple haze");
ok(EFFECTS[0].kind === "none" && EFFECTS[1].kind === "blur",
  "None and Blur still come first — plain video stays the first-class choice");
ok(new Set(SLOTS.map((s) => s.id)).size === SLOTS.length, "slot ids are unique");
ok(SLOTS.every((s) => s.label && s.label !== s.id), "every slot has a name a person would say out loud");

// ── every backdrop is genuinely a different picture ──────────────────────
{
  const drawn = SLOTS.map((s) => s.drawn);
  ok(new Set(drawn).size === drawn.length,
    "no two backdrops are the same image — 'showing same without any change' had a compositing cause, but identical sources would have been a second one");
  ok(drawn.every((d) => d.startsWith("data:image/svg+xml")),
    "each is a data: URL — a background that needs a CDN is a background that is sometimes not there");
  ok(drawn.every((d) => decodeURIComponent(d).includes('width="1280"') && decodeURIComponent(d).includes('height="720"')),
    "…and declares its size, because createImageBitmap refuses an SVG without one");
  ok(drawn.every((d) => d.length > 1500),
    "each one is an actual drawn room, not a flat rectangle with a label on it");
}

// ── drop-in photo slots ──────────────────────────────────────────────────
ok(SLOTS.every((s) => s.photo.startsWith("/backgrounds/") && s.photo.endsWith(".jpg")),
  "every slot names where a real photograph would live in this deployment");
{
  const s = SLOTS[0];
  const order = sourcesFor(s);
  ok(order[0] === s.photo && order[1] === s.drawn,
    "the real photograph is tried FIRST and the drawn room is the fallback — drop a file in the folder and it is picked up, no code change");
  ok(sourcesFor(null).length === 0, "asking about a slot that isn't there is not a crash");
}
ok(!SLOTS.some((s) => /https?:/.test(s.drawn)),
  "nothing here reaches the network — a background is meant to be private");

// ── the slot for a person's OWN picture ──────────────────────────────────
{
  const slot = EFFECTS.find((e) => e.id === CUSTOM_ID);
  ok(Boolean(slot) && slot.custom === true, "there is a slot for a person's own picture");
  ok(slot.src === CUSTOM_PLACEHOLDER, "…which shows a fillable camera placeholder until they add one");
  ok(decodeURIComponent(CUSTOM_PLACEHOLDER).includes("stroke-dasharray"),
    "…drawn as an obvious empty frame, so it reads as 'put something here' and not as a sixth room");
  const png = "data:image/png;base64,iVBORw0KGgo=";
  ok(effectSrc(slot, png) === png, "once they add one, it is theirs that is used");
  ok(effectSrc(slot, "") === CUSTOM_PLACEHOLDER, "and the placeholder otherwise");
  ok(customReady(slot, "") === false && customReady(slot, png) === true,
    "an EMPTY slot is not ready — applying it would put a picture of a camera icon behind somebody, which is worse than doing nothing");
  ok(customReady(effectById("library"), "") === true, "the built-in rooms are always ready");
  ok(processorFor(slot, "").kind === "none",
    "…so an empty custom slot maps to no processor at all, rather than to a broken background");
  ok(processorFor(slot, png).imagePath === png, "and a filled one maps to the person's own picture");
  ok(processorFor(effectById("city")).imagePath === effectById("city").src,
    "a built-in room maps to its own picture — this is the mapping that silently produced four identical blurs");
}

// ── nothing off the disk is trusted either ───────────────────────────────
ok(acceptCustom("data:image/png;base64,iVBORw0KGgo=").ok, "a PNG from your computer is fine");
ok(acceptCustom("data:image/jpeg;base64,/9j/4AAQ").ok, "so is a JPEG");
ok(!acceptCustom("https://example.com/x.jpg").ok,
  "a remote URL is refused — it taints the canvas AND reaches the network for something meant to be private");
ok(!acceptCustom("data:text/html;base64,PHNjcmlwdD4=").ok, "a non-image data URL is refused");
ok(!acceptCustom("data:image/svg+xml;base64,PHN2Zz4=").ok,
  "…including SVG: an SVG can carry script, and this one is painted into a canvas");
ok(!acceptCustom("").ok && !acceptCustom(null).ok, "nothing at all is refused cleanly, never a crash");
{
  const huge = "data:image/png;base64," + "A".repeat(8_000_000);
  const v = acceptCustom(huge);
  ok(!v.ok && /4 MB|large/i.test(v.why),
    "a 6MB photo is refused with words a person can act on, not silently accepted and then stuttered on");
}
ok(acceptCustom("data:image/png;base64,QQ==").why === "", "an accepted picture has nothing to explain");

// ── the panel actually uses it ───────────────────────────────────────────
const g = readFileSync(new URL("../app/room/[room]/MediaGuard.tsx", import.meta.url), "utf8");
ok(/effectSrc\(e, customBg\)/.test(g),
  "each swatch shows the picture you will actually get — including your own");
ok(/onError=\{\(ev\)/.test(g),
  "a swatch whose photograph is missing falls back to the drawn room instead of a broken-image icon");
ok(/type="file"/.test(g) && /accept="image\/png,image\/jpeg,image\/webp"/.test(g),
  "there is a real picker, limited to formats a canvas can safely paint");
ok(/acceptCustom\(url\)/.test(g), "…and what it returns goes through the guarded check");
ok(/readAsDataURL/.test(g),
  "the picture is read locally to a data: URL — it never leaves the machine");
ok(/customReady\(e, customBg\)/.test(g),
  "clicking an EMPTY custom slot opens the picker instead of applying nothing");
ok(/save\(SAVED\.custom, url\)/.test(g) && /qm\.bg\.custom/.test(g),
  "the picture is remembered between meetings, like every other choice in this panel");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
