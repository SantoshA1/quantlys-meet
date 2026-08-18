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

// ── the skin ───────────────────────────────────────────────────────────────

export const QSKIN = `
:root, [data-qtheme="dark"] {
  --bg:#04060a; --surface:#05070b; --panel:#070b10; --sunk:#070a0f;
  --line:#16202c; --line2:#131c26; --rail:#0e1620; --fieldline:#1e2937;
  --text:#e8eef5; --text2:#c3cddb; --muted:#7b8aa0; --dim:#4a566b; --faint:#3f4a5c;
  --accent:#00A99D; --accent2:#4DD7CF; --accentBright:#7ff0e8; --onAccent:#031310;
  --glow:rgba(0,169,157,.16); --glow2:rgba(77,215,207,.10); --grid:rgba(255,255,255,.014);
  --warn:#ffc98a; --warnBg:#1b1408; --warnLine:#7a4a2f;
  --danger:#ff5964; --dangerBg:#4a1f24; --dangerLine:#7a2f38; --dangerText:#ffd7d7;
  --tile:#0a0f15; --shadow:0 0 32px rgba(0,169,157,.34);
}
[data-qtheme="light"] {
  --bg:#e9eef3; --surface:#f6f9fb; --panel:#ffffff; --sunk:#ffffff;
  --line:#d2dce5; --line2:#e3eaf1; --rail:#dde5ed; --fieldline:#c9d6e1;
  --text:#08131a; --text2:#2f3f4c; --muted:#5b6c7d; --dim:#7f92a3; --faint:#9aa9b8;
  --accent:#00857c; --accent2:#00736b; --accentBright:#005f59; --onAccent:#ffffff;
  --glow:rgba(0,169,157,.14); --glow2:rgba(0,133,124,.07); --grid:rgba(8,19,26,.04);
  --warn:#96540d; --warnBg:#fdf4e6; --warnLine:#e0b98a;
  --danger:#c62b36; --dangerBg:#fdeaec; --dangerLine:#f0bcc1; --dangerText:#8f1b25;
  --tile:#dbe4ec; --shadow:0 10px 30px rgba(0,84,78,.18);
}

@keyframes qsweep { 0% { transform:translateX(-140%) } 100% { transform:translateX(520%) } }
@keyframes qpulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.3; transform:scale(.8) } }
@keyframes qbar   { 0%,100% { transform:scaleY(.2) } 50% { transform:scaleY(1) } }
@keyframes qscan  { 0% { top:0; opacity:0 } 12% { opacity:.9 } 88% { opacity:.9 } 100% { top:100%; opacity:0 } }

html, body { background:var(--bg); color:var(--text); }
body { font-family:"Space Grotesk", system-ui, sans-serif;
  transition:background .35s ease, color .35s ease; }

/* ── shared parts ─────────────────────────────────────────────────────── */
.q-mono { font-family:"IBM Plex Mono", ui-monospace, monospace; }
.q-label { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10px; letter-spacing:.22em; text-transform:uppercase; color:var(--dim); }
.q-chip { display:inline-flex; align-items:center; gap:7px; padding:5px 11px;
  border:1px solid var(--fieldline); background:var(--sunk);
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px; letter-spacing:.14em; color:var(--muted); white-space:nowrap;
  clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px); }
.q-chip b { color:var(--accent2); font-weight:500; }
.q-chip.q-live { border-color:var(--accent); color:var(--accent2); }
.q-dot { width:7px; height:7px; border-radius:50%; background:var(--accent2); flex:0 0 auto; }
.q-dot.q-beat { animation:qpulse 1.4s ease-in-out infinite; }
.q-bars { display:inline-flex; align-items:flex-end; gap:2px; height:11px; }
.q-bars i { width:2px; height:100%; background:var(--accent2); transform-origin:bottom;
  animation:qbar 1.2s ease-in-out infinite; }
.q-bars i:nth-child(2) { animation-duration:.9s; animation-delay:-.4s; }
.q-bars i:nth-child(3) { animation-duration:1.5s; animation-delay:-.7s; }
.q-field { position:absolute; inset:0; pointer-events:none;
  background:
    repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 64px),
    repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 64px); }
.q-corner { position:absolute; width:18px; height:18px; pointer-events:none; }
.q-corner.tl { left:0; top:0; border-left:2px solid var(--accent2); border-top:2px solid var(--accent2); }
.q-corner.tr { right:0; top:0; border-right:2px solid var(--accent2); border-top:2px solid var(--accent2); }
.q-corner.bl { left:0; bottom:0; border-left:2px solid var(--accent2); border-bottom:2px solid var(--accent2); }
.q-corner.br { right:0; bottom:0; border-right:2px solid var(--accent2); border-bottom:2px solid var(--accent2); }

/* The theme switch. Three states, because "System" is a real answer and an
   app that silently ignores the OS setting is one people fight with. */
.q-themebar { display:flex; align-items:center; gap:10px; }
.q-themeset { display:flex; border:1px solid var(--fieldline); background:var(--sunk); }
.q-themeset button { font:inherit; cursor:pointer; background:transparent; border:0;
  color:var(--muted); padding:5px 10px; font-size:10.5px; letter-spacing:.12em;
  text-transform:uppercase; font-family:"IBM Plex Mono", ui-monospace, monospace; }
.q-themeset button:hover { color:var(--text2); }
.q-themeset button[aria-pressed="true"] { background:var(--accent); color:var(--onAccent); }

/* ── the global brand bar ─────────────────────────────────────────────── */
.brandbar { background:color-mix(in srgb, var(--panel) 84%, transparent) !important;
  border-bottom:1px solid var(--line2) !important; backdrop-filter:blur(10px);
  display:flex; align-items:center; gap:11px; padding:11px 22px; }
.brandbar b { font-size:13.5px; font-weight:600; letter-spacing:.09em;
  text-transform:uppercase; color:var(--text); }
.brandbar .logo { filter:drop-shadow(0 0 8px var(--glow)); }

/* ── HOST CONSOLE ─────────────────────────────────────────────────────── */
.qm-wrap { background:
  radial-gradient(1100px 520px at 76% -14%, var(--glow), transparent 62%),
  radial-gradient(700px 400px at 4% 108%, var(--glow2), transparent 60%),
  repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 64px),
  repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 64px),
  var(--bg); }
.qm-card { background:color-mix(in srgb, var(--panel) 92%, transparent) !important;
  border:1px solid var(--line) !important; border-radius:0 !important;
  clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);
  box-shadow:none !important; }
.qm-card h1 { font-size:27px !important; font-weight:600; letter-spacing:-.02em; color:var(--text); }
.qm-card h2 { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.22em; text-transform:uppercase;
  color:var(--accent2) !important; font-weight:500; }
.qm-muted, .qm-hint, .qm-tiny { color:var(--muted) !important; }
.qm-label { font-family:"IBM Plex Mono", ui-monospace, monospace !important;
  font-size:10px !important; letter-spacing:.2em !important; text-transform:uppercase;
  color:var(--dim) !important; }
.qm-input, .qm-guests, .qm-sched, .qm-area, select {
  background:var(--sunk) !important; color:var(--text) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important;
  font-family:inherit; }
.qm-input:focus, .qm-guests:focus, .qm-sched:focus, .qm-area:focus, select:focus {
  outline:0 !important; border-color:var(--accent) !important;
  box-shadow:0 0 0 3px var(--glow) !important; }
.qm-primary { background:var(--accent) !important; color:var(--onAccent) !important;
  border:1px solid var(--accent) !important; border-radius:0 !important;
  font-size:12px !important; letter-spacing:.1em; text-transform:uppercase; font-weight:600;
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px); }
.qm-primary:hover:not(:disabled) { background:var(--accentBright) !important; }
.qm-ghost { background:transparent !important; color:var(--text2) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important;
  font-size:11px !important; letter-spacing:.1em; text-transform:uppercase; }
.qm-ghost:hover { border-color:var(--accent) !important; color:var(--accent2) !important; }
.qm-danger { background:var(--dangerBg) !important; color:var(--dangerText) !important;
  border:1px solid var(--dangerLine) !important; border-radius:0 !important; }
.qm-item, .qm-itemwrap { border-color:var(--line2) !important; }
.qm-name { color:var(--text) !important; }
.qm-when, .qm-ended { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.08em; color:var(--muted) !important; }
.qm-note, .qm-warn { background:var(--warnBg) !important; border:1px solid var(--warnLine) !important;
  color:var(--warn) !important; border-radius:0 !important; }
.qm-good { color:var(--accent2) !important; }
.qm-bad { color:var(--danger) !important; }
.qm-proj, .qm-projname { font-family:"IBM Plex Mono", ui-monospace, monospace;
  letter-spacing:.14em; text-transform:uppercase; color:var(--dim) !important; }
.qm-steps { border-color:var(--line2) !important; }
.qm-mark, .qm-tick { accent-color:var(--accent); }
.qm-player { border:1px solid var(--line) !important; border-radius:0 !important; }

.qm-bar { display:flex; align-items:center; gap:9px; flex-wrap:wrap;
  padding-bottom:14px; border-bottom:1px solid var(--line2); margin-bottom:22px; }
.qm-logo { font-family:"IBM Plex Mono", ui-monospace, monospace !important;
  font-size:11px !important; letter-spacing:.22em !important; text-transform:uppercase;
  color:var(--accent2) !important; font-weight:500 !important; }
.qm-chips { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-left:auto; }

/* ── SEARCH (host) ────────────────────────────────────────────────────── */
.qs-in { background:var(--sunk) !important; color:var(--text) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important; }
.qs-in:focus { border-color:var(--accent) !important; box-shadow:0 0 0 3px var(--glow) !important; }
.qs-go { background:var(--accent) !important; color:var(--onAccent) !important;
  border:1px solid var(--accent) !important; border-radius:0 !important;
  letter-spacing:.1em; text-transform:uppercase; font-size:12px !important;
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px); }
.qs-hitcard, .qs-answer, .qs-play { background:var(--panel) !important;
  border:1px solid var(--line) !important; border-radius:0 !important; }
.qs-at, .qs-alabel { font-family:"IBM Plex Mono", ui-monospace, monospace;
  color:var(--accent2) !important; letter-spacing:.1em; }
.qs-hmeta, .qs-tips, .qs-count { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.06em; color:var(--muted) !important; }
.qs-hit { background:color-mix(in srgb, var(--accent) 22%, transparent) !important;
  color:var(--accentBright) !important; border-radius:0 !important; }
.qs-chip { background:var(--sunk) !important; border:1px solid var(--fieldline) !important;
  color:var(--muted) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.06em; }
.qs-chip:hover { border-color:var(--accent) !important; color:var(--accent2) !important; }
.qs-note { background:var(--warnBg) !important; border-color:var(--warnLine) !important;
  color:var(--warn) !important; border-radius:0 !important; }
.qs-err { background:var(--dangerBg) !important; border-color:var(--dangerLine) !important;
  color:var(--dangerText) !important; border-radius:0 !important; }

/* ── NOTES panel (host) ───────────────────────────────────────────────── */
.qm-notes { background:var(--panel) !important; border:1px solid var(--line) !important;
  border-radius:0 !important; color:var(--text2) !important; }
.qm-ntitle { color:var(--text) !important; font-weight:600; letter-spacing:-.01em; }
.qm-ntabs { border-bottom:1px solid var(--line2) !important; }
.qm-ntab { color:var(--muted) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.1em; text-transform:uppercase; }
.qm-non { background:var(--accent) !important; color:var(--onAccent) !important;
  border-color:var(--accent) !important; }
.qm-nhead { font-family:"IBM Plex Mono", ui-monospace, monospace;
  color:var(--accent2) !important; letter-spacing:.22em !important; }
.qm-nover, .qm-nlist li { color:var(--text2) !important; }
.qm-nlist strong { color:var(--text) !important; }
.qm-nmuted, .qm-nfine { color:var(--muted) !important; }
.qm-nwhy { background:var(--warnBg) !important; border-color:var(--warnLine) !important;
  color:var(--warn) !important; border-radius:0 !important; }
.qm-askin { background:var(--sunk) !important; border:1px solid var(--fieldline) !important;
  color:var(--text) !important; border-radius:0 !important; }
.qm-askin:focus { border-color:var(--accent) !important; }
.qm-chip { background:var(--sunk) !important; border:1px solid var(--fieldline) !important;
  color:var(--muted) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:11px !important; }
.qm-answer { background:var(--sunk) !important; border:1px solid var(--line) !important;
  border-radius:0 !important; }
.qm-citeat { font-family:"IBM Plex Mono", ui-monospace, monospace;
  color:var(--accent2) !important; }
.qm-ntranscript { background:var(--sunk) !important; border:1px solid var(--line) !important;
  border-radius:0 !important; color:var(--text2) !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace !important; }

/* ── THE ROOM ─────────────────────────────────────────────────────────── */
/* FIELD: the stage used to be 100dvh INSIDE a scrollable main that already sat
   below the brand bar, so the meeting was always exactly one brand-bar taller
   than the space it had. Fill what is actually left instead of guessing at the
   viewport — otherwise every change to the header re-breaks the room. */
.qmr-stage { background:var(--bg) !important; height:auto !important;
  flex:1 1 auto; min-height:0; }
/* FIELD, read off the live screenshot: making the stage flex to fill the shell
   also made the LOBBY a flex child, and "place-items:center" on a grid stops
   meaning anything the moment its parent decides the width. The card drifted
   to the right edge. Centre it explicitly instead of relying on a rule that
   only worked while the page was the whole viewport. */
.qmr-prejoin { flex:1 1 auto; min-height:0 !important;
  display:grid !important; place-items:center !important; padding:28px 20px !important;
  font-family:"Space Grotesk", system-ui, sans-serif !important; }

/* The design's lobby is two columns: what you look like on the left, what you
   are joining on the right. On a phone it stacks, because a 16:9 preview and a
   consent checkbox side by side on 390px is neither. */
.qmr-card { width:min(920px, 100%) !important; padding:30px !important; }
.qmr-lobby { display:grid; gap:26px; align-items:start; }
@media (min-width: 900px) { .qmr-lobby { grid-template-columns:1.15fr 1fr; gap:30px; } }
.qmr-lobbyside { display:flex; flex-direction:column; gap:12px; min-width:0; }
.qmr-lobby > .qmd { min-width:0; }
.qmr-lobby > .qmr-consent, .qmr-lobby > .qmr-error { grid-column:1 / -1; }
.qmr-eyebrow { font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:10px;
  letter-spacing:.22em; text-transform:uppercase; color:var(--dim); margin:0 0 10px; }
.qmr-meta { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:11px;
  letter-spacing:.06em; color:var(--muted); }
.qmr-meta .qmr-sep { color:var(--line); }
.qmr-meta b { color:var(--accent2); font-weight:500; }
.qmr-bar { background:var(--panel) !important; border-bottom:1px solid var(--line2) !important; }
.qmr-logo b, .qmr-logo { color:var(--text) !important; font-weight:600;
  letter-spacing:.09em; text-transform:uppercase; font-size:13px !important; }
.qmr-names, .qmr-people { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.1em; color:var(--muted) !important; }
.qmr-people b { color:var(--accent2) !important; font-weight:500; }
.qmr-conf { position:relative; }
.qmr-conf::before, .qmr-conf::after { content:""; position:absolute; width:20px; height:20px;
  pointer-events:none; z-index:5; }
.qmr-conf::before { left:6px; top:6px; border-left:2px solid var(--accent2); border-top:2px solid var(--accent2); }
.qmr-conf::after { right:6px; bottom:6px; border-right:2px solid var(--accent2); border-bottom:2px solid var(--accent2); }
.qmr-ghost { background:transparent !important; color:var(--text2) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important;
  font-size:11px !important; letter-spacing:.1em; text-transform:uppercase; }
.qmr-ghost:hover { border-color:var(--accent) !important; color:var(--accent2) !important; }
.qmr-on { background:var(--accent) !important; color:var(--onAccent) !important;
  border-color:var(--accent) !important; }
.qmr-leave { background:var(--dangerBg) !important; color:var(--dangerText) !important;
  border:1px solid var(--dangerLine) !important; border-radius:0 !important;
  font-size:11px !important; letter-spacing:.1em; text-transform:uppercase; font-weight:600; }
.qmr-rec, .qmr-recbadge { background:var(--dangerBg) !important; border:1px solid var(--dangerLine) !important;
  color:var(--dangerText) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.14em; font-weight:600; }
.qmr-dot { background:var(--danger) !important; animation:qpulse 1.2s ease-in-out infinite; }
.qmr-panel, .qmr-status, .qmr-float { background:var(--panel) !important;
  border:1px solid var(--line) !important; border-radius:0 !important;
  clip-path:polygon(11px 0,100% 0,100% calc(100% - 11px),calc(100% - 11px) 100%,0 100%,0 11px); }
.qmr-panel-head strong { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.18em; text-transform:uppercase; color:var(--accent2) !important; }
.qmr-fine, .qmr-muted { color:var(--muted) !important; }
.qmr-plist li { border-color:var(--line2) !important; }
.qmr-pname { color:var(--text) !important; }
.qmr-lock { background:transparent !important; color:var(--text2) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.1em; text-transform:uppercase; }
.qmr-lock.qmr-on { background:var(--accent) !important; color:var(--onAccent) !important; }
.qmr-waitlist { background:color-mix(in srgb, var(--accent) 12%, var(--panel)) !important;
  border:1px solid var(--accent) !important; border-radius:0 !important; }
.qmr-admit { border-color:var(--accent) !important; color:var(--accent2) !important; }
.qmr-err, .qmr-error, .qmr-mediafail, .qmg-dead {
  background:var(--dangerBg) !important; border:1px solid var(--dangerLine) !important;
  color:var(--dangerText) !important; border-radius:0 !important; }
.qmr-ok { background:color-mix(in srgb, var(--accent) 16%, var(--panel)) !important;
  border:1px solid var(--accent) !important; color:var(--accent2) !important; border-radius:0 !important; }

/* pre-join / guest lobby */
.qmr-prejoin { background:
  radial-gradient(900px 480px at 50% -10%, var(--glow), transparent 62%),
  repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 64px),
  repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 64px),
  var(--bg) !important; }
.qmr-card { background:var(--panel) !important; border:1px solid var(--line) !important;
  border-radius:0 !important; box-shadow:var(--shadow) !important;
  clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px); }
.qmr-card h1 { font-size:31px !important; line-height:1.1; font-weight:600;
  letter-spacing:-.02em; color:var(--text) !important; }
.qmr-input { background:var(--sunk) !important; color:var(--text) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important; }
.qmr-input:focus { border-color:var(--accent) !important; box-shadow:0 0 0 3px var(--glow) !important; }
.qmr-primary { background:var(--accent) !important; color:var(--onAccent) !important;
  border:1px solid var(--accent) !important; border-radius:0 !important;
  font-size:12.5px !important; letter-spacing:.1em; text-transform:uppercase; font-weight:600;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px); }
.qmr-primary:hover:not(:disabled) { background:var(--accentBright) !important; }
.qmr-consent { border-top:1px solid var(--line2) !important; }
.qmr-consent-lead { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:11px !important; letter-spacing:.14em; text-transform:uppercase;
  color:var(--warn) !important; }
.qmr-consent-fine, .qmr-when { color:var(--muted) !important; }
.qmr-check input { accent-color:var(--accent); }
.qmr-knock { background:color-mix(in srgb, var(--accent) 14%, var(--panel)) !important;
  border:1px solid var(--accent) !important; color:var(--accent2) !important; border-radius:0 !important; }
.qmr-knockno { background:var(--dangerBg) !important; border-color:var(--dangerLine) !important;
  color:var(--dangerText) !important; }
.qmr-knockdot { background:var(--accent2) !important; }

/* captions + reactions */
.qmr-ccbar { background:color-mix(in srgb, var(--bg) 82%, transparent) !important;
  border:1px solid var(--line) !important; border-radius:0 !important; backdrop-filter:blur(8px); }
.qmr-ccwho { font-family:"IBM Plex Mono", ui-monospace, monospace;
  color:var(--accent2) !important; letter-spacing:.08em; }
.qmr-ccdraft { color:var(--muted) !important; }
.qmr-cchead { font-family:"IBM Plex Mono", ui-monospace, monospace;
  color:var(--accent2) !important; letter-spacing:.18em; text-transform:uppercase; }
.qmr-ccat { font-family:"IBM Plex Mono", ui-monospace, monospace; color:var(--dim) !important; }
.qmr-reactdock, .qmr-reactmenu { background:var(--panel) !important;
  border:1px solid var(--line) !important; border-radius:0 !important; }
.qmr-reactbtn:hover { background:var(--sunk) !important; }
.qmr-heldpill, .qmr-hand, .qmr-brb { background:color-mix(in srgb, var(--accent) 16%, var(--panel)) !important;
  border:1px solid var(--accent) !important; color:var(--accent2) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.1em; }

/* device check + media guard */
.qmd-prev { background:linear-gradient(150deg,var(--tile),var(--sunk)) !important;
  border:1px solid var(--line) !important; border-radius:0 !important; }
.qmd-t { background:color-mix(in srgb, var(--bg) 74%, transparent) !important;
  border:1px solid var(--fieldline) !important; color:var(--text2) !important;
  border-radius:0 !important; font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.1em; text-transform:uppercase; }
.qmd-ton { background:var(--sunk) !important; border-color:var(--accent) !important;
  color:var(--accent2) !important; }
.qmd-bar { background:var(--rail) !important; border-radius:0 !important; }
.qmd-lit { background:var(--accent2) !important; }
.qmd-say { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.12em; text-transform:uppercase;
  color:var(--muted) !important; }
.qmd-good { color:var(--accent2) !important; }
.qmd-bad { color:var(--danger) !important; }
.qmd-err { background:var(--dangerBg) !important; border:1px solid var(--dangerLine) !important;
  color:var(--dangerText) !important; border-radius:0 !important; }
.qmd-retry { background:transparent !important; border:1px solid var(--dangerLine) !important;
  color:var(--dangerText) !important; border-radius:0 !important;
  text-transform:uppercase; letter-spacing:.1em; font-size:10.5px !important; }
.qmd-note { background:var(--warnBg) !important; border:1px solid var(--warnLine) !important;
  color:var(--warn) !important; border-radius:0 !important; }
.qmd-pick { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10px !important; letter-spacing:.2em; text-transform:uppercase; color:var(--dim) !important; }
.qmd-pick select, .qmg-pick select { background:var(--sunk) !important; color:var(--text) !important;
  border:1px solid var(--fieldline) !important; border-radius:0 !important;
  font-family:inherit; text-transform:none; letter-spacing:0; }
.qmd-test { background:transparent !important; border:1px solid var(--fieldline) !important;
  color:var(--text2) !important; border-radius:0 !important;
  text-transform:uppercase; letter-spacing:.1em; font-size:10.5px !important; }
.qmg-panel { background:var(--panel) !important; border:1px solid var(--line) !important;
  border-radius:0 !important;
  clip-path:polygon(11px 0,100% 0,100% calc(100% - 11px),calc(100% - 11px) 100%,0 100%,0 11px); }
.qmg-alert { background:var(--warnBg) !important; border:1px solid var(--warnLine) !important;
  color:var(--warn) !important; border-radius:0 !important; }
.qmg-bar, .qmg-mbar { background:var(--rail) !important; border-radius:0 !important; }
.qmg-lit, .qmg-mlit { background:var(--accent2) !important; }
.qmg-mlabel, .qmg-note { font-family:"IBM Plex Mono", ui-monospace, monospace;
  font-size:10.5px !important; letter-spacing:.08em; color:var(--muted) !important; }
.qmg-blur { background:transparent !important; border:1px solid var(--fieldline) !important;
  color:var(--text2) !important; border-radius:0 !important;
  text-transform:uppercase; letter-spacing:.1em; font-size:11px !important; }
.qmg-blur:hover { border-color:var(--accent) !important; color:var(--accent2) !important; }

/* LiveKit's own conference chrome, brought into the same language */
[data-lk-theme] { --lk-bg:var(--bg); --lk-bg2:var(--panel); --lk-bg3:var(--sunk);
  --lk-fg:var(--text); --lk-accent-bg:var(--accent); --lk-accent-fg:var(--onAccent);
  --lk-border-color:var(--line); --lk-control-bg:var(--panel);
  --lk-control-hover-bg:var(--sunk); --lk-control-fg:var(--text2);
  --lk-danger:var(--danger); --lk-success:var(--accent); }
.lk-participant-tile { border:1px solid var(--line) !important; border-radius:0 !important;
  background:linear-gradient(150deg,var(--tile),var(--sunk)) !important; overflow:hidden; }
.lk-participant-tile[data-lk-speaking="true"] { border-color:var(--accent) !important;
  box-shadow:0 0 0 1px var(--accent), 0 0 24px var(--glow) !important; }
.lk-participant-metadata-item { background:color-mix(in srgb, var(--bg) 74%, transparent) !important;
  border:1px solid var(--line) !important; border-radius:0 !important;
  font-family:"IBM Plex Mono", ui-monospace, monospace !important;
  font-size:10.5px !important; letter-spacing:.1em; color:var(--text2) !important; }
.lk-button, .lk-disconnect-button { border-radius:0 !important;
  font-family:inherit !important; font-size:11.5px !important;
  letter-spacing:.1em; text-transform:uppercase; border:1px solid var(--fieldline) !important; }
.lk-button:hover { border-color:var(--accent) !important; }
.lk-button[data-lk-enabled="true"] { background:var(--accent) !important; color:var(--onAccent) !important; }
.lk-disconnect-button { background:var(--dangerBg) !important; color:var(--dangerText) !important;
  border-color:var(--dangerLine) !important; }
.lk-control-bar { background:var(--panel) !important; border-top:1px solid var(--line2) !important; }
.lk-chat { background:var(--panel) !important; border-left:1px solid var(--line) !important; }
.lk-chat-entry, .lk-chat-form-input { border-radius:0 !important; }
.lk-form-control { background:var(--sunk) !important; border:1px solid var(--fieldline) !important;
  border-radius:0 !important; color:var(--text) !important; }
`;
