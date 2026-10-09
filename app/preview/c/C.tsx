"use client";

// Direction C — "Spatial workspace".
// Draws from Jiro's Lightspeed (hairline-framed page, hatched dividers, mono
// rectangular buttons, alternating screenshot/text feature rows, two-column
// FAQ), VelaraAI (concentric light rings behind a framed product stage),
// AI Notepad (a meeting product sold through a live transcript preview) and
// CVGen (scroll-pinned storytelling). The product itself is the hero: glass
// layers of a real call, pulled apart in depth and assembled as you scroll.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { GH, Mark, Arrow, Check, JoinBox, FAQ, Foot } from "../kit";
import "./c.css";

const STEPS = [
  { k: "01", t: "Captions on", d: "The room writes itself down. Everyone sees the red recording badge." },
  { k: "02", t: "The agent asks", d: "One follow-up question, on everyone’s screen, only when there’s a real gap." },
  { k: "03", t: "The spec lands", d: "Decisions caught as they’re said. One markdown PRD per project." },
];

function useScrollScene(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqWide = window.matchMedia("(min-width: 901px)");
    const scroller = document.querySelector("main") || window;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (mqMotion.matches || !mqWide.matches) { el.style.removeProperty("--p"); el.dataset.step = ""; return; }
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, span > 0 ? -r.top / span : 0));
      el.style.setProperty("--p", p.toFixed(4));
      el.dataset.step = String(p < 0.3 ? 0 : p < 0.66 ? 1 : 2);
    };
    const view = el.querySelector<HTMLElement>(".c-view");
    const fit = () => {
      if (!view) return;
      const wide = mqWide.matches;
      const s = wide ? Math.min(view.clientWidth / 1240, view.clientHeight / 780) : view.clientWidth / 1380;
      view.style.setProperty("--s", Math.max(0.3, Math.min(s, 1.15)).toFixed(3));
    };
    const ro = new ResizeObserver(fit);
    if (view) ro.observe(view);
    fit();
    const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
    scroller.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    apply();
    return () => { ro.disconnect(); scroller.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, [ref]);
}

function World() {
  return (
    <div className="c-world" aria-hidden="true">
      <div className="c-floor" />
      <div className="c-layer c-tiles">
        <div className="c-bar"><span className="c-dots"><i /><i /><i /></span><span className="qp-mono">room/billing-v2</span><span className="c-rec"><i />REC</span></div>
        <div className="c-grid4">
          <div className="talk"><b>MA</b><span>Maya · PM</span></div>
          <div><b>JU</b><span>Jules · Finance</span></div>
          <div><b>AR</b><span>Arun · Eng</span></div>
          <div><b>SA</b><span>You · Host</span></div>
        </div>
      </div>
      <div className="c-layer c-trans">
        <p className="qp-k">Live captions</p>
        <p><b>Jules</b> Finance can’t see proration before it lands.</p>
        <p><b>Arun</b> Preview has to match the invoice.</p>
        <p className="now"><b>Maya</b> We will not prorate downgrades mid-cycle.</p>
      </div>
      <div className="c-layer c-prd">
        <div className="c-prd-h"><span className="qp-mono">PRD · billing-v2.md</span><span className="c-ok"><i />live</span></div>
        <p className="s1"><span>##</span> Problem</p>
        <p className="t s1">Plan changes go through support; finance can’t see proration first.</p>
        <p className="s2"><span>##</span> User stories</p>
        <p className="t s2">As an admin, I preview the next invoice before I confirm.</p>
        <p className="s3"><span>##</span> Acceptance criteria</p>
        <p className="t s3">☐ Preview matches the invoice within $0.01.</p>
      </div>
      <div className="c-layer c-ask">
        <p className="qp-k"><Mark size={12} /> Agent · follow-up</p>
        <p>What should an admin see before a downgrade takes effect?</p>
      </div>
      <div className="c-layer c-chip">Decision caught · 18:14</div>
    </div>
  );
}

export default function C() {
  const scene = useRef<HTMLElement>(null);
  useScrollScene(scene);
  return (
    <div className="qp qc">
      <div className="c-frame">
        <nav className="c-nav" aria-label="Main">
          <Link href="/" className="qp-brand"><Mark /><span>Quantlys <em>Meeting</em></span></Link>
          <div className="c-links qp-mono"><a href="#scene">Product</a><a href="#features">Features</a><a href="#faq">FAQ</a><a href={GH}>GitHub</a></div>
          <Link className="c-btn c-btn-p" href="/host">Host a meeting</Link>
        </nav>

        <header className="c-hero">
          <div className="c-badges qp-mono"><span className="w">Open source · MIT</span><span>No download for guests</span></div>
          <h1><i className="l">The video meeting</i> <i className="l">that leaves <em>a spec</em>,</i> <i className="l">not notes.</i></h1>
          <div className="c-hero-row">
            <p>
              Quantlys Meeting is video in a browser tab. Guests need a link, not
              an account. Turn captions on, and the working session writes a PRD —
              problem, user stories, acceptance criteria, decisions, and open
              questions.
            </p>
            <div className="c-ctas">
              <Link className="c-btn c-btn-p c-btn-l" href="/host">Host a meeting <Arrow /></Link>
              <a className="c-btn c-btn-l" href="#scene">See it assemble</a>
            </div>
          </div>
        </header>

        <section className="c-scene" id="scene" ref={scene}>
          <div className="c-sticky">
            <div className="c-rings" aria-hidden="true" />
            <h2 className="qp-sr">How a call becomes a spec</h2>
            <ol className="c-steps">
              {STEPS.map((s, i) => (
                <li key={s.k} data-i={i}><span className="qp-mono">{s.k}</span><div><h3>{s.t}</h3><p>{s.d}</p></div></li>
              ))}
            </ol>
            <div className="c-view"><World /></div>
            <p className="c-note qp-mono">Specimen UI · illustrative, not a customer recording</p>
          </div>
        </section>

        <div className="c-hatch" aria-hidden="true" />

        <section className="c-rows" id="features">
          <article className="c-row">
            <div>
              <p className="qp-k">The PRD is the minutes</p>
              <h2>The meeting is the product review.</h2>
              <p>Zoom and Meet recap the conversation. Notetakers write notes. Quantlys rolls every recorded meeting on a project into one markdown PRD you can download and paste into Conclave, Linear, or GitHub.</p>
              <Link className="c-link" href="/example-prd">Read the example PRD <Arrow /></Link>
            </div>
            <div className="c-vis"><div className="c-card">
              <p className="h"><span>##</span> Acceptance criteria</p>
              <p><Check /> Preview matches the invoice generated within $0.01.</p>
              <p><Check /> Downgrades take effect at period end unless the admin opts into immediate.</p>
              <p className="dec">Decision caught · Maya: “We will not prorate downgrades mid-cycle.”</p>
              <p className="h"><span>##</span> Open</p>
              <p className="m">Tax on proration for EU VAT — parked.</p>
            </div></div>
          </article>
          <article className="c-row rev">
            <div>
              <p className="qp-k">Memory mode</p>
              <h2>Podcasts, books, and oral history.</h2>
              <p>Record with captions, group episodes, and take each one home as a continuous HD 720p video, captions, audio clips, and a story / manuscript <code>.md</code>.</p>
              <Link className="c-link" href="/memory-mode">How Memory mode works <Arrow /></Link>
            </div>
            <div className="c-vis"><div className="c-card c-files">
              <p><span>video</span>Full take <em>MP4 · WebM in Firefox</em></p>
              <p><span>captions</span>Subtitles <em>.vtt · .srt</em></p>
              <p><span>audio</span>Episode &amp; chapters <em>m4a/webm · WAV cuts</em></p>
              <p><span>text</span>Story / manuscript <em>.md</em></p>
            </div></div>
          </article>
          <article className="c-row">
            <div>
              <p className="qp-k">Open source · MIT</p>
              <h2>Use it on our cloud until you don’t trust us.</h2>
              <p>The same app runs with your LiveKit, Deepgram, Supabase, OpenAI/OpenRouter, and S3 keys. Clone it, plug your keys, run your own stack.</p>
              <Link className="c-link" href="/self-hosted-video-conferencing">Self-hosting guide <Arrow /></Link>
            </div>
            <div className="c-vis"><pre className="c-card c-term qp-mono"><span className="p">$</span> git clone {GH}{"\n"}<span className="p">$</span> cp .env.example .env.local{"\n\n"}LIVEKIT_URL=<span className="v">wss://…</span>{"\n"}DEEPGRAM_API_KEY=<span className="v">…</span>{"\n"}NEXT_PUBLIC_SUPABASE_URL=<span className="v">…</span>{"\n"}OPENROUTER_API_KEY=<span className="v">…</span></pre></div>
          </article>
        </section>

        <div className="c-hatch" aria-hidden="true" />

        <section className="c-specs">
          <div className="c-specs-h"><p className="qp-k">Shipped, not promised</p><h2>Everything in the room.</h2></div>
          <div className="c-specgrid">
            <div><h3>Ask this meeting</h3><p>Answered from the transcript, with the timestamp.</p></div>
            <div><h3>Live notes</h3><p>Decisions and commitments caught as they are said.</p></div>
            <div><h3>Search</h3><p>Search every recording you own.</p></div>
            <div><h3>Room controls</h3><p>Waiting room, lock, screen share, whiteboard, captions.</p></div>
            <div><h3>After the call</h3><p>Talk balance, who owes what, a weekly digest of what’s still open.</p></div>
            <div><h3>Calendar</h3><p>A calendar invite (.ics) from the host console.</p></div>
          </div>
        </section>

        <section className="c-faq" id="faq">
          <div><p className="qp-k">FAQ</p><h2>Quantlys Meeting is not Quantalys.</h2></div>
          <div className="qp-faq">
            {FAQ.map((f, i) => (
              <details key={i} open={i === 0}>
                <summary><span className="qp-mono">0{i + 1}</span><h3>{f.q}</h3></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="c-final">
          <div className="c-rings" aria-hidden="true" />
          <h2>Your next meeting can end with a spec.</h2>
          <div className="c-ctas c-ctas-c">
            <Link className="c-btn c-btn-p c-btn-l" href="/host">Host a meeting <Arrow /></Link>
            <a className="c-btn c-btn-l" href={GH}>Read the source</a>
          </div>
          <JoinBox />
        </section>

        <Foot />
      </div>
    </div>
  );
}
