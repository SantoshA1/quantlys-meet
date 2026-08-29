"use client";

// Marketing front door. The join/host cards at the bottom are the same
// product as before: guests look up a code, hosts go to /host. The rest of
// the page is the story that used to be missing — a meeting whose output is
// a spec, not a recap.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

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

export default function HomeLanding() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => {
        setEmail(data.session?.user?.email ?? null);
        setReady(true);
      });
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
    <div className="qml">
      <nav className="qml-nav">
        <a href="#how">How it works</a>
        <a href="#prd">The spec</a>
        <a href="#join">Join</a>
        <a href="#own">Your cloud</a>
        <span className="qml-nav-spacer" />
        <Link className="qml-btn qml-btn-primary qml-nav-host" href="/host">
          Host a meeting
        </Link>
      </nav>

      <section className="qml-hero">
        <p className="qml-kicker">Nobody takes minutes</p>
        <h1>Leave the call with a spec, not notes.</h1>
        <p className="qml-lede">
          Quantlys Meeting is video in a browser tab. Guests need a link, not an
          account. Turn captions on, and the working session writes a PRD —
          problem, user stories, acceptance criteria, decisions, and open
          questions.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <a className="qml-btn qml-btn-ghost" href="#prd">
            Read a spec it is built to write
          </a>
        </div>
        <p className="qml-fine">
          Only the host signs in. Everyone else joins in one click. Live now — no
          waitlist.
        </p>
      </section>

      <div className="qml-split">
        <div>
          <p className="qml-kicker">What the room actually does</p>
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
            Engineering, Game Studio, Research, Data &amp; BI, Ideation — and it
            speaks as the host. Decisions get caught as they are said. Ask the
            meeting a question and it answers from the transcript, with the
            moment it came from.
          </p>
        </div>
        <article className="qml-prd" id="prd">
          <div className="qml-prd-bar">
            <i />
            Example PRD · specimen, not a customer recording
          </div>
          <div className="qml-prd-body">
            <span className="qml-chip">Project: billing-v2</span>
            <span className="qml-chip">3 recorded meetings</span>
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
              <li>
                As an admin, I can preview the next invoice before I confirm a
                plan change.
              </li>
              <li>
                As finance, I can see who changed a plan and the proration that
                applied.
              </li>
            </ul>
            <h4>Acceptance criteria</h4>
            <ul>
              <li>Preview matches the invoice generated within $0.01.</li>
              <li>
                Downgrades take effect at period end unless the admin opts into
                immediate.
              </li>
            </ul>
            <div className="qml-caught">
              Decision caught · Maya: “We will not prorate downgrades mid-cycle.”
              · 18:14
            </div>
            <h4>Non-goals</h4>
            <p>No annual-contract self-serve. No seat-level plans in this pass.</p>
            <h4>Open</h4>
            <p>Tax on proration for EU VAT — parked. Jules to confirm with counsel.</p>
          </div>
        </article>
      </div>

      <section className="qml-block" id="how">
        <p className="qml-kicker">How it works</p>
        <h2>Host. Record. Build the PRD.</h2>
        <div className="qml-steps">
          <article className="qml-card">
            <span className="qml-n">01 · Host</span>
            <h3>A link, not an app</h3>
            <p>
              Sign in with an email code. Guests join from any browser with a
              name. Waiting room, lock, screen share, whiteboard, captions.
              Nothing to download.
            </p>
          </article>
          <article className="qml-card">
            <span className="qml-n">02 · Record</span>
            <h3>The room writes itself down</h3>
            <p>
              Tick recording. Everyone sees a red badge. Captions on, and
              decisions, commitments, and action items land while you talk.
              Off-record is a choice, not a buried setting.
            </p>
          </article>
          <article className="qml-card">
            <span className="qml-n">03 · Spec</span>
            <h3>One project, one PRD</h3>
            <p>
              Put a project name on the meeting. Every recorded session on that
              project is read together. Host console: Build the PRD. Download
              .md. Paste it where you ship.
            </p>
          </article>
        </div>
      </section>

      <section className="qml-block">
        <p className="qml-kicker">Shipped, not promised</p>
        <h2>What you can do today</h2>
        <div className="qml-facts">
          <ul>
            <li>
              <strong>No account for guests.</strong> Paste a link or code.
            </li>
            <li>
              <strong>Live notes.</strong> Decisions and commitments caught as
              they are said.
            </li>
            <li>
              <strong>Ask this meeting.</strong> Answered from the transcript,
              with the timestamp.
            </li>
            <li>
              <strong>Search every recording you own.</strong>
            </li>
          </ul>
          <ul>
            <li>
              <strong>PRD agent in the room</strong> — works the rubric in the
              pauses.
            </li>
            <li>
              <strong>Talk balance / who owes what</strong> after the call.
            </li>
            <li>
              <strong>Weekly digest</strong> of what is still open, back next
              Monday.
            </li>
            <li>
              <strong>Calendar invite (.ics)</strong> from the host console.
            </li>
          </ul>
        </div>
      </section>

      <section className="qml-block" id="own">
        <p className="qml-kicker">Second act</p>
        <h2>Use it on our cloud until you don’t trust us.</h2>
        <p className="qml-narrow">
          The long game is not another SaaS notetaker. It is a meeting you can
          run on your servers, with your models, with your data. Source is
          private today. When we open it, this page will carry the date and the
          license — not a slogan.
        </p>
        <p className="qml-honest">
          <span>Honesty, not adjectives</span>
          Captions and transcription currently use Deepgram. Video runs on
          LiveKit. Auth, meetings, and recordings sit on Supabase. The app is
          hosted on Vercel. We do not claim “private by default” while those
          subprocessors hear the room. A public privacy page naming them is
          next. Self-host and bring-your-own-model are the path, not a feature
          toggle today.
        </p>
      </section>

      <section className="qml-block" id="join">
        <p className="qml-kicker">Start</p>
        <h2>Join as a guest, or host the next spec session.</h2>
        <div className="qml-join">
          <section className="qml-card">
            <h3>Join a meeting</h3>
            <p className="qml-muted">Paste a meeting link or code — no account needed.</p>
            <div className="qml-row">
              <input
                className="qml-input"
                placeholder="Meeting link or code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && joinAsGuest()}
              />
              <button
                className="qml-btn qml-btn-primary"
                onClick={joinAsGuest}
                disabled={busy || !code.trim()}
              >
                {busy ? "Finding…" : "Join as guest"}
              </button>
            </div>
            {note ? <p className="qml-note">{note}</p> : null}
          </section>

          <section className="qml-card">
            <h3>Host a meeting</h3>
            {!ready ? (
              <p className="qml-muted">Loading…</p>
            ) : email ? (
              <>
                <p className="qml-muted">
                  Signed in as {email}. Your meetings, invite links and
                  recordings live on your host page.
                </p>
                <button className="qml-btn qml-btn-primary" onClick={() => router.push("/host")}>
                  Go to my host page
                </button>
              </>
            ) : (
              <>
                <p className="qml-muted">
                  Only the host needs an account. We&apos;ll email you a 6-digit
                  code — everyone you invite joins with one click.
                </p>
                <button className="qml-btn qml-btn-primary" onClick={() => router.push("/host")}>
                  Sign in to host
                </button>
              </>
            )}
          </section>
        </div>
      </section>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>
        </span>
        <span>
          <Link href="/host">Host</Link>
          <a href="#own">Stack</a>
          <span>Privacy (soon)</span>
          <span>Source: private until dated</span>
        </span>
      </footer>
    </div>
  );
}
