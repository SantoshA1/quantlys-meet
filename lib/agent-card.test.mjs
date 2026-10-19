// node --experimental-strip-types lib/agent-card.test.mjs
import { readFileSync } from "node:fs";
import { cardPlacement, CARD_FOOT } from "./agent-card.ts";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };

for (const [w, h, head] of [[1280, 720, 110], [1600, 900, 64], [2560, 1440, 64], [390, 844, 170]]) {
  const p = cardPlacement(head, w, h);
  ok(p.top > head, `${w}x${h}: card starts below the header (${p.top} > ${head})`);
  ok(p.top + p.maxHeight <= h - CARD_FOOT, `${w}x${h}: card ends above the control bar`);
  const width = p.width ?? (w - p.left - (p.right ?? 0));
  ok(p.left >= 8 && p.left + width <= w - 8, `${w}x${h}: card is fully inside the viewport horizontally`);
}
ok(cardPlacement(123, 1280, 720, 191).top === 199, "a two-row gaps strip pushes the card below it");
ok(cardPlacement(123, 1600, 900, 160).top === 183, "a one-row strip leaves the default offset");
ok(cardPlacement(64, 390, 844).right === 8, "phones get a full-width card");
ok(cardPlacement(64, 1280, 720).width === 380, "desktop keeps the 380px card");
ok(cardPlacement(64, 1280, 300).maxHeight >= 160, "short windows keep a usable card that scrolls");

// Wiring: the CSS must be viewport-fixed and the card must use the placement.
const agent = readFileSync(new URL("../app/room/[room]/Agent.tsx", import.meta.url), "utf8");
ok(/\.qa-card \{ position:fixed;/.test(agent), "the card is position:fixed (not absolute inside the header)");
ok(/\.qa-status \{ position:fixed;/.test(agent), "so is the agent's status box");
ok(/cardPlacement\(/.test(agent), "Agent places the card with cardPlacement");
ok(/overflow-y:auto/.test(agent.slice(agent.indexOf(".qa-card {"), agent.indexOf(".qa-head"))), "a tall card scrolls inside itself");
ok(/overflow-x:hidden/.test(agent) && /\.qa-opt \{[^}]*white-space:normal/.test(agent), "long answer options wrap instead of scrolling sideways");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
