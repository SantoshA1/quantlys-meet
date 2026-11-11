/**
 * The Deepgram caption socket after an iPhone lock (lib/dg-reconnect.ts):
 * reconnect with a fresh key, once at a time, bounded, and never after stop.
 *
 * Run: node --experimental-strip-types lib/dg-reconnect.test.mjs
 */
import { createDgSession } from "./dg-reconnect.ts";
import { DG_MAX_RECONNECTS, DG_HEALTHY_MS } from "./page-life.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A deterministic world: fake clock, fake timers, fake sockets, fake page. */
function world(opts = {}) {
  let t = 1_000_000;
  const timers = [];
  const w = {
    hidden: false, showCbs: new Set(), sockets: [], tokens: 0, gaveUp: 0, repicked: 0, drops: 0, opened: 0, msgs: 0,
    tokenAnswer: opts.tokenAnswer || (() => ({ engine: "deepgram", token: `k${w.tokens}`, scheme: "token" })),
    advance: async (ms) => {
      const end = t + ms;
      for (;;) {
        await flush(); await flush();
        timers.sort((a, b) => a.at - b.at);
        const due = timers.find((x) => !x.dead && x.at <= end);
        if (!due) break;
        t = Math.max(t, due.at);
        due.dead = true;
        due.fn();
      }
      t = end;
      await flush(); await flush();
    },
    show: () => { w.hidden = false; [...w.showCbs].forEach((cb) => cb()); },
    liveTimers: () => timers.filter((x) => !x.dead).length,
  };
  const s = createDgSession({
    connect: (token, scheme) => {
      const sock = { token, scheme, closed: false, onopen: null, onmessage: null, onerror: null, onclose: null,
        close() { if (this.closed) return; this.closed = true; this.onclose?.(); } };
      w.sockets.push(sock);
      return sock;
    },
    fetchToken: async () => { w.tokens++; const a = w.tokenAnswer(w.tokens); if (a instanceof Error) throw a; return a; },
    onOpen: () => { w.opened++; },
    onMessage: () => { w.msgs++; },
    onDrop: () => { w.drops++; },
    onGiveUp: () => { w.gaveUp++; },
    onRepick: () => { w.repicked++; },
    isHidden: () => w.hidden,
    whenVisible: (cb) => { w.showCbs.add(cb); return () => w.showCbs.delete(cb); },
    now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms, dead: false }; timers.push(x); return x; },
    clearTimer: (x) => { if (x) x.dead = true; },
  });
  w.s = s;
  w.last = () => w.sockets[w.sockets.length - 1];
  w.drop = () => { const k = w.last(); k.onerror?.(); k.closed = true; k.onclose?.(); };
  return w;
}

// ── a close reconnects, with a FRESH key ──────────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  w.last().onopen();
  w.drop();
  await w.advance(300);
  ok(w.sockets.length === 2 && w.tokens === 1 && w.last().token === "k1", "THE BUG: a dropped socket reconnects with a new key (it used to switch engines for good)");
  ok(w.gaveUp === 0 && w.drops === 1, "no fallback for a single drop");
}

// ── a locked phone waits for the return ───────────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  w.hidden = true;
  w.drop();
  await w.advance(60_000);
  ok(w.tokens === 0 && w.sockets.length === 1 && w.s.state().waiting, "hidden: no key fetched, no socket opened, no attempt spent");
  // A storm of visibility events while hidden: still one waiter.
  w.drop(); w.drop();
  ok(w.showCbs.size === 1, "repeated closes while hidden register ONE waiter");
  w.show();
  await w.advance(300);
  ok(w.sockets.length === 2 && w.tokens === 1 && w.showCbs.size === 0, "the return reconnects once, and the waiter is gone");
}

// ── one reconnect at a time ───────────────────────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  w.drop();
  w.last().onclose();     // a duplicate close event for the same socket
  ok(w.liveTimers() === 1, "a second close while a reconnect is scheduled does not schedule another");
  await w.advance(300);
  ok(w.sockets.length === 2, "exactly one new socket");
}

// ── bounded: give up after DG_MAX_RECONNECTS ──────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  for (let i = 0; i < 20; i++) { w.last().onopen(); w.last().onmessage({ data: "{}" }); w.drop(); await w.advance(10_000); }
  ok(w.gaveUp === 1, "a socket that answers once and drops, over and over, ends in the fallback");
  ok(w.tokens === DG_MAX_RECONNECTS && w.sockets.length === DG_MAX_RECONNECTS + 1, `${DG_MAX_RECONNECTS} reconnects, then no more keys and no more sockets`);
  ok(w.liveTimers() === 0, "nothing left scheduled");
}

// ── a failing / rate-limited key endpoint backs off, bounded ──────────────
{
  const w = world({ tokenAnswer: () => new Error("captions token 429") });
  w.s.start("first", "token");
  w.drop();
  await w.advance(60_000);
  ok(w.tokens === DG_MAX_RECONNECTS && w.gaveUp === 1 && w.sockets.length === 1,
    "429s: a bounded number of key requests with backoff, then the fallback — no hammering the shared rate limit");
}
{
  // The endpoint recovers on the third try.
  const w = world({ tokenAnswer: (n) => (n < 3 ? new Error("503") : { engine: "deepgram", token: "fresh", scheme: "bearer" }) });
  w.s.start("first", "token");
  w.drop();
  await w.advance(60_000);
  ok(w.gaveUp === 0 && w.last().token === "fresh" && w.last().scheme === "bearer", "a transient 5xx recovers on Deepgram, scheme and all");
}

// ── the server says another engine ────────────────────────────────────────
{
  const w = world({ tokenAnswer: () => ({ engine: "relay", token: "", scheme: "token" }) });
  w.s.start("first", "token");
  w.drop();
  await w.advance(300);
  ok(w.repicked === 1 && w.gaveUp === 0 && w.sockets.length === 1, "'relay' now: captions pick again instead of assuming the browser");
}

// ── healthy resets the count ──────────────────────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  for (let i = 0; i < 10; i++) {
    w.last().onopen();
    await w.advance(DG_HEALTHY_MS + 1);
    w.last().onmessage({ data: "{}" });
    w.drop();
    await w.advance(300);
  }
  ok(w.gaveUp === 0 && w.sockets.length === 11, "a socket that stays up between drops is healthy: reconnects keep working all meeting");
}

// ── stop ends everything ──────────────────────────────────────────────────
{
  const w = world();
  w.s.start("first", "token");
  w.drop();
  w.s.stop();
  await w.advance(60_000);
  ok(w.tokens === 0 && w.sockets.length === 1 && w.liveTimers() === 0, "leave during the backoff: no key, no socket, no timer");
}
{
  // Leave while the key is being fetched: the key arrives late and is ignored.
  let release;
  const w = world();
  w.tokenAnswer = () => ({ engine: "deepgram", token: "late", scheme: "token" });
  const s0 = w.s;
  w.s.start("first", "token");
  w.drop();
  await w.advance(300);   // reconnect ran; fetchToken resolved synchronously-ish, opened #2
  s0.stop();
  ok(w.last().closed && w.s.state().stopped && !w.s.state().open, "leave with a socket open: it is closed and stays closed");
  w.drop();
  await w.advance(60_000);
  ok(w.sockets.length === 2, "no reconnect after leave");
  void release;
}
{
  const w = world();
  w.s.start("first", "token");
  w.hidden = true;
  w.drop();
  w.s.stop();
  ok(w.showCbs.size === 0, "leave while waiting for the return removes the visibility listener (no leak)");
  w.show();
  await w.advance(60_000);
  ok(w.tokens === 0 && w.sockets.length === 1, "and coming back after leaving does nothing");
}
{
  // A stale socket's events cannot drive the session.
  const w = world();
  w.s.start("first", "token");
  const old = w.last();
  w.drop();
  await w.advance(300);
  old.onmessage?.({ data: "{}" });
  old.onclose?.();
  ok(w.msgs === 0 && w.liveTimers() === 0 && w.sockets.length === 2, "events from a replaced socket are ignored");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
