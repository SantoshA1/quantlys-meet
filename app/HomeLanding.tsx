"use client";

// Marketing front door, v2 (design/home-v2).
//
// Same product, same promises, same links as v1 — what changed is the
// presentation: a floating glass nav, a display-size hero, and a real product
// visual (an HTML/CSS mock of a call with the PRD writing itself beside it)
// instead of a wall of text. Everything on this page is a feature that exists
// in the code; the mock is labelled a specimen, and there are no logos,
// counts, ratings or testimonials, because there are none to show yet.
//
// The join/host cards are unchanged in behaviour: guests look up a code,
// hosts go to /host.
//
// Motion is CSS only. Nothing animates under prefers-reduced-motion, and the
// scroll reveal only ever hides things that are already below the fold, so
// there is no flash and no layout shift (opacity/transform only).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { guestJoinUiAllowed } from "@/lib/guest-join";
import "./home-v2.css";

let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _db;
}

const GH = "https://github.com/SantoshA1/quantlys-meet";
const RELEASE = "https://github.com/SantoshA1/quantlys-meet/releases/tag/v1.0.0-oss";

/** Many inputs, one output: the Quantlys dot cluster converging to one point. */
function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="qh-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeOpacity=".35" strokeWidth="1">
        <path d="M4 4 L18 12" /><path d="M3 12 L18 12" /><path d="M4 20 L18 12" />
        <path d="M9 7 L18 12" /><path d="M9 17 L18 12" />
      </g>
      <g fill="currentColor" fillOpacity=".55">
        <circle cx="4" cy="4" r="1.6" /><circle cx="3" cy="12" r="1.6" /><circle cx="4" cy="20" r="1.6" />
        <circle cx="9" cy="7" r="1.3" /><circle cx="9" cy="17" r="1.3" />
      </g>
      <circle cx="18.5" cy="12" r="3.2" fill="#2DD4BF" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Stylised product UI. Decorative: the real content is in the text around it. */
function HeroVisual() {
  const tiles = [
    { i: "MA", n: "Maya · PM", talk: true },
    { i: "JU", n: "Jules · Finance" },
    { i: "AR", n: "Arun · Eng" },
    { i: "SA", n: "You · Host" },
  ];
  return (
    <figure className="qh-visual" aria-label="Illustration of a Quantlys Meeting call with the PRD panel writing itself">
      <div className="qh-win" aria-hidden="true">
        <div className="qh-win-bar">
          <span className="qh-win-dots"><i /><i /><i /></span>
          <span className="qh-url">quantlys-meeting.com/room/billing-v2</span>
          <span className="qh-rec"><i />REC 18:14</span>
        </div>
        <div className="qh-win-body">
          <div className="qh-stage">
            <div className="qh-tiles">
              {tiles.map((t) => (
                <div key={t.i} className={"qh-tile" + (t.talk ? " qh-talk" : "")}>
                  <span className="qh-av">{t.i}</span>
                  <span className="qh-tag">
                    {t.talk ? (
                      <span className="qh-bars"><i /><i /><i /></span>
                    ) : null}
                    {t.n}
                  </span>
                </div>
              ))}
            </div>
            <div className="qh-ask">
              <span className="qh-ask-k"><Mark size={14} /> Agent · follow-up, on everyone&apos;s screen</span>
              <p>What should an admin see before a downgrade takes effect?</p>
              <span className="qh-ask-gap">Open: acceptance criteria · rollout</span>
            </div>
            <div className="qh-cap">
              <b>Maya</b>
              <span className="qh-type">We will not prorate downgrades mid-cycle.</span>
            </div>
            <div className="qh-dock">
              <span>Mic</span><span>Cam</span><span>Share</span>
              <span className="on">CC</span><span>Board</span>
              <span className="qh-leave">Leave</span>
            </div>
          </div>
          <div className="qh-doc">
            <div className="qh-doc-h">
              <span className="qh-mono">PRD · billing-v2.md</span>
              <span className="qh-live"><i />writing</span>
            </div>
            <div className="qh-doc-b">
              <p className="qh-l qh-d1"><span className="qh-hash">##</span> Problem</p>
              <p className="qh-l qh-d2 qh-t">Admins email support to change plans; finance can&apos;t see proration first.</p>
              <p className="qh-l qh-d3"><span className="qh-hash">##</span> User stories</p>
              <p className="qh-l qh-d4 qh-t">– As an admin, I preview the next invoice before I confirm.</p>
              <p className="qh-l qh-d5"><span className="qh-hash">##</span> Acceptance criteria</p>
              <p className="qh-l qh-d6 qh-t"><span className="qh-box" /> Preview matches the invoice within $0.01.</p>
              <div className="qh-l qh-d7 qh-caught">
                <span>Decision caught · 18:14</span>
                No mid-cycle proration on downgrades.
              </div>
              <p className="qh-l qh-d8"><span className="qh-hash">##</span> Open</p>
              <p className="qh-l qh-d9 qh-t">EU VAT on proration — parked.<span className="qh-caret" /></p>
            </div>
          </div>
        </div>
      </div>
      <figcaption>Specimen UI. Illustrative, not a customer recording.</figcaption>
    </figure>
  );
}

export default function HomeLanding() {
  const router = useRouter();
  // Build-time public mirror of ALLOW_GUEST_JOIN — keeps the landing card honest.
  const guestsOk = guestJoinUiAllowed({
    NEXT_PUBLIC_ALLOW_GUEST_JOIN: process.env.NEXT_PUBLIC_ALLOW_GUEST_JOIN,
  });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => {
        setEmail(data.session?.user?.email ?? null);
        setReady(true);
      });
  }, []);

  // Scroll reveal. Only hides what is already below the fold, so first paint
  // is never touched; skipped entirely for reduced motion or no IO support.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".qh-rv"));
    const vh = window.innerHeight;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.remove("qh-wait");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    for (const it of items) {
      if (it.getBoundingClientRect().top > vh) {
        it.classList.add("qh-wait");
        io.observe(it);
      }
    }
    return () => io.disconnect();
  }, []);

  function roomFrom(input: string) {
    const raw = input.trim();
    if (!raw) return "";
    const last = raw.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "";
    return last;
  }

  async function joinAsGuest() {
    const room = roomFrom(code);
    if (!room || busy) return;
    setBusy(true);
    setNote("");
    const { data, error } = await db().rpc("meeting_by_code", { code: room });
    setBusy(false);
    if (error) {
      router.push(`/room/${room}`);
      return;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setNote("That link or code doesn't match a meeting that's running. Check it and try again.");
      return;
    }
    const found = Array.isArray(data) ? data[0] : data;
    router.push(`/room/${found.room_name || room}`);
  }

  return (
    <div className="qh" ref={root}>
      <div className="qh-bg" aria-hidden="true" />

      <nav className="qh-nav" aria-label="Main">
        <Link href="/" className="qh-brand" aria-label="Quantlys Meeting home">
          <Mark />
          <span>Quantlys <em>Meeting</em></span>
        </Link>
        <div className="qh-links">
          <a href="#how">How it works</a>
          <a href="#prd">The spec</a>
          <a href="#memory">Memory</a>
          <a href="#own">Open source</a>
          <a href="#join">Join</a>
        </div>
        <div className="qh-nav-r">
          <a className="qh-gh" href={GH}>
            <span className="qh-mono">MIT</span> GitHub
          </a>
          <Link className="qh-btn qh-btn-p qh-btn-sm" href="/host">
            Host a meeting
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <header className="qh-hero">
        <div className="qh-hero-grid">
          <div className="qh-hero-h">
            <p className="qh-pill">
              <i className="qh-pulse" /> Live now · no waitlist
              <span className="qh-pill-sep" />
              <span className="qh-mono">v1.0.0-oss · MIT</span>
            </p>
            <h1>
              <span className="qh-l">The video meeting</span>{" "}
              <span className="qh-l">that leaves <span className="qh-nw"><span className="qh-grad">a spec</span>,</span></span>{" "}
              <span className="qh-l qh-soft">not notes.</span>
            </h1>
          </div>
          <div>
            <p className="qh-lede">
              Quantlys Meeting is video in a browser tab. Guests need a link, not
              an account. Turn captions on, and the working session writes a PRD —
              problem, user stories, acceptance criteria, decisions, and open
              questions.
            </p>
            <div className="qh-cta">
              <Link className="qh-btn qh-btn-p" href="/host">
                Host a meeting <Arrow />
              </Link>
              <a className="qh-btn qh-btn-g" href="#prd">
                Read a spec it is built to write
              </a>
            </div>
            <p className="qh-fine">
              Only the host signs in. Everyone else joins in one click. Nothing to
              download.
            </p>
          </div>
          <aside className="qh-for" aria-label="Built for">
            <p className="qh-k">Built for</p>
            <ul>
              <li>Product reviews <span>→ PRD</span></li>
              <li>Spec sessions <span>→ decisions</span></li>
              <li>Podcasts <span>→ chapters</span></li>
              <li>Books &amp; oral history <span>→ .md</span></li>
            </ul>
          </aside>
        </div>
        <HeroVisual />
      </header>

      {/* ── Stack strip (tech, not customers) ──────────────────────── */}
      <section className="qh-stack qh-rv" aria-label="Runs on">
        <p className="qh-k">Runs on infrastructure you can own · bring your own keys</p>
        <ul>
          <li>LiveKit</li><li>Deepgram</li><li>Supabase</li><li>Vercel</li>
          <li>OpenAI / OpenRouter</li><li>S3-compatible storage</li>
        </ul>
      </section>

      {/* ── Manifesto ──────────────────────────────────────────────── */}
      <section className="qh-manifesto qh-rv">
        <p className="qh-k">Software that shows its work</p>
        <p className="qh-big">
          Recaps tell you what was said. <span>A spec tells an engineer what to
          build.</span> Quantlys Meeting writes the spec — and answers from the
          transcript, <em>with the moment it came from.</em>
        </p>
      </section>

      {/* ── The spec ───────────────────────────────────────────────── */}
      <section className="qh-sec qh-split" id="prd">
        <div className="qh-rv">
          <p className="qh-k">What the room actually does</p>
          <h2>The meeting is the product review. The PRD is the minutes.</h2>
          <p>
            Zoom and Meet recap the conversation. Notetakers write notes. You
            still spend the next two hours turning that into something an
            engineer can build. Quantlys rolls every recorded meeting on a
            project into one markdown PRD you can download and paste into
            Conclave, Linear, or GitHub.
          </p>
          <p>
            A live agent can work through a rubric in the pauses — Agile
            Engineering, Game Studio, Research, Data &amp; BI, Ideation — and
            puts one follow-up question on everyone&apos;s screen when there is
            a real gap. Decisions get caught as they are said. Ask the meeting a
            question and it answers from the transcript, with the moment it came
            from.
          </p>
          <p className="qh-links-inline">
            <Link href="/example-prd">See the full example PRD <Arrow /></Link>
            <Link href="/notes-vs-prd">Notes vs a PRD <Arrow /></Link>
          </p>
        </div>
        <article className="qh-prd qh-rv">
          <div className="qh-prd-bar">
            <span className="qh-win-dots"><i /><i /><i /></span>
            <span className="qh-mono">Example PRD · specimen, not a customer recording</span>
          </div>
          <div className="qh-prd-body">
            <div className="qh-chips">
              <span className="qh-chip">Project: billing-v2</span>
              <span className="qh-chip">3 recorded meetings</span>
            </div>
            <h3>PRD · Self-serve plan change</h3>
            <p>
              Let a workspace admin move between Free, Pro, and Max without a
              ticket, and show the invoice impact before they confirm.
            </p>
            <h4>Problem</h4>
            <p>
              Admins email support to change plans. Finance cannot see proration
              before the change lands. Two of three calls named this as the
              reason upgrades stall.
            </p>
            <h4>User stories</h4>
            <ul>
              <li>As an admin, I can preview the next invoice before I confirm a plan change.</li>
              <li>As finance, I can see who changed a plan and the proration that applied.</li>
            </ul>
            <h4>Acceptance criteria</h4>
            <ul className="qh-ac">
              <li><Check /> Preview matches the invoice generated within $0.01.</li>
              <li><Check /> Downgrades take effect at period end unless the admin opts into immediate.</li>
            </ul>
            <div className="qh-caught">
              <span>Decision caught · 18:14</span>
              Maya: “We will not prorate downgrades mid-cycle.”
            </div>
            <h4>Non-goals</h4>
            <p>No annual-contract self-serve. No seat-level plans in this pass.</p>
            <h4>Open</h4>
            <p>Tax on proration for EU VAT — parked. Jules to confirm with counsel.</p>
          </div>
        </article>
      </section>

      {/* ── Comparison ─────────────────────────────────────────────── */}
      <section className="qh-sec qh-center">
        <div className="qh-rv">
          <p className="qh-k">Recap vs. spec</p>
          <h2>Same call. Different thing at the end of it.</h2>
        </div>
        <div className="qh-compare qh-rv">
          <div className="qh-cmp-a">
            <p className="qh-cmp-h"><Mark size={18} /> Quantlys Meeting</p>
            <ul>
              <li><Check /> A markdown PRD: problem, stories, acceptance criteria, decisions, open questions</li>
              <li><Check /> Asks follow-up questions in the pauses, while people are still in the room</li>
              <li><Check /> Every recorded meeting on a project rolls into one spec</li>
              <li><Check /> Guests join from a link — no download, no account</li>
              <li><Check /> Our cloud, or yours: MIT-licensed and self-hostable</li>
            </ul>
          </div>
          <div className="qh-cmp-b">
            <p className="qh-cmp-h">A typical recap or AI notetaker</p>
            <ul>
              <li><span>—</span> A transcript and a summary</li>
              <li><span>—</span> Listens; the gaps surface after the call</li>
              <li><span>—</span> One recap per meeting</li>
              <li><span>—</span> Often an app, an extension, or a bot to admit</li>
              <li><span>—</span> Usually runs only on the vendor&apos;s cloud</li>
            </ul>
          </div>
        </div>
        <p className="qh-center-link qh-rv">
          <Link href="/recap-vs-prd">Recap vs a PRD</Link>
          <span>·</span>
          <Link href="/ai-meeting-assistant-prd">AI meeting assistant → PRD</Link>
        </p>
      </section>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section className="qh-sec" id="how">
        <div className="qh-rv">
          <p className="qh-k">How it works</p>
          <h2>Host. Record. Build the PRD.</h2>
        </div>
        <ol className="qh-steps">
          <li className="qh-card qh-rv">
            <span className="qh-n">01 · Host</span>
            <h3>A link, not an app</h3>
            <p>
              Sign in with an email code. Guests join from any browser with a
              name. Waiting room, lock, screen share, whiteboard, captions.
              Nothing to download.
            </p>
          </li>
          <li className="qh-card qh-rv">
            <span className="qh-n">02 · Record</span>
            <h3>The room writes itself down</h3>
            <p>
              Tick recording. Everyone sees a red badge. Captions on, and
              decisions, commitments, and action items land while you talk.
              Off-record is a choice, not a buried setting.
            </p>
          </li>
          <li className="qh-card qh-rv">
            <span className="qh-n">03 · Spec</span>
            <h3>One project, one PRD</h3>
            <p>
              Put a project name on the meeting. Every recorded session on that
              project is read together. Host console: Build the PRD. Download
              .md. The recording itself downloads as one continuous HD 720p
              MP4/WebM with captions.
            </p>
          </li>
        </ol>
      </section>

      {/* ── Bento: shipped features ────────────────────────────────── */}
      <section className="qh-sec">
        <div className="qh-rv">
          <p className="qh-k">Shipped, not promised</p>
          <h2>What you can do today</h2>
        </div>
        <div className="qh-bento">
          <article className="qh-b qh-b-wide qh-rv">
            <p className="qh-n">Ask this meeting</p>
            <h3>Answered from the transcript, with the timestamp.</h3>
            <div className="qh-qa" aria-hidden="true">
              <p className="qh-q">Did we agree on downgrades?</p>
              <p className="qh-a">
                Yes — no mid-cycle proration; downgrades land at period end.
                <span className="qh-ts">from the transcript · 18:14</span>
              </p>
            </div>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">Live notes</p>
            <h3>Decisions and commitments caught as they are said.</h3>
            <div className="qh-mini-caught" aria-hidden="true">Decision caught</div>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">PRD agent in the room</p>
            <h3>Works the rubric in the pauses — and stays quiet otherwise.</h3>
            <div className="qh-gaps" aria-hidden="true">
              <span className="done">Problem</span><span className="done">Stories</span>
              <span>Acceptance</span><span>Rollout</span>
            </div>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">Search</p>
            <h3>Search every recording you own.</h3>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">After the call</p>
            <h3>Talk balance and who owes what.</h3>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">Weekly digest</p>
            <h3>What is still open, back next Monday.</h3>
          </article>
          <article className="qh-b qh-b-2 qh-rv">
            <p className="qh-n">Room controls</p>
            <h3>Waiting room, room lock, screen share, whiteboard.</h3>
          </article>
          <article className="qh-b qh-rv">
            <p className="qh-n">Calendar</p>
            <h3>A calendar invite (.ics) from the host console.</h3>
          </article>
        </div>
      </section>

      {/* ── Spec sheet band ────────────────────────────────────────── */}
      <section className="qh-band qh-rv" aria-label="Spec sheet">
        <p className="qh-k">Spec sheet, not vanity metrics</p>
        <dl>
          <div><dt>0</dt><dd>downloads or accounts for guests</dd></div>
          <div><dt>1</dt><dd>PRD per project, across every recorded meeting</dd></div>
          <div><dt>720p</dt><dd>continuous HD recording, MP4 or WebM</dd></div>
          <div><dt>MIT</dt><dd>licensed — clone it and run your own stack</dd></div>
        </dl>
      </section>

      {/* ── Memory ─────────────────────────────────────────────────── */}
      <section className="qh-sec qh-split" id="memory">
        <div className="qh-rv">
          <p className="qh-k">Second surface</p>
          <h2>Memory mode for podcasts, books, and oral history.</h2>
          <p>
            Not every session is a product review. From the host console, launch
            Memory — record with captions, group episodes, and take each one
            home as a continuous HD 720p video (MP4 or WebM), captions (.vtt /
            .srt), audio clips, and a story / manuscript <code>.md</code>. Not a
            transcript-only handoff.
          </p>
          <div className="qh-cta">
            <Link className="qh-btn qh-btn-p" href="/memory-mode">
              How Memory mode works
            </Link>
            <Link className="qh-btn qh-btn-g" href="/host">
              Open host console
            </Link>
          </div>
          <p className="qh-links-inline">
            <Link href="/podcast-recording-in-browser">Podcast recording in the browser <Arrow /></Link>
          </p>
        </div>
        <div className="qh-files qh-rv" aria-label="What each Memory episode exports">
          <div className="qh-prd-bar">
            <span className="qh-win-dots"><i /><i /><i /></span>
            <span className="qh-mono">episode · exports</span>
          </div>
          <ul>
            <li><span className="qh-ext">video</span>Full take <em>MP4 · WebM in Firefox</em></li>
            <li><span className="qh-ext">captions</span>Subtitles <em>.vtt · .srt</em></li>
            <li><span className="qh-ext">audio</span>Episode &amp; chapter audio <em>m4a/webm · WAV cuts</em></li>
            <li><span className="qh-ext">text</span>Story / manuscript <em>.md</em></li>
          </ul>
        </div>
      </section>

      {/* ── Open source ────────────────────────────────────────────── */}
      <section className="qh-sec" id="own">
        <div className="qh-own qh-rv">
          <div>
            <p className="qh-k">Open source · MIT</p>
            <h2>Use it on our cloud until you don’t trust us.</h2>
            <p>
              The long game is not another SaaS notetaker. It is a meeting you
              can run on your servers, with your models, with your data. Source
              is open on GitHub — clone it, plug your own keys, run your own
              stack.
            </p>
            <p className="qh-honest">
              <span>Hosted today. Yours when you want it.</span>
              Captions, recording, and the spec run on our cloud at
              quantlys-meeting.com. The same app runs with your LiveKit,
              Deepgram, Supabase, OpenAI/OpenRouter, and S3 keys. Source:{" "}
              <a href={GH}>github.com/SantoshA1/quantlys-meet</a>
              {" · "}
              <a href={RELEASE}>v1.0.0-oss</a>
              {" · "}
              <Link href="/open-source-video-meeting">open-source video meeting</Link>
              {" · dogfood for "}
              <a href="https://www.quantlys.ai/">the Quantlys AI platform</a>
              {" · "}
              <Link href="/about">about</Link>.
            </p>
            <div className="qh-cta">
              <a className="qh-btn qh-btn-p" href={GH}>View on GitHub <Arrow /></a>
              <Link className="qh-btn qh-btn-g" href="/self-hosted-video-conferencing">
                Self-hosting guide
              </Link>
            </div>
          </div>
          <pre className="qh-term" aria-label="Self-host quick start">
            <code>
              <span className="c"># clone it</span>{"\n"}
              <span className="p">$</span> git clone {GH}{"\n"}
              <span className="p">$</span> cp .env.example .env.local{"\n"}
              {"\n"}
              <span className="c"># your keys, your data</span>{"\n"}
              LIVEKIT_URL=<span className="v">wss://…</span>{"\n"}
              DEEPGRAM_API_KEY=<span className="v">…</span>{"\n"}
              NEXT_PUBLIC_SUPABASE_URL=<span className="v">…</span>{"\n"}
              OPENROUTER_API_KEY=<span className="v">…</span>{"\n"}
              S3_BUCKET=<span className="v">…</span>{"\n"}
              {"\n"}
              <span className="p">$</span> npm install &amp;&amp; npm run build
            </code>
          </pre>
        </div>
      </section>

      {/* ── Join / host ────────────────────────────────────────────── */}
      <section className="qh-sec" id="join">
        <div className="qh-rv">
          <p className="qh-k">Start</p>
          <h2>Join as a guest, or host the next spec session.</h2>
        </div>
        <div className="qh-join">
          <section className="qh-card qh-rv">
            <h3>Join a meeting</h3>
            {guestsOk ? (
              <>
                <p className="qh-muted">Paste a meeting link or code — no account needed.</p>
                <div className="qh-row">
                  <input
                    className="qh-input"
                    placeholder="Meeting link or code"
                    aria-label="Meeting link or code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && joinAsGuest()}
                  />
                  <button
                    className="qh-btn qh-btn-p"
                    onClick={joinAsGuest}
                    disabled={busy || !code.trim()}
                  >
                    {busy ? "Finding…" : "Join as guest"}
                  </button>
                </div>
                {note ? <p className="qh-note">{note}</p> : null}
              </>
            ) : (
              <p className="qh-muted">
                Guest join is off on this deployment. Sign in to host, or ask
                the operator to set ALLOW_GUEST_JOIN=true (and the NEXT_PUBLIC_
                mirror) and redeploy.
              </p>
            )}
          </section>

          <section className="qh-card qh-card-host qh-rv">
            <h3>Host a meeting</h3>
            {!ready ? (
              <p className="qh-muted">Loading…</p>
            ) : email ? (
              <>
                <p className="qh-muted">
                  Signed in as {email}. Your meetings, invite links and
                  recordings live on your host page.
                </p>
                <button className="qh-btn qh-btn-p" onClick={() => router.push("/host")}>
                  Go to my host page
                </button>
              </>
            ) : (
              <>
                <p className="qh-muted">
                  Only the host needs an account. We&apos;ll email you a 6-digit
                  code — everyone you invite joins with one click.
                </p>
                <button className="qh-btn qh-btn-p" onClick={() => router.push("/host")}>
                  Sign in to host
                </button>
              </>
            )}
          </section>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────── */}
      <section className="qh-sec qh-faq" id="faq">
        <div className="qh-rv">
          <p className="qh-k">FAQ</p>
          <h2>Quantlys Meeting is not Quantalys.</h2>
        </div>
        <div className="qh-qs">
          <details open className="qh-rv">
            <summary><span className="qh-mono">01</span><h3>What is Quantlys Meeting?</h3></summary>
            <p>
              A browser video meeting. Guests join from a link. The recorded
              session writes a markdown PRD: user stories, acceptance criteria,
              decisions, and open questions.
            </p>
          </details>
          <details className="qh-rv">
            <summary><span className="qh-mono">02</span><h3>Is Quantlys Meeting the same as Quantalys?</h3></summary>
            <p>
              No. Quantlys Meeting is a spec-session video product at
              quantlys-meeting.com. Quantalys is an unrelated fund-data company.
            </p>
          </details>
          <details className="qh-rv">
            <summary><span className="qh-mono">03</span><h3>Is it open source?</h3></summary>
            <p>
              Yes — MIT at <a href={GH}>github.com/SantoshA1/quantlys-meet</a>.
              Bring your own LiveKit, Deepgram, Supabase, and model keys. Details:{" "}
              <Link href="/open-source-video-meeting">open-source video meeting</Link>.
            </p>
          </details>
          <details className="qh-rv">
            <summary><span className="qh-mono">04</span><h3>What is Memory mode?</h3></summary>
            <p>
              A second host-console surface for podcasts (chapters/clips), books,
              and oral history — not a product-review PRD. Each episode downloads
              as one continuous HD 720p video (MP4 or WebM), captions (.vtt /
              .srt), audio (m4a + WAV cuts), and a markdown package.{" "}
              <Link href="/memory-mode">Memory mode</Link>.
            </p>
          </details>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────────────── */}
      <section className="qh-final qh-rv">
        <Mark size={40} />
        <h2>Your next meeting can end with a spec.</h2>
        <p>Run it on our cloud, or on your own keys.</p>
        <div className="qh-cta qh-cta-c">
          <Link className="qh-btn qh-btn-p" href="/host">
            Host a meeting <Arrow />
          </Link>
          <a className="qh-btn qh-btn-g" href={GH}>
            Read the source on GitHub
          </a>
        </div>
      </section>

      <footer className="qh-foot">
        <div className="qh-foot-top">
          <div className="qh-foot-brand">
            <Link href="/" className="qh-brand">
              <Mark />
              <span>Quantlys <em>Meeting</em></span>
            </Link>
            <p>
              The video meeting that leaves a spec. Built on{" "}
              <a href="https://www.quantlys.ai/">Quantlys</a> by{" "}
              <a href="https://santoshadari.com/">Santosh Adari</a>.
            </p>
          </div>
          <div className="qh-foot-cols">
            <div>
              <p className="qh-k">Product</p>
              <Link href="/host">Host</Link>
              <Link href="/memory-mode">Memory</Link>
              <Link href="/example-prd">Example PRD</Link>
              <Link href="/browser-video-meeting-no-download">No-download meetings</Link>
              <Link href="/podcast-recording-in-browser">Podcast recording</Link>
            </div>
            <div>
              <p className="qh-k">Compare</p>
              <Link href="/ai-meeting-assistant-prd">AI meeting assistant → PRD</Link>
              <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
              <Link href="/prd-from-meeting">PRD from meeting</Link>
              <Link href="/notes-vs-prd">Notes vs PRD</Link>
              <Link href="/recap-vs-prd">Recap vs a PRD</Link>
            </div>
            <div>
              <p className="qh-k">Open source</p>
              <a href="#own">Open source</a>
              <Link href="/open-source-video-meeting">Open-source video conferencing</Link>
              <Link href="/open-source-zoom-alternative">Open-source Zoom alternative</Link>
              <Link href="/self-hosted-video-conferencing">Self-hosted video conferencing</Link>
              <a href={GH}>GitHub</a>
              <a href={RELEASE}>v1.0.0-oss</a>
            </div>
            <div>
              <p className="qh-k">Company</p>
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy</Link>
              <a href="https://www.quantlys.ai/">Built on Quantlys</a>
              <a href="https://santoshadari.com/">Santosh Adari</a>
            </div>
          </div>
        </div>
        <div className="qh-foot-bot">
          <span>
            © Quantlys · Agility Business Services ·{" "}
            <a href="https://www.quantlys.ai/">quantlys.ai</a>
            {" · "}Built by <a href="https://santoshadari.com/">Santosh Adari</a>
          </span>
          <span className="qh-mono">MIT · v1.0.0-oss</span>
        </div>
      </footer>
    </div>
  );
}
