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

/** A row of book spines: varied widths, heights, hues and a few leaning —
 *  regularity is what makes drawn shelves look drawn. */
function books(y: number, h: number, x0: number, x1: number, seed: number): string {
  const out: string[] = [];
  const hues = [18, 24, 200, 350, 40, 145, 12, 275, 32];
  let x = x0, i = seed;
  while (x < x1 - 8) {
    i = (i * 1103515245 + 12345) & 0x7fffffff;
    const w = 9 + (i % 16);
    const dh = (i >> 5) % 14;
    const hue = hues[(i >> 9) % hues.length];
    const lit = 24 + ((i >> 13) % 22);
    const lean = (i >> 17) % 11 === 0;
    const bh = h - dh;
    out.push(lean
      ? `<rect x="${x}" y="${y + dh}" width="${w}" height="${bh}" fill="hsl(${hue} 32% ${lit}%)" transform="rotate(6 ${x} ${y + h})"/>`
      : `<rect x="${x}" y="${y + dh}" width="${w}" height="${bh}" fill="hsl(${hue} 32% ${lit}%)"/>`);
    x += w + 2;
  }
  return out.join("");
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
    id: "office", label: "Office Cubicle", photo: "/backgrounds/office.jpg",
    drawn: svg(
      `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#eceae5"/><stop offset="100%" stop-color="#c4c0b9"/></linearGradient>` +
      `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#95a0ac"/><stop offset="100%" stop-color="#66707c"/></linearGradient>` +
      `<linearGradient id="p2" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#828d99"/><stop offset="100%" stop-color="#586270"/></linearGradient>` +
      `<radialGradient id="ceil" cx="46%" cy="-6%" r="72%">` +
      `<stop offset="0%" stop-color="#ffffff" stop-opacity=".7"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="deep" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="#000000" stop-opacity=".34"/><stop offset="100%" stop-color="#000000" stop-opacity="0"/></linearGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#w)"/>` +
      // the office CONTINUES past this cubicle — depth is what the flat
      // version was missing, and a wall with nothing behind it reads as paper
      `<rect x="360" y="120" width="230" height="470" fill="#b9b5ae"/>` +
      `<rect x="392" y="180" width="166" height="150" rx="4" fill="#dfe6ea"/>` +
      `<rect x="392" y="180" width="166" height="150" rx="4" fill="none" stroke="#9aa3ab" stroke-width="6"/>` +
      `<path d="M410 300 q40-60 66-18 q22-40 52-6" stroke="#5f7f9a" stroke-width="5" fill="none" opacity=".7"/>` +
      `<rect x="360" y="120" width="230" height="470" fill="url(#deep)"/>` +
      `<rect width="1280" height="330" fill="url(#ceil)"/>` +
      // near partitions, left and right, with the gap between them
      `<rect x="0" y="96" width="368" height="500" fill="url(#p)"/>` +
      `<rect x="582" y="112" width="360" height="484" fill="url(#p2)"/>` +
      `<rect x="936" y="86" width="344" height="510" fill="url(#p)"/>` +
      `<g opacity=".2">${Array.from({ length: 420 }, (_, k) => {
        const i = (k * 2654435761) & 0x7fffffff;
        return `<rect x="${i % 1280}" y="${86 + (i >> 7) % 510}" width="3" height="2" fill="#ffffff"/>`;
      }).join("")}</g>` +
      `<rect x="0" y="90" width="368" height="8" fill="#b6bec7"/>` +
      `<rect x="582" y="106" width="360" height="8" fill="#a7b0ba"/>` +
      `<rect x="936" y="80" width="344" height="8" fill="#b6bec7"/>` +
      // a shelf with the clutter every desk has
      `<rect x="70" y="300" width="250" height="12" fill="#8e9299"/>` +
      `<rect x="96" y="246" width="16" height="54" fill="#7a5f4a"/><rect x="114" y="252" width="13" height="48" fill="#4a6274"/>` +
      `<rect x="129" y="240" width="18" height="60" fill="#6d4550"/><rect x="149" y="258" width="12" height="42" fill="#5d6b46"/>` +
      `<rect x="200" y="262" width="70" height="38" rx="6" fill="#3f4650"/>` +
      // monitor, keyboard, desk
      `<rect x="0" y="596" width="1280" height="124" fill="#bda487"/>` +
      `<rect x="0" y="590" width="1280" height="9" fill="#dccbb2"/>` +
      `<rect x="852" y="316" width="330" height="212" rx="8" fill="#2e333a"/>` +
      `<rect x="864" y="328" width="306" height="188" rx="4" fill="#3a414a"/>` +
      `<rect x="992" y="528" width="52" height="58" fill="#3b424b"/>` +
      `<rect x="944" y="582" width="150" height="13" rx="5" fill="#3b424b"/>` +
      `<rect x="600" y="616" width="250" height="16" rx="4" fill="#2f343b" opacity=".8"/>` +
      // a plant with actual leaves
      `<rect x="216" y="520" width="92" height="76" rx="9" fill="#a8734f"/>` +
      `<rect x="212" y="512" width="100" height="16" rx="6" fill="#bd845c"/>` +
      `<path d="M262 516 q-8-70 -46-104 q10 74 46 104z" fill="#3c7a52"/>` +
      `<path d="M262 516 q10-84 54-108 q-16 78-54 108z" fill="#49916a"/>` +
      `<path d="M262 516 q-44-46 -34-96 q34 40 34 96z" fill="#2f6444"/>` +
      `<path d="M262 516 q52-30 56-84 q-40 34-56 84z" fill="#56a377"/>` +
      // a note, pinned crooked
      `<rect x="140" y="150" width="128" height="96" fill="#f4ecca" transform="rotate(-3 204 198)"/>` +
      `<g stroke="#c9c0a0" stroke-width="4" transform="rotate(-3 204 198)">` +
      `<path d="M156 182 h96"/><path d="M156 200 h96"/><path d="M156 218 h60"/></g>`
    ),
  },
  {
    id: "library", label: "Library", photo: "/backgrounds/library.jpg",
    drawn: svg(
      `<defs><linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#2a1f18"/><stop offset="100%" stop-color="#16100c"/></linearGradient>` +
      `<radialGradient id="lamp" cx="82%" cy="42%" r="46%">` +
      `<stop offset="0%" stop-color="#ffc978" stop-opacity=".55"/><stop offset="100%" stop-color="#ffc978" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#warm)"/>` +
      // three shelves of books, wood between
      `<rect x="0" y="90" width="1280" height="180" fill="#3a2a1e"/>` +
      books(100, 160, 20, 1260, 7) +
      `<rect x="0" y="266" width="1280" height="20" fill="#4a3527"/>` +
      `<rect x="0" y="286" width="1280" height="180" fill="#3a2a1e"/>` +
      books(296, 160, 20, 1260, 91) +
      `<rect x="0" y="462" width="1280" height="20" fill="#4a3527"/>` +
      `<rect x="0" y="482" width="1280" height="170" fill="#3a2a1e"/>` +
      books(492, 150, 20, 1260, 313) +
      `<rect x="0" y="648" width="1280" height="72" fill="#4a3527"/>` +
      `<rect width="1280" height="720" fill="url(#lamp)"/>`
    ),
  },
  {
    id: "loft", label: "Sunlit Loft", photo: "/backgrounds/loft.jpg",
    drawn: svg(
      `<defs><linearGradient id="brick" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#a5715a"/><stop offset="100%" stop-color="#7d5343"/></linearGradient>` +
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#dff0fb"/><stop offset="100%" stop-color="#f6e5c8"/></linearGradient>` +
      `<radialGradient id="sun" cx="26%" cy="26%" r="42%">` +
      `<stop offset="0%" stop-color="#fff3d0" stop-opacity=".85"/><stop offset="100%" stop-color="#fff3d0" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#brick)"/>` +
      `<g opacity=".22">${Array.from({ length: 22 }, (_, r) =>
        Array.from({ length: 18 }, (_, c) =>
          `<rect x="${c * 72 + (r % 2 ? 36 : 0)}" y="${r * 33}" width="68" height="29" fill="none" stroke="#f0d9cd" stroke-width="2"/>`
        ).join("")).join("")}</g>` +
      // industrial window, black mullions
      `<rect x="90" y="70" width="620" height="520" fill="url(#sky)"/>` +
      `<g fill="#20242a">` +
      `<rect x="80" y="60" width="640" height="14"/><rect x="80" y="576" width="640" height="14"/>` +
      `<rect x="80" y="60" width="14" height="530"/><rect x="706" y="60" width="14" height="530"/>` +
      `<rect x="290" y="60" width="9" height="530"/><rect x="500" y="60" width="9" height="530"/>` +
      `<rect x="80" y="240" width="640" height="9"/><rect x="80" y="410" width="640" height="9"/></g>` +
      `<rect width="1280" height="720" fill="url(#sun)"/>` +
      // light pooling on the floor
      `<rect x="0" y="600" width="1280" height="120" fill="#6b4b39"/>` +
      `<path d="M120 600 L640 600 L760 720 L60 720z" fill="#ffe9bd" opacity=".33"/>` +
      // a plant against the light
      `<path d="M980 600 q-50-140-8-230 q40 95 22 230z" fill="#2c4f39"/>` +
      `<path d="M980 600 q60-120 16-215 q-42 100-22 215z" fill="#39684a"/>` +
      `<rect x="940" y="596" width="86" height="70" rx="8" fill="#8d6a52"/>`
    ),
  },
  {
    id: "city", label: "City View", photo: "/backgrounds/city.jpg",
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
  {
    id: "lounge", label: "Cozy Lounge", photo: "/backgrounds/lounge.jpg",
    drawn: svg(
      `<defs><linearGradient id="wall2" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#4a3b39"/><stop offset="100%" stop-color="#2b211f"/></linearGradient>` +
      `<radialGradient id="glow" cx="76%" cy="34%" r="40%">` +
      `<stop offset="0%" stop-color="#ffb96b" stop-opacity=".6"/><stop offset="100%" stop-color="#ffb96b" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="1280" height="720" fill="url(#wall2)"/>` +
      // floor and rug
      `<rect x="0" y="560" width="1280" height="160" fill="#3b2b23"/>` +
      `<ellipse cx="560" cy="672" rx="470" ry="70" fill="#6b4f45" opacity=".65"/>` +
      // sofa, arm nearest the camera
      `<rect x="90" y="380" width="620" height="200" rx="26" fill="#6d5a52"/>` +
      `<rect x="120" y="330" width="230" height="120" rx="22" fill="#7b675e"/>` +
      `<rect x="370" y="330" width="230" height="120" rx="22" fill="#7b675e"/>` +
      `<rect x="60" y="400" width="80" height="180" rx="24" fill="#5d4c45"/>` +
      `<rect x="200" y="352" width="110" height="90" rx="16" fill="#9a7f62" transform="rotate(-8 255 397)"/>` +
      // floor lamp — the light source the whole scene is lit by
      `<rect x="1010" y="300" width="8" height="290" fill="#2a2320"/>` +
      `<path d="M960 300 h116 l-22-70 h-72z" fill="#e8c79a"/>` +
      `<rect width="1280" height="720" fill="url(#glow)"/>` +
      // a picture frame, slightly off-level
      `<rect x="760" y="150" width="150" height="190" fill="#241c1a" stroke="#5e4a41" stroke-width="8" transform="rotate(1.5 835 245)"/>`
    ),
  },
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
