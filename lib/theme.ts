// The Quantlys Meeting design system.
//
// FIELD 2026-08-18: a design was handed over — Space Grotesk over IBM Plex
// Mono, near-black with a teal signal colour, chamfered corners, a faint
// engineering grid, corner brackets on anything holding video, and monospaced
// micro-labels in place of ordinary headings.
//
// HOW THIS IS APPLIED, because the method is the risk control:
// it is a SKIN, layered after each screen's own stylesheet, not a rewrite of
// it. The rules that hold the app together — the flex chain that keeps the
// meeting inside the viewport, the absolute positioning of the caption bar,
// the overflow clip that took a whole round to get right — are untouched.
// This file changes colour, type, border and spacing. A restyle that also
// re-lays-out is two changes wearing one coat, and when it breaks you cannot
// tell which half did it.
//
// The token block is the only place a colour is written down. Both themes are
// real: the light one is not the dark one with the lightness flipped, it has
// its own accent (#00857c) because #00A99D on white fails contrast at small
// sizes, and this design is mostly small sizes.

export type ThemePref = "dark" | "light" | "system";

/** What to actually paint, given what they asked for and what the OS says. */
export function resolveTheme(pref: ThemePref | string, prefersDark: boolean): "dark" | "light" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export function themeNote(pref: ThemePref | string, prefersDark: boolean): string {
  if (pref === "light") return "Light, always.";
  if (pref === "dark") return "Dark, always.";
  return prefersDark
    ? "Following your computer — it's set to dark."
    : "Following your computer — it's set to light.";
}

export function nextTheme(pref: ThemePref | string): ThemePref {
  return pref === "dark" ? "light" : pref === "light" ? "system" : "dark";
}

export const THEME_KEY = "qm.theme";

/** Runs before first paint. Without it the browser paints the default theme,
 *  then React swaps it — and somebody who chose light gets a black flash on
 *  every single page load, which reads as a bug in the product. */
export const THEME_BOOT = `(function(){try{
var p=localStorage.getItem('${THEME_KEY}')||'system';
var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.setAttribute('data-qtheme',d?'dark':'light');
}catch(e){document.documentElement.setAttribute('data-qtheme','dark');}})();`;

// The stylesheet itself lives in app/globals.css — a real, cached, single
// copy of the design system, which is also the file the guards read.
