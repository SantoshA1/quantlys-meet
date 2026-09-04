/**
 * MAYA GUARD — starting a meeting must not depend on crypto.randomUUID.
 *
 * Older Safari throws on randomUUID; the host Start button stuck on STARTING…
 * and left the person on /host ("won't let me host").
 *
 * Run: node lib/ids.test.mjs
 */
import { readFileSync } from "node:fs";
import { newRoomId, randomHex } from "./ids.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const host = code("../app/host/page.tsx");
const fullHost = read("../app/host/page.tsx");

ok(/^qm-[0-9a-f]{12}$/.test(newRoomId()),
  "newRoomId is qm- + 12 hex");
ok(newRoomId("room-").startsWith("room-") && newRoomId("room-").length === "room-".length + 12,
  "prefix is honoured");
const a = newRoomId(), b = newRoomId();
ok(a !== b, "two ids in a row are different");
ok(randomHex(8).length === 8 && /^[0-9a-f]+$/.test(randomHex(8)),
  "randomHex returns the asked length");

// Survive without randomUUID (the Safari case).
const had = crypto.randomUUID;
try {
  // @ts-ignore
  crypto.randomUUID = undefined;
  const id = newRoomId();
  ok(/^qm-[0-9a-f]{12}$/.test(id),
    "without crypto.randomUUID, newRoomId still returns qm- + 12 hex");
} finally {
  crypto.randomUUID = had;
}

ok(/newRoomId\(\)/.test(host) && /from "@\/lib\/ids"/.test(host),
  "host console creates rooms through newRoomId");
ok(!/crypto\.randomUUID/.test(host),
  "host console never calls crypto.randomUUID bare");
ok(/position:\s*sticky/.test(fullHost) && /\.qh-launch/.test(fullHost),
  "Launch panel is sticky so Start stays visible above the PRD");
ok(/START SPEC SESSION/.test(fullHost) && /<Prd/.test(host),
  "NEGATIVE: Prd panel is still on the page — sticky Launch does not remove it");
ok(/clipboard is a nicety|never a blocker|not a blocker/.test(fullHost),
  "clipboard failure still never blocks Start");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
