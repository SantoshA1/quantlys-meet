"use client";

// Direction B — "Signal sphere".
// Draws from Jiro's Nexora (one dramatic, lit hero object; giant bottom-left
// display type; numbered 01–04 process row) and Strova (centred light on
// near-black, product panel below the fold), recast in the Quantlys mark:
// many voices converging into one teal point — the spec.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GH, Mark, Arrow, Check, JoinBox, FAQ, Foot } from "../kit";
import "./b.css";

const FRAGS = [
  { t: "“We won’t prorate downgrades mid-cycle.”", c: "amber", x: "-46vw", y: "-14vh" },
  { t: "As an admin, I preview the next invoice", c: "", x: "16vw", y: "-31vh" },
  { t: "Who owns the rollout?", c: "teal", x: "44vw", y: "16vh" },
  { t: "acceptance: within $0.01", c: "", x: "-38vw", y: "2vh" },
  { t: "Open: EU VAT on proration", c: "", x: "-22vw", y: "-30vh" },
  { t: "Finance can’t see proration first", c: "", x: "30vw", y: "-17vh" },
];

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
  return (
    <div className="qp qb">
      <nav className="b-nav" aria-label="Main">
        <Link href="/" className="qp-brand"><Mark /><span>Quantlys <em>Meeting</em></span></Link>
        <div className="b-links">
          <a href="#how">How it works</a><a href="#do">Features</a><a href="#faq">FAQ</a><a href={GH}>GitHub</a>
        </div>
        <Link className="qp-btn qp-btn-p qp-btn-sm" href="/host">Host a meeting</Link>
      </nav>

      <header className="b-hero">
        <div className="b-stage" aria-hidden="true">
          <Sphere />
          <div className="b-frags">
            {FRAGS.map((f, i) => (
              <span key={i} className={"b-frag " + f.c} style={{ ["--x" as string]: f.x, ["--y" as string]: f.y, ["--d" as string]: `${i * 1.35}s` }}>
                {f.t}
              </span>
            ))}
          </div>
          <div className="b-card">
            <div className="b-card-h"><span className="qp-mono">PRD · billing-v2.md</span><span className="b-ok"><i />written</span></div>
            <p><b>Problem</b> Plan changes go through support.</p>
            <p><b>Story</b> Admin previews the next invoice.</p>
            <p><b>AC</b> Preview within $0.01.</p>
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
          <article className="b-cell b-big">
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
          <article className="b-cell">
            <p className="qp-k">Memory mode</p>
            <h3>Podcasts, books, oral history.</h3>
            <p className="b-tags"><span>MP4 / WebM</span><span>.vtt .srt</span><span>m4a · WAV</span><span>.md</span></p>
            <Link className="b-more" href="/memory-mode">How Memory works <Arrow /></Link>
          </article>
          <article className="b-cell">
            <p className="qp-k">No download</p>
            <h3>Guests join from a link. Waiting room, lock, screen share, whiteboard.</h3>
          </article>
          <article className="b-cell b-os">
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

      <section className="b-final">
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
