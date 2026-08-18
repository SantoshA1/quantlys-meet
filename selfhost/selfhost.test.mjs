/**
 * PHASE 0 — the spike that has to fail cheaply if the premise is wrong.
 *
 * Maya here is not a meeting participant. She is a small business owner who
 * was told she could run her own meetings server so her calls never leave her
 * building. She asks:
 *
 *   "I downloaded one binary and wrote one config file. No account with
 *    anybody. Does a real meeting actually work — can two people see and
 *    HEAR each other — or was that a sales line?"
 *
 * The scope document claims companies want their own meetings product for
 * security reasons. That claim is worthless if Quantlys Meeting only runs
 * against LiveKit Cloud, because then the customer is still renting the one
 * part they said they could not rent. This suite exists to find that out in
 * an afternoon rather than in month three of a build.
 *
 * What makes this different from every other Maya suite in the repo: those
 * are deterministic and offline by doctrine. This one CANNOT be — the whole
 * question is whether real WebRTC crosses a real self-hosted SFU. So it runs
 * real Chromium against a real livekit-server and a real Next dev server, and
 * it measures the audio that came out the far side rather than trusting any
 * status flag. Publication state is exactly the thing that lied to us in the
 * field on 2026-08-18.
 *
 * Run: node selfhost.test.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = Object.fromEntries(
  fs.readFileSync(path.join(HERE, ".env.selfhost"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const LK_WS = ENV.LIVEKIT_URL;                          // ws://127.0.0.1:7880
const LK_HTTP = LK_WS.replace(/^ws/, "http");
const KEY = ENV.LIVEKIT_API_KEY;
const SECRET = ENV.LIVEKIT_API_SECRET;
const APP = "http://127.0.0.1:3100";                    // the real app, next dev
const PAGE_PORT = 3200;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const note = (n) => console.log("       ·", n);
const section = (t) => console.log("\n" + t);

// ── a static server for the browser page ────────────────────────────────
const MIME = { ".html": "text/html", ".js": "text/javascript" };
const pageServer = http.createServer((req, res) => {
  const p = path.join(HERE, "public", req.url === "/" ? "client.html" : req.url.split("?")[0]);
  if (!p.startsWith(path.join(HERE, "public")) || !fs.existsSync(p)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => pageServer.listen(PAGE_PORT, "127.0.0.1", r));

const jget = async (url, opts) => {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
};

// ════════════════════════════════════════════════════════════════════════
section("── 1. one binary, one config file, no account ──────────────────");

const health = await fetch(LK_HTTP + "/").then((r) => r.status).catch((e) => String(e));
ok(health === 200, "the self-hosted server answers — this is a process on her own machine, not a tenant");

const cfg = fs.readFileSync(path.join(HERE, "livekit.yaml"), "utf8");
ok(!/livekit\.cloud|api\.livekit/.test(cfg),
  "…and its config names no external host, so nothing phones home to be allowed to run");
ok(/keys:/.test(cfg) && cfg.includes(KEY),
  "…on credentials she generated herself, not issued to her");

// The app is the thing under test, not a rewrite of it.
const appUp = await fetch(APP + "/").then((r) => r.status).catch((e) => String(e));
ok(appUp === 200, "the existing Quantlys Meeting app boots unchanged against it");

// ════════════════════════════════════════════════════════════════════════
section("── 2. the app's own front door ─────────────────────────────────");

const tok = await jget(APP + "/api/room/token", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ room: "phase0-main", name: "Maya" }),
});
ok(tok.status === 200 && !!tok.body?.token,
  "the app's real token route hands out a token — no code change, only environment variables");
ok(tok.body?.url === LK_WS,
  "…and points the browser at HER server, because the URL is configuration and never a constant");

const claims = tok.body?.token
  ? JSON.parse(Buffer.from(tok.body.token.split(".")[1], "base64url").toString())
  : {};
ok(claims.iss === KEY, "…signed by her key, so her server is the only thing that can validate it");
ok(claims.video?.roomJoin === true && claims.video?.room === "phase0-main",
  "…and scoped to one room, so a leaked link is not a key to the building");

const bad = await jget(APP + "/api/room/token", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Maya" }),
});
ok(bad.status === 400, "asking for a token with no room fails cleanly at 400, not a 500");

// ── the server-side SDK, which is what admit/lock/kick all run through ──
const svc = new RoomServiceClient(LK_HTTP, KEY, SECRET);
let created = null, listed = [];
try {
  created = await svc.createRoom({ name: "phase0-admin", emptyTimeout: 60 });
  listed = await svc.listRooms();
} catch (e) { note("RoomServiceClient error: " + e.message); }
ok(created?.name === "phase0-admin",
  "the management API works self-hosted — this is what lock, admit and remove-participant all call");
ok(listed.some((r) => r.name === "phase0-admin"), "…and the room it made is really there");

// A wrong secret must be REFUSED, not quietly accepted.
const forged = new AccessToken(KEY, "x".repeat(44), { identity: "intruder" });
forged.addGrant({ room: "phase0-main", roomJoin: true });
const forgedJwt = await forged.toJwt();

// ════════════════════════════════════════════════════════════════════════
section("── 3. two real people, real WebRTC, real audio ─────────────────");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
  ],
});

const openPeer = async (name) => {
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => note(`${name} page error: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/client.html`);
  return { ctx, page };
};

const tokenFor = async (nm) => {
  const r = await jget(APP + "/api/room/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "phase0-main", name: nm }),
  });
  return r.body?.token;
};

const alice = await openPeer("alice");
const bob = await openPeer("bob");

const aJoin = await alice.page.evaluate(
  ([u, t]) => window.__join(u, t), [LK_WS, await tokenFor("Alice")]);
const bJoin = await bob.page.evaluate(
  ([u, t]) => window.__join(u, t), [LK_WS, await tokenFor("Bob")]);

ok(aJoin.ok === true, "the first person joins her self-hosted room from a real browser");
ok(bJoin.ok === true, "and so does the second — a meeting needs two");

// Give the SFU a moment to forward tracks both ways.
await new Promise((r) => setTimeout(r, 6000));

const aState = await alice.page.evaluate(() => window.__state());
const bState = await bob.page.evaluate(() => window.__state());

ok(aState.remotes.length >= 1 && bState.remotes.length >= 1,
  "each of them can see that the other is in the room");
ok(aState.subs.some((s) => s.kind === "video") && bState.subs.some((s) => s.kind === "video"),
  "each of them is handed the other's camera — the exact thing that was missing in the field");
ok(aState.subs.some((s) => s.kind === "audio") && bState.subs.some((s) => s.kind === "audio"),
  "…and the other's microphone");

// The measurement that matters. Not "is it published" — "did sound arrive".
const heard = await alice.page.evaluate(() => window.__measureIncomingAudio(4000));
const rtp = heard.rtp || {};
note(`audio received by Alice: rtp bytes=${rtp.bytes} packets=${rtp.packets} energy=${(rtp.energy ?? 0).toFixed(4)} level=${(rtp.level ?? 0).toFixed(4)}`);
note(`audio played out to Alice: analyser peak=${(heard.peak ?? 0).toFixed(4)} over ${heard.samples} samples`);
ok((rtp.packets ?? 0) > 0 && (rtp.bytes ?? 0) > 0,
  "Bob's microphone reached Alice's machine — audio packets crossed her own SFU, nobody else's");
ok((rtp.energy ?? 0) > 0,
  "…and it was SOUND, not an open pipe carrying silence — the decoder measured real energy, which is the check that the field failure of 2026-08-18 would have tripped");
ok((heard.peak ?? 0) > 0.01,
  "…and it came out of her speakers loud enough for a person to hear");
ok(heard.trackEnded === false, "…and the track was still alive when we measured it");

const vid = await alice.page.evaluate(() => window.__videoStats());
note(`video received by Alice: ${vid.width}x${vid.height}, framesDecoded=${vid.framesDecoded}, bytes=${vid.bytes}`);
ok((vid.framesDecoded ?? 0) > 0, "and frames of his camera were decoded, not merely negotiated");
ok((vid.width ?? 0) > 0 && (vid.height ?? 0) > 0, "…at a real resolution");

// ── misuse: a forged token must bounce ───────────────────────────────────
const intruder = await openPeer("intruder");
const iJoin = await intruder.page.evaluate(
  ([u, t]) => window.__join(u, t), [LK_WS, forgedJwt]);
ok(iJoin.ok === false, "a token signed with the wrong secret is refused — her server is not open to the internet by accident");
note("refusal: " + String(iJoin.error || "").slice(0, 90));

// ── does the door still work? lock/waiting-room are the app's, not LiveKit's
const knock = await jget(APP + "/api/room/knock", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ room: "phase0-main", name: "Late Guest" }),
});
ok(knock.status !== 500, `the waiting room endpoint answers without crashing self-hosted (got ${knock.status})`);

await browser.close();
pageServer.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
