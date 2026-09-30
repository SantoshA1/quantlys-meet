/**
 * MAYA GUARD — can an unsigned guest mint a room token?
 *
 * Maya asks: "The README said set ALLOW_GUEST_JOIN=false after the test.
 * Does that actually stop a stranger with the link, or is the flag only
 * written in the docs?"
 *
 * FIELD 2026-09-30: .env.example and README advertised ALLOW_GUEST_JOIN /
 * NEXT_PUBLIC_ALLOW_GUEST_JOIN, but no route read them. Guests always
 * entered. This module is the gate the token routes call.
 *
 * Run: node lib/guest-join.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  envFlagOn, guestJoinAllowed, guestJoinUiAllowed, GUEST_JOIN_CLOSED,
} from "./guest-join.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

ok(envFlagOn(undefined, true) === true, "unset with default ON stays open");
ok(envFlagOn(undefined, false) === false, "unset with default OFF stays closed");
ok(envFlagOn("", true) === true, "blank string follows the default");
ok(envFlagOn("true") === true, "true opens");
ok(envFlagOn("1") === true, "1 opens");
ok(envFlagOn("ON") === true, "ON is case-insensitive");
ok(envFlagOn("yes") === true, "yes opens");
ok(envFlagOn("false") === false, "false closes");
ok(envFlagOn("0") === false, "0 closes");
ok(envFlagOn("OFF") === false, "OFF closes");
ok(envFlagOn("no") === false, "no closes");
ok(envFlagOn("  false  ") === false, "whitespace around the value is ignored");
ok(envFlagOn("maybe", true) === true, "unknown values fall back to the default");

ok(guestJoinAllowed({}) === true,
  "product default: guests are allowed when the env was never set");
ok(guestJoinAllowed({ ALLOW_GUEST_JOIN: "false" }) === false,
  "ALLOW_GUEST_JOIN=false closes unsigned guest token mint");
ok(guestJoinAllowed({ ALLOW_GUEST_JOIN: "true" }) === true,
  "ALLOW_GUEST_JOIN=true keeps the link-join path open");

ok(guestJoinUiAllowed({}) === true, "UI default matches the server default");
ok(guestJoinUiAllowed({ NEXT_PUBLIC_ALLOW_GUEST_JOIN: "false" }) === false,
  "public mirror alone can hide the landing guest card");
ok(guestJoinUiAllowed({ ALLOW_GUEST_JOIN: "false" }) === false,
  "UI falls back to the server flag when the public mirror is unset");
ok(guestJoinUiAllowed({
  ALLOW_GUEST_JOIN: "true",
  NEXT_PUBLIC_ALLOW_GUEST_JOIN: "false",
}) === false,
  "when both are set, the public mirror wins for UI (keep them in sync in prod)");

ok(/ALLOW_GUEST_JOIN/.test(GUEST_JOIN_CLOSED) && /Sign in/.test(GUEST_JOIN_CLOSED),
  "the 403 copy names the flag and tells the guest to sign in");

const roomTok = readFileSync(new URL("../app/api/room/token/route.ts", import.meta.url), "utf8");
const liveTok = readFileSync(new URL("../app/api/livekit/token/route.ts", import.meta.url), "utf8");
ok(/guestJoinAllowed/.test(roomTok) && /GUEST_JOIN_CLOSED/.test(roomTok),
  "app/api/room/token reads guestJoinAllowed and returns GUEST_JOIN_CLOSED");
ok(/guestJoinAllowed/.test(liveTok) && /GUEST_JOIN_CLOSED/.test(liveTok),
  "app/api/livekit/token reads guestJoinAllowed for unsigned guests");
ok(/ALLOW_GUEST_JOIN=true/.test(readFileSync(new URL("../.env.example", import.meta.url), "utf8")),
  ".env.example documents ALLOW_GUEST_JOIN with product-default true");
ok(/SantoshA1\/quantlys-meet/.test(readFileSync(new URL("../README.md", import.meta.url), "utf8")),
  "README Deploy button points at SantoshA1/quantlys-meet, not YOUR_ORG");
ok(/npm test/.test(readFileSync(new URL("../README.md", import.meta.url), "utf8")) &&
   /two browser tabs/.test(readFileSync(new URL("../README.md", import.meta.url), "utf8")),
  "README has an explicit local smoke path including npm test and 2-tab join");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
