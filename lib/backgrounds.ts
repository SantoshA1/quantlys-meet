// The backdrops people actually want to sit in front of.
//
// FIELD 2026-08-20: "Nebula, Gridline, Dusk, Board room are showing same
// without any change… update with something realistic — Office Cubicle,
// Library, Sunlit Loft, City View, Cozy Lounge."
//
// (The "showing same" half was a compositing bug — see lib/effects.ts. This
// file is the other half: the four abstract gradients were not backgrounds
// anybody wanted to appear to be sitting in. A meeting backdrop has one job
// — look like a room you could plausibly be in — and a purple haze does not
// do that job however pretty it is.)
//
// TWO SOURCES, ONE SHELF. Each backdrop is a SLOT:
//
//   1. A real photograph at /backgrounds/<id>.jpg, if this deployment ships
//      one. Drop a file in that folder and it is picked up — no code change,
//      no rebuild of this list. That is the honest way to ship photographs:
//      whoever deploys owns the licence for the pictures they chose.
//   2. Otherwise a drawn scene, inline. Not a placeholder rectangle with a
//      label on it — an actual room, with perspective, a light source and
//      soft depth, so somebody who never adds a photo still gets something
//      that reads as a room behind them.
//
// Nothing here fetches from a CDN and nothing here ships a photograph of a
// real, identifiable place. A background that needs a network is a
// background that is sometimes not there.
//
// ZERO-IMPORT so it travels.

export type Slot = {
  id: string;
  label: string;
  /** shelf badge — Beta for photo replace until matte is rock-solid */
  badge?: string;
  /** where a real photo would live in this deployment */
  photo: string;
  /** the drawn room used until one does */
  drawn: string;
};

function svg(body: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">` +
    // Everything is drawn slightly soft. A backdrop in a real photograph is
    // never in perfect focus, and a razor-sharp wall behind a slightly soft
    // person is one of the tells that gives away a fake background.
    `<defs><filter id="dof" x="-5%" y="-5%" width="110%" height="110%">` +
    `<feGaussianBlur stdDeviation="2.2"/></filter></defs>` +
    `<g filter="url(#dof)">${body}</g></svg>`
  );
}

/** Lit and dark windows across a tower — a skyline with every window the
 *  same brightness reads as wallpaper. */
function windows(x: number, y: number, w: number, h: number, seed: number): string {
  const out: string[] = [];
  let i = seed;
  for (let yy = y + 8; yy < y + h - 10; yy += 22) {
    for (let xx = x + 7; xx < x + w - 10; xx += 18) {
      i = (i * 1103515245 + 12345) & 0x7fffffff;
      const on = i % 5 > 1;
      out.push(`<rect x="${xx}" y="${yy}" width="9" height="12" fill="${on ? `hsl(44 80% ${52 + (i >> 7) % 22}%)` : "#0d1420"}" opacity="${on ? 0.9 : 0.7}"/>`);
    }
  }
  return out.join("");
}

export const SLOTS: Slot[] = [
  {
    id: "city", label: "Glass dusk", badge: "Beta", photo: "/backgrounds/city.jpg",
    drawn: svg(
      `<defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#141d33"/><stop offset="52%" stop-color="#3a3550"/>` +
      `<stop offset="100%" stop-color="#8a5a54"/></linearGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#dusk)"/>` +
      // far towers, then near ones — depth by value, not by outline
      `<g opacity=".55" fill="#1b2438">` +
      `<rect x="60" y="300" width="120" height="420"/><rect x="220" y="250" width="90" height="470"/>` +
      `<rect x="1080" y="270" width="130" height="450"/></g>` +
      `<g fill="#141b2b">` +
      `<rect x="150" y="360" width="150" height="360"/><rect x="330" y="240" width="180" height="480"/>` +
      `<rect x="540" y="330" width="140" height="390"/><rect x="700" y="200" width="165" height="520"/>` +
      `<rect x="890" y="300" width="150" height="420"/></g>` +
      windows(330, 240, 180, 480, 5) + windows(700, 200, 165, 520, 61) +
      windows(150, 360, 150, 360, 907) + windows(890, 300, 150, 420, 41) +
      windows(540, 330, 140, 390, 733) +
      // the window we are looking through
      `<g fill="#161a20" opacity=".96">` +
      `<rect x="0" y="0" width="1280" height="40"/><rect x="0" y="680" width="1280" height="40"/>` +
      `<rect x="0" y="0" width="46" height="720"/><rect x="1234" y="0" width="46" height="720"/>` +
      `<rect x="624" y="0" width="26" height="720"/></g>` +
      `<rect x="46" y="40" width="1188" height="640" fill="#7fb0e0" opacity=".05"/>`
    ),
  },
];


/** Living loops — short muted seamless videos composited with the same edge
 *  pipeline as stills. Ship under public/backgrounds/; the shelf only offers
 *  a loop when its file is actually present (same probe as photographs). */
export type LoopSlot = {
  id: string;
  label: string;
  /** shelf badge — Beta for loop replace until matte is rock-solid */
  badge?: string;
  /** muted seamless loop (webm preferred) */
  loop: string;
  /** still used for the swatch and as a degrade target */
  poster: string;
};

export const LOOPS: LoopSlot[] = [
  { id: "citylights", label: "Loop City", badge: "Beta", loop: "/backgrounds/citylights.webm", poster: "/backgrounds/citylights.jpg" },
];

/** The custom slot: a person's OWN picture, added in the panel. It is not in
 *  SLOTS because it has no drawn fallback — an empty custom slot is an empty
 *  camera frame with an invitation in it, not a room. */
export const CUSTOM_ID = "custom";

/** What a person sees in the shelf before they have added their own picture:
 *  an obvious, friendly placeholder rather than a fifth room they did not
 *  choose. Drawn, not photographed — see the file header on why. */
export const CUSTOM_PLACEHOLDER = svg(
  `<rect width="1280" height="720" fill="#1a1f27"/>` +
  `<rect x="40" y="40" width="1200" height="640" rx="24" fill="none" stroke="#39424f" stroke-width="6" stroke-dasharray="26 20"/>` +
  `<g transform="translate(640 340)" fill="none" stroke="#7c8899" stroke-width="14" stroke-linejoin="round" stroke-linecap="round">` +
  `<path d="M-150 -60 h70 l26-34 h108 l26 34 h70 a20 20 0 0 1 20 20 v130 a20 20 0 0 1 -20 20 h-300 a20 20 0 0 1 -20-20 v-130 a20 20 0 0 1 20-20z"/>` +
  `<circle cx="0" cy="35" r="58"/></g>`
);

/** Which picture a slot should actually try. The photo wins when this
 *  deployment has one; the drawn room is what happens otherwise. The caller
 *  loads `photo` first and falls back — the decision is here so it is one
 *  rule with one guard, not an if-statement in a render loop. */
export function sourcesFor(slot: Slot): string[] {
  if (!slot) return [];
  return [slot.photo, slot.drawn].filter(Boolean);
}

/** A picture somebody added themselves. Only data: URLs — a background is
 *  fetched by a canvas that must stay untainted, and a remote URL both taints
 *  it and reaches the network for something that is meant to be private. */
export function acceptCustom(dataUrl: string, maxBytes = 4_000_000): { ok: boolean; why: string } {
  const s = String(dataUrl || "");
  if (!s.startsWith("data:image/")) {
    return { ok: false, why: "Choose an image file — a JPEG or PNG from your own computer." };
  }
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(s)) {
    return { ok: false, why: "That image format can't be used as a background. JPEG, PNG or WebP work." };
  }
  // base64 is 4 characters per 3 bytes
  const bytes = Math.floor((s.length - s.indexOf(",") - 1) * 0.75);
  if (bytes > maxBytes) {
    return { ok: false, why: "That picture is very large. Something under 4 MB loads instantly and looks the same behind you." };
  }
  return { ok: true, why: "" };
}
