/**
 * GUARD — integration credentials are encrypted at rest (AES-256-GCM).
 * Run: node --experimental-strip-types lib/integrations-crypto.test.mjs
 */
import { randomBytes } from "node:crypto";
import { parseKey, integrationsKey, encryptSecret, decryptSecret, aadFor, secretHint } from "./integrations-crypto.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const throws = (f) => { try { f(); return false; } catch { return true; } };

const raw = randomBytes(32);
ok(parseKey(raw.toString("base64"))?.equals(raw), "base64 key (openssl rand -base64 32)");
ok(parseKey(raw.toString("hex"))?.equals(raw), "hex key (openssl rand -hex 32)");
ok(parseKey(raw.toString("base64url"))?.equals(raw), "base64url key");
ok(parseKey("") === null && parseKey("short") === null && parseKey(randomBytes(16).toString("base64")) === null, "missing / short keys refused (Tier 2 stays hidden)");
ok(integrationsKey({}) === null && integrationsKey({ INTEGRATIONS_ENCRYPTION_KEY: raw.toString("base64") })?.length === 32, "read from INTEGRATIONS_ENCRYPTION_KEY");

const key = raw;
const secret = JSON.stringify({ provider: "github", token: "github_pat_" + "z".repeat(40) });
const aad = aadFor("user-1", "github");
const ct = encryptSecret(secret, key, aad);
ok(ct.startsWith("v1.") && ct.split(".").length === 4, "versioned format");
ok(!ct.includes("github_pat_") && !ct.includes("zzzz"), "no plaintext in the ciphertext");
ok(decryptSecret(ct, key, aad) === secret, "round trip");
ok(encryptSecret(secret, key, aad) !== ct, "fresh IV every time");
ok(throws(() => decryptSecret(ct, randomBytes(32), aad)), "wrong key fails");
ok(throws(() => decryptSecret(ct, key, aadFor("user-2", "github"))), "a row copied to another user fails");
ok(throws(() => decryptSecret(ct, key, aadFor("user-1", "jira"))), "a row relabelled to another provider fails");
const parts = ct.split(".");
const flip = (s) => { const b = Buffer.from(s, "base64url"); b[0] ^= 1; return b.toString("base64url"); };
ok(throws(() => decryptSecret([parts[0], parts[1], parts[2], flip(parts[3])].join("."), key, aad)), "tampered ciphertext fails");
ok(throws(() => decryptSecret([parts[0], parts[1], flip(parts[2]), parts[3]].join("."), key, aad)), "tampered tag fails");
ok(throws(() => decryptSecret("garbage", key, aad)) && throws(() => decryptSecret("v2.a.b.c", key, aad)), "junk fails");
ok(throws(() => encryptSecret("x", randomBytes(16), aad)), "refuses a short key");
ok(secretHint("github_pat_abcdefghijklmnop1234") === "…1234" && secretHint("short") === "…", "hint shows the last 4 only");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
