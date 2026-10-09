"use client";

// Direction B — "Signal sphere".
// Draws from Jiro's Nexora (one dramatic, lit hero object; giant bottom-left
// display type; numbered 01–04 process row) and Strova (centred light on
// near-black, product panel below the fold), recast in the Quantlys mark:
// many voices converging into one teal point — the spec.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GH, Mark, Arrow, Check, JoinBox, FAQ, Foot } from "./kit";
import "./kit.css";
import "./b.css";

// Caption fragments drifting into the sphere. x/y are start offsets from the
// sphere centre as a fraction of the sphere box (S); mx/my override them when
// the hero is stacked (phones, portrait tablets). `m` = shown when stacked,
// `s` = shown on the smallest phones and landscape phones. Positions are then
// clamped in JS so every chip starts fully on screen and clear of the card.
const FRAGS = [
  { t: "“We won’t prorate downgrades mid-cycle.”", c: "amber", x: -0.78, y: -0.16 },
  { t: "As an admin, I preview the next invoice", c: "", x: 0.2, y: -0.5 },
  { t: "Who owns the rollout?", c: "teal m s", x: 0.72, y: 0.2, mx: 0.5, my: -0.34 },
  { t: "acceptance: within $0.01", c: "m s", x: -0.62, y: 0.06, mx: -0.6, my: 0.2 },
  { t: "Open: EU VAT on proration", c: "m", x: -0.36, y: -0.48, mx: -0.5, my: -0.44 },
  { t: "Finance can’t see proration first", c: "", x: 0.52, y: -0.3 },
];

type Box = { l: number; t: number; r: number; b: number };
const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const box = (r: DOMRect, pad = 0): Box => ({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad });

// Lay the chips out for the current viewport: clamp each start position into
// the allowed zone, nudge it vertically off anything it would cover, and hide
// it if there is no room. Runs on resize / orientation change / font load.
function placeFrags(hero: HTMLElement) {
  const wrap = hero.querySelector<HTMLElement>(".b-frags");
  const orbEl = hero.querySelector<HTMLElement>(".b-orb");
  const stageEl = hero.querySelector<HTMLElement>(".b-stage");
  if (!wrap || !orbEl || !stageEl) return;
  const mode = getComputedStyle(hero).getPropertyValue("--mode").trim() || "wide";
  const orb = orbEl.getBoundingClientRect();
  const S = orb.width, cx = orb.left + S / 2, cy = orb.top + orb.height / 2;
  const H = hero.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  let zone: Box;
  if (mode === "wide") {
    const top = hero.querySelector(".b-top")!.getBoundingClientRect();
    const bot = hero.querySelector(".b-bottom")!.getBoundingClientRect();
    zone = { l: Math.max(H.left, 0) + 16, r: Math.min(H.right, vw) - 16, t: top.bottom + 12, b: bot.top - 12 };
  } else {
    const st = stageEl.getBoundingClientRect();
    zone = { l: Math.max(st.left, 0) + 8, r: Math.min(st.right, vw) - 8, t: st.top + 4, b: st.bottom - 4 };
  }
  const card = hero.querySelector(".b-card");
  const taken: Box[] = card && getComputedStyle(card).display !== "none" ? [box(card.getBoundingClientRect(), 10)] : [];
  wrap.querySelectorAll<HTMLElement>(".b-frag").forEach((el, i) => {
    el.style.visibility = "";
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w) return; // display:none at this size
    const f = FRAGS[i];
    const fx = mode !== "wide" && f.mx !== undefined ? f.mx : f.x;
    const fy = mode !== "wide" && f.my !== undefined ? f.my : f.y;
    const clampX = (v: number) => Math.min(Math.max(v, zone.l + w / 2), zone.r - w / 2);
    const clampY = (v: number) => Math.min(Math.max(v, zone.t + h / 2), zone.b - h / 2);
    if (w > zone.r - zone.l || h > zone.b - zone.t) { el.style.visibility = "hidden"; return; }
    const px = clampX(cx + fx * S);
    const py0 = clampY(cy + fy * S);
    let ok: number | null = null;
    for (let k = 0; k < 40 && ok === null; k++) {
      for (const sgn of k ? [1, -1] : [1]) {
        const py = clampY(py0 + sgn * k * 10);
        const b = { l: px - w / 2 - 6, r: px + w / 2 + 6, t: py - h / 2 - 6, b: py + h / 2 + 6 };
        if (!taken.some((t) => hit(t, b))) { ok = py; taken.push(b); break; }
      }
    }
    if (ok === null) { el.style.visibility = "hidden"; return; }
    el.style.setProperty("--x", `${Math.round(px - cx)}px`);
    el.style.setProperty("--y", `${Math.round(ok - cy)}px`);
  });
  wrap.classList.add("is-set");
}

function lowPower() {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.hardwareConcurrency || 8) <= 2 || (n.deviceMemory || 8) <= 2 || !!n.connection?.saveData;
}

function Sphere() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || lowPower()) return;
    let handle: { dispose(): void } | null = null, gone = false;
    const start = () => {
      import("./sphere").then(({ mountSphere }) => {
        if (gone) return;
        handle = mountSphere(c, () => setLive(true));
      }).catch(() => {});
    };
    // After first paint and idle: the headline is the LCP, not the 3D.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 600);
    return () => { gone = true; if (!w.requestIdleCallback) clearTimeout(id); handle?.dispose(); };
  }, []);
  return (
    <div className={"b-orb" + (live ? " is-live" : "")} aria-hidden="true">
      <div className="b-poster"><i /></div>
      <canvas ref={ref} />
    </div>
  );
}

export default function B() {
  const heroRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => placeFrags(hero)); };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(hero);
    window.addEventListener("orientationchange", run);
    window.visualViewport?.addEventListener("resize", run);
    document.fonts?.ready.then(run).catch(() => {});
    const card = hero.querySelector(".b-card");
    card?.addEventListener("animationend", run);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("orientationchange", run);
      window.visualViewport?.removeEventListener("resize", run);
      card?.removeEventListener("animationend", run);
    };
  }, []);
  return (
    <div className="qp qb">
      <nav className="b-nav" aria-label="Main">
        <Link href="/" className="qp-brand"><Mark /><span>Quantlys <em>Meeting</em></span></Link>
        <div className="b-links">
          <a href="#how">How it works</a><a href="#do">Features</a><a href="#faq">FAQ</a><a href="#join">Join</a><a href={GH}>GitHub</a>
        </div>
        <Link className="qp-btn qp-btn-p qp-btn-sm" href="/host">Host a meeting</Link>
      </nav>

      <header className="b-hero" ref={heroRef}>
        <div className="b-stage" aria-hidden="true">
          <Sphere />
          <div className="b-frags">
            {FRAGS.map((f, i) => (
              <span key={i} className={"b-frag " + f.c} style={{ ["--d" as string]: `${i * 1.35}s` }}>
                {f.t}
              </span>
            ))}
          </div>
          <div className="b-card">
            <div className="b-card-h"><span className="qp-mono"><span className="b-pre">PRD · </span>billing-v2.md</span><span className="b-ok"><i />written</span></div>
            <p className="b-x"><b>Problem</b> Plan changes go through support.</p>
            <p><b>Story</b> Admin previews the next invoice.</p>
            <p className="b-x"><b>AC</b> Preview within $0.01.</p>
            <p className="b-dec">Decision · no mid-cycle proration</p>
          </div>
        </div>

        <div className="b-top">
          <p className="b-kick"><i />Open source · MIT · no download</p>
          <p className="b-side qp-mono">Voices in.<br />One spec out.</p>
        </div>

        <div className="b-bottom">
          <h1><i className="l">The video meeting</i> <i className="l">that leaves <span>a spec</span>,</i> <i className="l">not notes.</i></h1>
          <div className="b-right">
            <p>
              Video in a browser tab. Guests need a link, not an account. Turn
              captions on, and the working session writes a PRD — problem, user
              stories, acceptance criteria, decisions, and open questions.
            </p>
            <div className="b-cta">
              <Link className="qp-btn qp-btn-p" href="/host">Host a meeting <Arrow /></Link>
              <a className="qp-btn qp-btn-g" href={GH}>Source on GitHub</a>
            </div>
          </div>
        </div>
      </header>

      <section className="b-sec" id="how">
        <div className="b-head">
          <p className="qp-k">How it condenses</p>
          <h2>From a room full of voices to one document.</h2>
        </div>
        <ol className="b-steps">
          <li><span>01</span><h3>Host</h3><p>Sign in with an email code. Guests join from any browser with a name. Nothing to download.</p></li>
          <li><span>02</span><h3>Record</h3><p>Tick recording. Everyone sees a red badge. Captions on, and decisions land while you talk.</p></li>
          <li><span>03</span><h3>Ask</h3><p>An agent works the rubric in the pauses and puts one follow-up question on everyone’s screen.</p></li>
          <li className="on"><span>04</span><h3>Spec</h3><p>Every recorded meeting on a project rolls into one markdown PRD. Download .md.</p></li>
        </ol>
      </section>

      <section className="b-sec" id="do">
        <div className="b-head">
          <p className="qp-k">Shipped, not promised</p>
          <h2>What you can do today.</h2>
        </div>
        <div className="b-bento">
          <article className="b-cell b-big" id="prd">
            <p className="qp-k">The PRD is the minutes</p>
            <h3>Problem, stories, acceptance criteria, decisions, open questions.</h3>
            <div className="b-doc">
              <p className="h"><span>##</span> Acceptance criteria</p>
              <p><Check /> Preview matches the invoice generated within $0.01.</p>
              <p><Check /> Downgrades take effect at period end.</p>
              <p className="b-dec">Decision caught · 18:14 — no mid-cycle proration</p>
              <p className="h"><span>##</span> Open</p>
              <p className="m">EU VAT on proration — parked.</p>
            </div>
            <Link className="b-more" href="/example-prd">Read the example PRD <Arrow /></Link>
          </article>
          <article className="b-cell">
            <p className="qp-k">Ask this meeting</p>
            <h3>Answered from the transcript, with the timestamp.</h3>
            <p className="b-qa"><span>Did we agree on downgrades?</span><span>Yes — period end. <em>18:14</em></span></p>
          </article>
          <article className="b-cell" id="memory">
            <p className="qp-k">Memory mode</p>
            <h3>Podcasts, books, oral history.</h3>
            <p className="b-tags"><span>MP4 / WebM</span><span>.vtt .srt</span><span>m4a · WAV</span><span>.md</span></p>
            <Link className="b-more" href="/memory-mode">How Memory works <Arrow /></Link>
          </article>
          <article className="b-cell">
            <p className="qp-k">No download</p>
            <h3>Guests join from a link. Waiting room, lock, screen share, whiteboard.</h3>
          </article>
          <article className="b-cell b-os" id="own">
            <p className="qp-k">Open source · MIT</p>
            <h3>Use it on our cloud until you don’t trust us.</h3>
            <pre className="qp-mono">$ git clone github.com/SantoshA1/quantlys-meet{"\n"}LIVEKIT_URL=…  DEEPGRAM_API_KEY=…{"\n"}NEXT_PUBLIC_SUPABASE_URL=…</pre>
            <Link className="b-more" href="/self-hosted-video-conferencing">Self-host it <Arrow /></Link>
          </article>
        </div>
      </section>

      <section className="b-sec b-faqwrap" id="faq">
        <div className="b-head">
          <p className="qp-k">FAQ</p>
          <h2>Quantlys Meeting is not Quantalys.</h2>
        </div>
        <div className="qp-faq">
          {FAQ.map((f, i) => (
            <details key={i} open={i === 0}>
              <summary><span className="qp-mono">0{i + 1}</span><h3>{f.q}</h3></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="b-final" id="join">
        <div className="b-final-glow" aria-hidden="true" />
        <Mark size={40} />
        <h2>Your next meeting can end with a spec.</h2>
        <div className="b-cta b-cta-c">
          <Link className="qp-btn qp-btn-p" href="/host">Host a meeting <Arrow /></Link>
        </div>
        <JoinBox />
      </section>

      <Foot />
    </div>
  );
}
