import { chromium, webkit, devices } from "playwright";
export const BASE = process.env.BASE || "http://127.0.0.1:3100";

// Installed before any page script: spies on what the app does.
export const SPY = (fake) => {
  const w = window;
  w.__vis = "visible";
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return w.__vis; } });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return w.__vis === "hidden"; } });
  w.__sentinels = [];
  w.__setVis = (v) => {
    w.__vis = v;
    // Real browsers drop a screen wake lock when the page hides.
    if (v === "hidden") w.__sentinels.forEach((s) => s.release());
    document.dispatchEvent(new Event("visibilitychange"));
  };
  // Net visibilitychange / pageshow listeners, to catch leaks.
  w.__listeners = { visibilitychange: 0, pageshow: 0 };
  for (const T of [Document.prototype, Window.prototype]) {
    const add = T.addEventListener || EventTarget.prototype.addEventListener;
    const rem = T.removeEventListener || EventTarget.prototype.removeEventListener;
    T.addEventListener = function (type, fn, o) { if (type in w.__listeners) w.__listeners[type]++; return add.call(this, type, fn, o); };
    T.removeEventListener = function (type, fn, o) { if (type in w.__listeners) w.__listeners[type]--; return rem.call(this, type, fn, o); };
  }
  // AudioContexts
  w.__acs = [];
  const AC = w.AudioContext || w.webkitAudioContext;
  w.__RealAC = AC;
  if (AC) {
    const Wrapped = function (...a) { const ac = new AC(...a); ac.__lk = Boolean(a[0] && a[0].latencyHint === "interactive"); ac.__made = new Error().stack.split("\n").slice(2, 8).map((l) => l.trim().replace(/http:\/\/127.0.0.1:3100\/_next\/static\/chunks\//, "")).join(" < "); w.__acs.push(ac); return ac; };
    Wrapped.prototype = AC.prototype;
    // Contexts that read a microphone are the ones a silent unlock breaks.
    const cms = AC.prototype.createMediaStreamSource;
    AC.prototype.createMediaStreamSource = function (...a) { this.__mic = true; return cms.apply(this, a); };
    w.AudioContext = Wrapped;
  }
  w.__interrupt = () => {
    let n = 0;
    for (const ac of w.__acs) {
      if (ac.state === "closed") continue;
      n++;
      ac.__resumes = 0;
      const real = AC.prototype.resume;
      Object.defineProperty(ac, "state", { configurable: true, get: () => "interrupted" });
      ac.resume = function () { this.__resumes++; delete this.state; delete this.resume; return real.call(this); };
    }
    return n;
  };
  // getUserMedia
  w.__gum = { audio: 0, video: 0, tracks: [] };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    // WebKit on Linux has no capture devices: synthesize them (a tone and a
    // canvas), so LiveKit publishes real tracks that can be stopped/restarted.
    const synth = async (c) => {
      const out = new MediaStream();
      if (c && c.audio) {
        const ac = new (window.__RealAC || window.AudioContext)();
        const osc = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.2;
        const dest = ac.createMediaStreamDestination();
        osc.connect(g).connect(dest); osc.start();
        dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
      }
      if (c && c.video) {
        const cv = document.createElement("canvas"); cv.width = 320; cv.height = 240;
        const x = cv.getContext("2d"); let n = 0;
        setInterval(() => { x.fillStyle = `hsl(${(n++ * 7) % 360},60%,50%)`; x.fillRect(0, 0, 320, 240); }, 100);
        cv.captureStream(15).getVideoTracks().forEach((t) => out.addTrack(t));
      }
      return out;
    };
    const real = fake ? synth : md.getUserMedia.bind(md);
    if (fake) md.enumerateDevices = async () => [
      { deviceId: "fake-mic", kind: "audioinput", label: "Fake mic", groupId: "g" },
      { deviceId: "fake-cam", kind: "videoinput", label: "Fake cam", groupId: "g" },
      { deviceId: "fake-spk", kind: "audiooutput", label: "Fake speaker", groupId: "g" },
    ];
    md.getUserMedia = async (c) => {
      if (c && c.audio) { w.__gum.audio++; (w.__gum.stacks ||= []).push(performance.now().toFixed(0) + " " + new Error().stack.split("\n").slice(2, 14).map((l) => l.trim().replace(/http:\/\/127.0.0.1:3100\/_next\/static\/chunks\//, "")).join(" < ")); }
      if (c && c.video) w.__gum.video++;
      const s = await real(c);
      s.getTracks().forEach((t) => { t.__n = w.__gum.audio; w.__gum.tracks.push(t); const st = t.stop.bind(t); t.stop = () => { t.__stoppedBy = new Error().stack.split("\n").slice(2, 16).map((l) => l.trim().replace(/http:\/\/127.0.0.1:3100\/_next\/static\/chunks\//, "")).join(" < "); st(); }; });
      return s;
    };
  }
  // Playwright's Linux WebKit has no MediaRecorder; iOS 18.4+ has one that
  // records audio/webm;codecs=opus. Stand one in so the Deepgram path runs.
  if (fake && !w.MediaRecorder) {
    w.MediaRecorder = class { constructor(s, o) { this.stream = s; this.mimeType = o && o.mimeType; this.state = "inactive"; this.ondataavailable = null; this.onstop = null; }
      static isTypeSupported(m) { return /webm/.test(m); }
      start(ms) { this.state = "recording"; this.iv = setInterval(() => this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array(32)]) }), ms || 250); }
      stop() { if (this.state === "inactive") return; this.state = "inactive"; clearInterval(this.iv); this.onstop && this.onstop(); } };
    w.__fakeMR = true;
  }
  // Wake lock
  w.__wl = { req: 0, rel: 0, held: 0 };
  try {
    Object.defineProperty(Navigator.prototype, "wakeLock", { configurable: true, get() {
      return { request: async () => { w.__wl.req++; w.__wl.held++; const s = { released: false, async release() { if (!s.released) { s.released = true; w.__wl.rel++; w.__wl.held--; } } }; w.__sentinels.push(s); return s; } };
    } });
  } catch {}
  // WebSockets to Deepgram (real sockets are routed by Playwright)
  w.__dg = { opened: 0, ev: [] };
  const RWS = w.WebSocket;
  w.WebSocket = function (u, pr) { const s = new RWS(u, pr); if (/deepgram/.test(u)) { const t0 = Date.now(); w.__dg.ev.push("new"); s.addEventListener("open", () => w.__dg.ev.push("open")); s.addEventListener("close", (e) => w.__dg.ev.push("close" + e.code)); } return s; };
  Object.assign(w.WebSocket, RWS); w.WebSocket.prototype = RWS.prototype; w.WebSocket.OPEN = 1; w.WebSocket.CONNECTING = 0; w.WebSocket.CLOSING = 2; w.WebSocket.CLOSED = 3;
};

export async function launch(kind) {
  if (kind === "chromium") {
    const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
    const ctx = await b.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1280, height: 800 } });
    return { b, ctx };
  }
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices["iPhone 15"] });
  ctx.__fake = true;
  return { b, ctx };
}

export async function join(ctx, name, room, { spy = true, route } = {}) {
  const p = await ctx.newPage();
  p.__log = [];
  p.on("console", (m) => p.__log.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  p.on("pageerror", (e) => p.__log.push(`pageerror: ${e.message}`, `stack: ${(e.stack || "").slice(0, 600)}`));
  if (spy) await p.addInitScript(SPY, Boolean(ctx.__fake));
  if (route) await route(p);
  await p.goto(`${BASE}/room/${room}`);
  await p.waitForTimeout(1500);   // hydration
  const btn = p.locator("button.qmd-join");
  for (let i = 0; i < 10; i++) {
    await p.getByPlaceholder("Your name").fill(name);
    const box = p.getByLabel(/may be recorded/i);
    if (!(await box.isChecked())) await box.click({ force: true });
    if (await btn.isEnabled()) break;
    await p.waitForTimeout(700);
  }
  await btn.click();
  await p.waitForSelector(".qmr-conf", { timeout: 20000 });
  await p.waitForTimeout(2500);
  return p;
}

export const until = async (fn, ms = 10000, step = 200) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)); } return Boolean(await fn()); };
export const results = [];
export function check(cond, name, extra = "") {
  results.push({ ok: Boolean(cond), name, extra });
  console.log(`${cond ? "  ok  " : "  FAIL"} - ${name}${extra ? ` (${extra})` : ""}`);
}
