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
import { SLOTS, LOOPS, CUSTOM_ID, CUSTOM_PLACEHOLDER, sourcesFor, acceptCustom } from "./backgrounds.ts";
import { EFFECTS, effectById, effectSrc, customReady, processorFor, shelfEffects, effectUsable } from "./camera.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── the shelf is rooms now ───────────────────────────────────────────────
const want = ["office", "library", "loft", "city", "lounge"];
ok(want.every((id) => SLOTS.some((s) => s.id === id)),
  "Tech atrium, Warm library, Neon loft, Glass dusk and Coastal calm are all there — the curated Quantlys set");
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
ok(/effectSrc\(e, customBg, photoIds\.includes\(e\.id\)\)/.test(g),
  "each swatch shows the picture you will actually get — their own, or the real photograph now that the renderer finally reads one");
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

// ── 2026-08-24: "the backgrounds and the blur quality is really bad" ──────
//
// Half of that complaint was not a rendering bug at all. Every room on the
// shelf is a SLOT — a real photograph at /backgrounds/<id>.jpg when a
// deployment ships one, a drawn scene until it does — and nobody ever
// shipped the photographs. So a hundred per cent of users picked "Office
// Cubicle" and got a vector cartoon of an office, next to a video of a real
// person. No mask, feather or model fixes that.
const bare = shelfEffects([]);
ok(bare.length === 3 && bare[0].id === "none" && bare[1].id === "blur" && bare[2].custom === true,
  "with no photographs shipped the shelf is None, Blur and Your photo — three honest choices instead of seven, five of them drawings");
ok(!bare.some((e) => ["office", "library", "loft", "city", "lounge"].includes(e.id)),
  "…and not one drawn room is offered. A cartoon backdrop is worse than no backdrop: it is the thing people screenshot when they say the product looks cheap");

const some = shelfEffects(["office", "loft"]);
ok(some.map((e) => e.id).join(",") === "none,blur,office,loft,custom",
  "drop office.jpg and loft.jpg into public/backgrounds/ and exactly those two come back, in shelf order, with no code change — that was always the promise of the slot and it is the mechanism now");
ok(shelfEffects(null).length === 3 && shelfEffects(undefined).length === 3,
  "no answer yet from the probe is the same as no photographs — the shelf never flashes rooms it is about to withdraw");

ok(effectUsable(effectById("blur")) && effectUsable(effectById("none")),
  "NEGATIVE CONTROL: blur and plain video never depend on us shipping a file");
ok(effectUsable(effectById("office"), ["office"]) && !effectUsable(effectById("office"), []),
  "a room is usable exactly when its photograph is here");

// THE WIRE THAT WAS NEVER CONNECTED: `photo` was handed to the renderer and
// never read, so shipping the JPEGs would have changed the little swatch in
// the settings panel and NOT the background anyone actually saw.
const office = effectById("office");
ok(office.photo === "/backgrounds/office.jpg", "the slot knows where its photograph lives");
ok(effectSrc(office, "", true) === office.photo,
  "…and with the photograph present, THAT is what gets painted behind the person");
ok(processorFor(office, "", true).imagePath === office.photo,
  "…all the way through the processor — the field existed for this and was read by nothing");
ok(effectSrc(office, "", false) === office.src && processorFor(office, "", false).imagePath === office.src,
  "NEGATIVE CONTROL: without the photograph it is still the drawn room, so an unshipped deployment degrades rather than painting a 404");


// ── 2026-09-03: living loops on the same shelf ────────────────────────────
ok(LOOPS.length === 3 && LOOPS.every((l) => l.loop.endsWith(".webm") && l.poster.endsWith(".jpg")),
  "three living loops ship as muted webm + poster still");
ok(LOOPS.every((l) => /Beach dusk|Courtyard breeze|City shimmer/.test(l.label)),
  "loops are labeled clearly for the picker");
ok(shelfEffects([], []).every((e) => e.kind !== "video"),
  "with no loop files probed, the shelf does not offer loops");
ok(shelfEffects([], ["beach", "courtyard"]).filter((e) => e.kind === "video").map((e) => e.id).join(",") === "beach,courtyard",
  "drop beach.webm and courtyard.webm in and those loops appear — same probe pattern as photographs");
ok(processorFor(effectById("beach")).kind === "video" && processorFor(effectById("beach")).videoPath === "/backgrounds/beach.webm",
  "a loop maps to a video processor path, not an image");
ok(effectUsable(effectById("beach"), [], ["beach"]) && !effectUsable(effectById("beach"), [], []),
  "a loop is usable exactly when its file was found");


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
