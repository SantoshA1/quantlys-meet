import { launch, join, check, results, until } from "./lib.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Deepgram + its token endpoint, mocked per page.
function dgMock() {
  const m = { tokenCalls: 0, tokenMode: "deepgram", conns: 0, live: new Set(), all: [] };
  m.route = async (p) => {
    await p.route("**/api/captions/token", async (r) => {
      m.tokenCalls++;
      if (m.tokenMode === "429") return r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many requests" }) });
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "deepgram", token: `fake-${m.tokenCalls}`, scheme: "token" }) });
    });
    await p.routeWebSocket(/api\.deepgram\.com/, (ws) => {
      m.conns++;
      m.live.add(ws);
      m.all.push(ws);
      ws.onMessage(() => {});
      ws.onClose(() => m.live.delete(ws));
      setTimeout(() => { try { ws.send(JSON.stringify({ is_final: true, channel: { alternatives: [{ transcript: `hello ${m.conns}` }] } })); } catch {} }, 300);
    });
  };
  m.serverClose = () => { for (const ws of [...m.live]) { m.live.delete(ws); ws.close({ code: 1011, reason: "sim" }); } };
  return m;
}
const vis = (p, v) => p.evaluate((v) => window.__setVis(v), v);
const ccOn = async (p, dg) => { await p.getByRole("button", { name: /^captions$/i }).first().click(); await until(() => dg.live.size >= 1, 15000); await wait(500); };
// Contexts that read a microphone (the app's meters). LiveKit's own are not
// ours: its webAudioMix is off (remote audio plays through <audio>) and its
// iOS startAudio context only feeds a silent dummy element.
const ours = (p) => p.evaluate(() => window.__acs.filter((a) => a.__mic && a.state !== "closed").map((a) => `${a.state}/${a.__resumes ?? "-"}${a.state === "running" ? "" : " @" + (a.__made || "").slice(0, 160)}`));
const note = (p) => p.evaluate(() => document.querySelector('[aria-pressed][title]')?.getAttribute("title") || "");

// ═══════════ DESKTOP (Chromium): behaviour unchanged, recovery works ═══════════
{
  console.log("\n── Chromium desktop ──");
  const { b, ctx } = await launch("chromium");
  const dg = dgMock();
  const p = await join(ctx, "Dana", "simdesk", { route: dg.route });
  const obs = await join(ctx, "Olive", "simdesk");
  check((await p.evaluate(() => window.__wl.req)) === 0, "desktop: no wake lock taken");
  await ccOn(p, dg);
  check(dg.conns === 1 && dg.live.size === 1, "desktop: captions on → one Deepgram socket", `conns=${dg.conns}`);
  const l0 = await p.evaluate(() => ({ ...window.__listeners }));

  // hidden → visible
  await vis(p, "hidden"); await wait(4000);
  check((await obs.locator(".qmr-awaytag").count()) === 0, "desktop: a background tab is NOT tagged 'phone locked'");
  await vis(p, "visible"); await wait(1500);
  check(dg.conns === 1, "desktop: a tab coming back does not restart captions", `conns=${dg.conns}`);

  // Deepgram closes → reconnect with a fresh key
  const t0 = dg.tokenCalls;
  dg.serverClose(); await until(() => dg.live.size === 1 && dg.conns === 2, 10000); await wait(1500);
  check(dg.conns === 2 && dg.live.size === 1 && dg.tokenCalls === t0 + 1, "desktop: Deepgram socket closed by server → one reconnect with a fresh key", `conns=${dg.conns} live=${dg.live.size} tokens=${dg.tokenCalls - t0}`);
  check(!/browser's own recogniser/.test(await note(p)), "desktop: still on Deepgram (no permanent fallback)");

  // storm
  for (let i = 0; i < 25; i++) { await vis(p, i % 2 ? "visible" : "hidden"); }
  await vis(p, "visible"); await wait(2000);
  const l1 = await p.evaluate(() => ({ ...window.__listeners }));
  check(dg.live.size === 1, "desktop: 25-event visibility storm → still exactly one live socket", `live=${dg.live.size}`);
  check(l1.visibilitychange === l0.visibilitychange && l1.pageshow === l0.pageshow, "desktop: no listener growth from the storm", JSON.stringify({ l0, l1 }));

  // AudioContexts: suspended (real) and interrupted (stub)
  await p.evaluate(async () => { for (const ac of window.__acs) if (ac.state === "running") await ac.suspend(); });
  await vis(p, "hidden"); await vis(p, "visible"); await wait(1200);
  const st = await ours(p);
  check(st.length > 0 && st.every((s) => s.startsWith("running")), "desktop: the app's suspended AudioContexts are running again after the return", st.join(","));
  check((await p.evaluate(() => window.__acs.filter((a) => a.__mic && a.state !== "closed").length)) === st.length && st.length === 1, "desktop: the device check's preview meter was closed on join (only MediaGuard's meter is open)", st.length + " open");
  const n = await p.evaluate(() => window.__interrupt());
  await vis(p, "hidden"); await vis(p, "visible"); await wait(1200);
  const rs = await ours(p);
  check(n > 0 && rs.every((s) => s.startsWith("running")), "desktop: the app's 'interrupted' AudioContexts are resumed on return", rs.join(","));

  // token endpoint rate-limited: bounded, then fallback
  dg.tokenMode = "429";
  const t1 = dg.tokenCalls, c1 = dg.conns;
  dg.serverClose(); await until(async () => /kept dropping/i.test(await note(p)), 30000, 500);
  // One of the 4 was spent by the earlier drop: the count only resets after a socket stays up 15s.
  check(dg.tokenCalls - t1 === 3, "desktop: 429 from the token endpoint → backed-off tries until DG_MAX_RECONNECTS (4, one already spent) then stop", `token calls=${dg.tokenCalls - t1}`);
  check(dg.conns === c1 && dg.live.size === 0, "desktop: no sockets opened while rate-limited");
  check(/kept dropping|browser/i.test(await note(p)), "desktop: then falls back to the browser recogniser, and says so", await note(p));
  const t2 = dg.tokenCalls; await wait(8000);
  check(dg.tokenCalls === t2, "desktop: and stops asking (no loop)");
  await b.close();
}

// ═══════════ DESKTOP mic ENDED (baseline: same result on main 326969d) ═══════════
{
  console.log("\n── Chromium desktop: published mic ends (compare with main) ──");
  const { b, ctx } = await launch("chromium");
  const p = await join(ctx, "Dana", "simdeskmic");
  const g0 = await p.evaluate(() => window.__gum.audio);
  await p.evaluate(() => { const t = window.__gum.tracks.filter((t) => t.kind === "audio" && t.readyState === "live").pop(); t.stop(); t.dispatchEvent(new Event("ended")); });
  await wait(3000);
  const g1 = await p.evaluate(() => window.__gum.audio);
  check(g1 >= g0 + 1, "desktop: an ended microphone is re-acquired", `gUM ${g0}→${g1}`);
  await wait(9000);
  const g2 = await p.evaluate(() => ({ a: window.__gum.audio, live: window.__gum.tracks.filter((t) => t.kind === "audio" && t.readyState === "live").length }));
  console.log(`  info - KNOWN, pre-existing (identical on main): restart chain after an ended mic, gUM ${g1}→${g2.a} over 9s, live=${g2.live}`);
  await b.close();
}

// ═══════════ iPHONE (WebKit, iPhone 15 profile) ═══════════
{
  console.log("\n── WebKit iPhone ──");
  const { b, ctx } = await launch("webkit");
  const { b: b2, ctx: ctx2 } = await launch("chromium");
  const dg = dgMock();
  const p = await join(ctx, "Iris", "simios", { route: dg.route });
  const obs = await join(ctx2, "Olive", "simios");
  check(await p.locator(".qmr-locknote").isVisible(), "iPhone: one-time lock notice shown in the room");
  check((await p.evaluate(() => localStorage.getItem("qm.iosLockNotice"))) === "1", "iPhone: …and remembered so it shows once");
  await p.locator(".qmr-locknote button").click();
  check((await p.evaluate(() => window.__wl.held)) === 1, "iPhone: screen wake lock held during the call");
  await ccOn(p, dg);
  check(dg.live.size === 1, "iPhone: captions on Deepgram (mocked)", `conns=${dg.conns}`);
  const l0 = await p.evaluate(() => ({ ...window.__listeners }));

  // Lock: tag appears for others; Deepgram drops while locked; mic ends while locked
  const g0 = await p.evaluate(() => window.__gum.audio);
  const req0 = await p.evaluate(() => window.__wl.req);
  await vis(p, "hidden");
  await wait(1500);
  const tag = (await obs.locator(".qmr-awaytag").allInnerTexts()).join(" | ");
  check(/Iris — paused, phone locked/.test(tag), "iPhone locked → the other participant sees 'paused, phone locked'", tag);
  const c0 = dg.conns, tk0 = dg.tokenCalls;
  dg.serverClose();
  await p.evaluate(() => { const t = window.__gum.tracks.filter((t) => t.kind === "audio" && t.readyState === "live").pop(); t.stop(); t.dispatchEvent(new Event("ended")); });
  await wait(6500);   // > LiveKit's 5s background delay
  const hid = await p.evaluate(() => window.__gum.audio);
  check(dg.conns === c0 && dg.tokenCalls === tk0, "iPhone locked: no Deepgram reconnect / key fetch from the hidden page", `conns=${dg.conns - c0} tokens=${dg.tokenCalls - tk0}`);
  check(hid - g0 <= 1, "iPhone locked: at most LiveKit's own TrackEnded restart from the hidden page; MediaGuard adds none", `gUM ${g0}→${hid}`);
  check((await p.evaluate(() => window.__wl.held)) === 0, "iPhone locked: the browser dropped the wake lock (simulated)");

  // AudioContexts go 'interrupted' while locked
  const ni = await p.evaluate(() => window.__interrupt());

  // Unlock
  await vis(p, "visible");
  await wait(1200);
  await until(() => dg.live.size === 1, 10000);
  const g1 = await p.evaluate(() => window.__gum.audio);
  await wait(3500);
  const g2 = await p.evaluate(() => ({ a: window.__gum.audio, live: window.__gum.tracks.filter((t) => t.kind === "audio" && t.readyState === "live").length }));
  check(g1 - g0 === 1, "iPhone unlock: the ended microphone is re-acquired exactly once in total", `gUM ${g0}→${g1}`);
  check(g2.a === g1 && g2.live >= 1, "iPhone unlock: MediaGuard did NOT race it with a second restart; mic live", `gUM ${g1}→${g2.a}, live=${g2.live}`);
  const rs = await ours(p);
  check(ni > 0 && rs.every((s) => s.startsWith("running")), "iPhone unlock: every app-owned 'interrupted' AudioContext resumed", rs.join(","));
  check(dg.live.size === 1 && dg.tokenCalls > tk0, "iPhone unlock: captions back on exactly one Deepgram socket with a fresh key", `live=${dg.live.size} new conns=${dg.conns - c0} tokens=${dg.tokenCalls - tk0}`);
  check((await obs.locator(".qmr-awaytag").count()) === 0, "iPhone unlock: the 'phone locked' tag clears for others");
  check((await p.evaluate(() => window.__wl)).req > req0 && (await p.evaluate(() => window.__wl.held)) === 1, "iPhone unlock: wake lock re-requested and held");

  // Rapid lock/unlock storm
  const cs = dg.conns;
  for (let i = 0; i < 30; i++) { await vis(p, i % 2 ? "visible" : "hidden"); await wait(30); }
  await vis(p, "visible"); await wait(4000);
  const l1 = await p.evaluate(() => ({ ...window.__listeners }));
  check(dg.live.size === 1, "iPhone: 30-event lock/unlock storm → exactly one live Deepgram socket", `live=${dg.live.size} conns during storm=${dg.conns - cs}`);
  check(l1.visibilitychange === l0.visibilitychange && l1.pageshow === l0.pageshow, "iPhone: no listener growth from the storm", JSON.stringify({ l0, l1 }));
  check((await p.evaluate(() => window.__wl.held)) === 1, "iPhone: after the storm one wake lock is held (no stacking)", JSON.stringify(await p.evaluate(() => window.__wl)));
  check((await obs.locator(".qmr-awaytag").count()) === 0, "iPhone: after the storm no stale 'phone locked' tag");
  // livekit-client's own iOS handler calls room.startAudio() un-awaited on
  // every "visible"; in a storm WebKit aborts the previous play() and that
  // rejection surfaces. Library-internal, harmless (the next return retries).
  const lkAbort = p.__log.filter((l) => /pageerror: AbortError: The operation was aborted/.test(l)).length;
  const errs = p.__log.filter((l) => /pageerror/.test(l) && !/AbortError: The operation was aborted/.test(l));
  console.log(`  info - livekit-client startAudio() AbortError during the storm: ${lkAbort} (library, not app)`);
  check(errs.length === 0, "iPhone: no uncaught page errors", errs.slice(0, 3).join(" | "));

  // Leave releases the wake lock and the Deepgram socket
  const leave = p.locator(".lk-disconnect-button, button:has-text('Leave')").first();
  await leave.click();
  await wait(1500);
  const conf = p.locator(".qmr-leaveconfirm .qmr-leave");
  if (await conf.count()) { await conf.first().click(); await wait(1500); }
  await wait(2000);
  check((await p.evaluate(() => window.__wl.held)) === 0, "iPhone leave: wake lock released", JSON.stringify(await p.evaluate(() => window.__wl)));
  check(dg.live.size === 0, "iPhone leave: no Deepgram socket left open", `live=${dg.live.size}`);
  const c9 = dg.conns; await vis(p, "hidden"); await vis(p, "visible"); await wait(3000);
  check(dg.conns === c9, "iPhone after leave: a return does not reconnect anything");
  await b.close(); await b2.close();
}

const f = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - f} passed, ${f} failed`);
process.exit(f ? 1 : 0);
