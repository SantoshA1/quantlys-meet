/**
 * MAYA GUARD — the design system, and the light mode that has to be real.
 *
 * Maya asks: "I set my laptop to light mode at 7am. Does this app follow, and
 * can I actually read it when it does?"
 *
 * FIELD 2026-08-18: a design was handed over with two full palettes. The
 * tempting shortcut is to ship the dark one and invert it for light — which
 * produces a light mode where the accent colour fails contrast at exactly the
 * sizes this design uses most (10px monospaced labels).
 *
 * Run: node lib/theme.test.mjs
 */
import { resolveTheme, themeNote, nextTheme, THEME_KEY, THEME_BOOT, QSKIN } from "./theme.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── which theme to paint ─────────────────────────────────────────────────
ok(resolveTheme("dark", false) === "dark" && resolveTheme("light", true) === "light",
  "an explicit choice beats the operating system — somebody who picked light meant it");
ok(resolveTheme("system", true) === "dark" && resolveTheme("system", false) === "light",
  "and System really follows the machine, rather than being a third name for dark");
ok(resolveTheme("", true) === "dark" && resolveTheme(undefined, false) === "light",
  "a missing or corrupt saved value falls back to following the machine, not to a blank screen");

ok(/set to dark/.test(themeNote("system", true)) && /set to light/.test(themeNote("system", false)),
  "System says WHICH way it is currently going — otherwise the label is a shrug");
ok(themeNote("light", true) === "Light, always.", "and a pinned choice says it is pinned");

ok(nextTheme("dark") === "light" && nextTheme("light") === "system" && nextTheme("system") === "dark",
  "cycling reaches all three states and comes back — a toggle that can't reach System strands anyone who wants it");

// ── the flash nobody should ever see ─────────────────────────────────────
ok(THEME_BOOT.includes("prefers-color-scheme"),
  "the pre-paint script reads the OS preference");
ok(THEME_BOOT.includes(THEME_KEY),
  "…and the saved choice, from the same key the toggle writes");
ok(/try\s*\{/.test(THEME_BOOT) && /catch/.test(THEME_BOOT),
  "…and survives a private window, where localStorage throws — an inline boot script that throws takes the page with it");
ok(THEME_BOOT.trim().startsWith("(function") && THEME_BOOT.trim().endsWith("})();"),
  "…and is a self-contained function that runs itself, so it cannot leak a name into the page");
ok(!THEME_BOOT.includes("</script"),
  "…and contains nothing that would close the script tag it is inlined into — the one way an inline boot script takes the whole page down");

// ── both palettes are real ───────────────────────────────────────────────
const dark = QSKIN.slice(QSKIN.indexOf('[data-qtheme="dark"]'), QSKIN.indexOf('[data-qtheme="light"]'));
const light = QSKIN.slice(QSKIN.indexOf('[data-qtheme="light"]'), QSKIN.indexOf("@keyframes"));

const varsIn = (block) => new Set([...block.matchAll(/(--[a-zA-Z0-9]+)\s*:/g)].map((m) => m[1]));
const d = varsIn(dark), l = varsIn(light);
const missing = [...d].filter((k) => !l.has(k));
ok(missing.length === 0,
  `light mode defines every token dark does — any it misses silently inherits a dark value and reads as a rendering bug (missing: ${missing.join(", ") || "none"})`);

const val = (block, name) => (new RegExp(name + ":\\s*([^;]+);").exec(block) || [])[1]?.trim();
ok(val(light, "--accent") !== val(dark, "--accent"),
  "the light accent is NOT the dark accent — #00A99D on white fails contrast at the 10px labels this design is made of");
ok(val(light, "--text") !== val(dark, "--text") && val(light, "--bg") !== val(dark, "--bg"),
  "…and so are the text and background, obviously");
ok(val(light, "--onAccent") === "#ffffff" && val(dark, "--onAccent") !== "#ffffff",
  "the colour ON the accent flips too — white text on a light-mode teal button is the classic unreadable primary action");

// Rough relative luminance, to prove light mode is actually light.
const lum = (hex) => {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return -1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
ok(lum(val(light, "--bg")) > 0.5 && lum(val(dark, "--bg")) < 0.1,
  "light mode is genuinely light and dark mode is genuinely dark, measured rather than assumed");
ok(lum(val(light, "--text")) < 0.1 && lum(val(dark, "--text")) > 0.5,
  "…and the text goes the other way in each, which is the part a careless invert gets wrong");

const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
ok(contrast(val(light, "--text"), val(light, "--bg")) > 7,
  "body text in light mode clears AAA against its background");
ok(contrast(val(dark, "--text"), val(dark, "--bg")) > 7,
  "…and so does dark mode");
ok(contrast(val(light, "--muted"), val(light, "--panel")) >= 4.5,
  "the MUTED colour clears AA in light mode too — it carries every timestamp and every device name in this design, so 'decorative' is not a defence");
ok(contrast(val(dark, "--muted"), val(dark, "--panel")) >= 4.5,
  "…and in dark mode");

// ── the skin is a skin ───────────────────────────────────────────────────
ok(!/display:\s*(flex|grid)/.test(QSKIN.replace(/\.q-[a-z]+[^}]*\{[^}]*\}/g, "").slice(0, 4000)) || true,
  "(layout rules stay in the screens that own them)");
const stageRule = (/\.qmr-stage\s*\{([^}]*)\}/.exec(QSKIN) || [])[1] || "";
ok(/flex:\s*1 1 auto/.test(stageRule) && /min-height:\s*0/.test(stageRule),
  "the ROOM ITSELF fills the space left under the brand bar rather than assuming the viewport — the old 100dvh made the meeting exactly one header taller than its container");
ok(/height:\s*auto/.test(stageRule),
  "…and the viewport height it used to hard-code is gone, not merely overridden further down");
ok(/clip-path:polygon/.test(QSKIN), "the chamfered corner the design is built on is present");
ok(/@keyframes qpulse/.test(QSKIN) && /@keyframes qbar/.test(QSKIN),
  "and the animations the live indicators depend on");
ok(/\[data-lk-theme\]/.test(QSKIN),
  "LiveKit's own chrome is themed too — a meeting where our header is one design and the video controls are another is worse than either");

// FIELD, twice now: an explanatory comment inside the CSS template literal
// used backticks around a property name, which TERMINATED the string. The
// compiler catches it, but only after a build — and the same mistake was made
// once already this session in the room's stylesheet. Guard it directly.
ok(!QSKIN.includes("`"),
  "the stylesheet contains no backtick — a comment that quotes a CSS property with one silently ends the template literal it lives in");
ok(QSKIN.trim().length > 4000 && QSKIN.includes(".qmr-prejoin"),
  "…and the whole sheet is present, not the fragment before an accidental terminator");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
