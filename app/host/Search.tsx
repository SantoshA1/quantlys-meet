"use client";

// Search across every meeting.
//
// FIELD 2026-08-18: Ask worked on one recording. But nobody remembers which
// meeting a thing was said in — that is the whole reason they are searching.
//
// Two things this screen refuses to do, because they are how search loses
// people's trust:
//
//  1. Report a count instead of the evidence. "Billing Sync — 3 matches" makes
//     you open the meeting and find them yourself, which is the work you were
//     trying to avoid. Every result shows the actual sentences, with the
//     seconds, and every one of them is a button that plays that moment.
//
//  2. Say "no results" without saying how much it read. A search that quietly
//     covered a fraction of the archive and came back empty is worse than no
//     search: you now believe the thing was never said.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { highlight, parseQuery } from "@/lib/search";

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

function fmtAt(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function day(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const KIND_LABEL: Record<string, string> = {
  decision: "decided", action: "action", topic: "notes", title: "title", said: "",
};

/** Marks the words that actually matched — using the same stemmer the ranking
 *  used, so what is highlighted is what was scored. Returns pieces rather than
 *  an HTML string: nothing from a transcript is ever handed to innerHTML. */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => highlight(text, terms), [text, terms]);
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i} className="qs-hit">{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </>
  );
}

const OPENERS = [
  "What did we decide about pricing?",
  "Who owns the integration?",
  "What did we say about the deadline?",
];

export default function Search() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState("");
  const [playLabel, setPlayLabel] = useState("");
  const box = useRef<HTMLInputElement | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null);

  // "/" focuses the box, the way every tool people already use behaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || (t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const terms = useMemo(() => {
    const p = parseQuery(q);
    return [...p.raw, ...p.phrases.flatMap((s) => s.split(" "))];
  }, [q]);

  const run = useCallback(async (text: string) => {
    const query = (text || "").trim();
    if (!query || busy) return;
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ q: query }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j?.error || `Search failed (${r.status}).`);
      else setRes(j);
    } catch {
      setErr("Couldn't reach search just now.");
    }
    setBusy(false);
  }, [busy]);

  /** Play a specific second of a specific meeting. The seconds are the point:
   *  a result you have to go and find inside a fifty-minute video is a result
   *  that saved you nothing. */
  async function open(path: string, at: number, label: string) {
    if (!path) return;
    const { data, error } = await db().storage.from("recordings").createSignedUrl(path, 3600);
    if (error || !data) { setErr(`Couldn't open that recording: ${error?.message}`); return; }
    const sec = Math.max(0, Math.floor(at || 0));
    setPlayLabel(`${label}${at >= 0 ? ` · from ${fmtAt(sec)}` : ""}`);
    setPlaying(`${data.signedUrl}#t=${sec}`);
    // The media fragment gets it right on first load; this catches the browsers
    // that ignore it, and re-seeking when the same file is already open.
    requestAnimationFrame(() => {
      const v = vid.current;
      if (!v) return;
      const seek = () => { try { v.currentTime = sec; } catch {} };
      if (v.readyState >= 1) seek();
      v.addEventListener("loadedmetadata", seek, { once: true });
      v.play().catch(() => {});
    });
  }

  const hits: any[] = res?.hits || [];

  return (
    <section className="qm-card qs">
      <h2>Search every meeting</h2>
      <p className="qs-lede">
        Every word from every recording you own. Ask it like a question — the
        answer comes back with the moment somebody said it.
      </p>

      <div className="qs-row">
        <input
          ref={box}
          className="qs-in"
          placeholder="What did we decide about the billing provider?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(q)}
          aria-label="Search every meeting"
        />
        <button className="qs-go" onClick={() => run(q)} disabled={busy || !q.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      <div className="qs-tips">
        <code>&quot;exact phrase&quot;</code> · <code>-exclude</code> ·{" "}
        <code>who:kiran</code> — only what one person said · press <kbd>/</kbd> to search
      </div>

      {!res && !err && !busy ? (
        <div className="qs-chips">
          {OPENERS.map((o) => (
            <button key={o} className="qs-chip" onClick={() => { setQ(o); run(o); }}>{o}</button>
          ))}
        </div>
      ) : null}

      {err ? <p className="qs-err">{err}</p> : null}

      {playing ? (
        <div className="qs-play">
          <div className="qs-playtop">
            <span>{playLabel}</span>
            <button className="qs-x" onClick={() => { setPlaying(""); setPlayLabel(""); }}>Close</button>
          </div>
          <video ref={vid} className="qm-player" src={playing} controls autoPlay playsInline />
        </div>
      ) : null}

      {res ? (
        <>
          {res.answer?.answer ? (
            <div className="qs-answer">
              <div className="qs-alabel">{res.answer.grounded ? "Answer" : "Not settled in your meetings"}</div>
              <p className={res.answer.grounded ? "" : "qs-dim"}>{res.answer.answer}</p>
              {(res.answer.cites || []).map((c: any, i: number) => {
                const h = hits.find((x) => x.id === c.id);
                return (
                  <button
                    key={i}
                    className="qs-cite"
                    onClick={() => open(h?.videoPath, c.at, h?.title || h?.room || c.meeting)}
                    disabled={!h?.videoPath}
                  >
                    <span className="qs-at">{c.at >= 0 ? fmtAt(c.at) : "notes"}</span>
                    <span className="qs-who">{c.who}</span>
                    <span className="qs-quote">&ldquo;{c.quote}&rdquo;</span>
                    <span className="qs-from">{c.meeting}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {res.answerNote ? <p className="qs-note">{res.answerNote}</p> : null}

          <div className="qs-count">
            {hits.length
              ? `${res.matched.passages} moment${res.matched.passages === 1 ? "" : "s"} across ` +
                `${res.matched.meetings} meeting${res.matched.meetings === 1 ? "" : "s"} — ` +
                `searched all ${res.scanned.meetings} of your recordings.`
              : res.scanned.meetings
                ? `Nothing about that in any of your ${res.scanned.meetings} recordings.`
                : "You have no recorded meetings yet — press Record during one and it becomes searchable."}
            {res.suggestion ? (
              <>
                {" "}
                <button className="qs-did" onClick={() => { setQ(res.suggestion); run(res.suggestion); }}>
                  Did you mean &ldquo;{res.suggestion}&rdquo;?
                </button>
              </>
            ) : null}
          </div>
          {res.note ? <p className="qs-note">{res.note}</p> : null}

          {hits.map((h) => (
            <div className="qs-hitcard" key={h.id}>
              <div className="qs-hhead">
                <span className="qs-htitle">{h.title || h.room}</span>
                <span className="qs-hmeta">
                  {day(h.when)}
                  {" · "}
                  {h.hitCount} match{h.hitCount === 1 ? "" : "es"}
                  {h.hitCount > h.moments.length ? ` · showing ${h.moments.length}` : ""}
                </span>
              </div>
              {h.moments.map((m: any, i: number) => (
                <button
                  key={i}
                  className="qs-moment"
                  onClick={() => open(h.videoPath, m.at, h.title || h.room)}
                  disabled={!h.videoPath}
                  title={h.videoPath ? "Play from this moment" : "No video was kept for this meeting"}
                >
                  <span className="qs-at">
                    {m.at >= 0 ? fmtAt(m.at) : KIND_LABEL[m.kind] || m.kind}
                  </span>
                  {m.who ? <span className="qs-who">{m.who}</span> : null}
                  <span className="qs-quote"><Marked text={m.text} terms={terms} /></span>
                </button>
              ))}
            </div>
          ))}
        </>
      ) : null}

      <style>{CSS}</style>
    </section>
  );
}

const CSS = `
.qs h2 { margin-bottom:4px; }
.qs-lede { color:#8b93a5; font-size:13.5px; line-height:1.6; margin:0 0 14px; max-width:62ch; }
.qs-row { display:flex; gap:8px; }
.qs-in { flex:1 1 auto; min-width:0; background:#0b0e14; color:#e9edf5;
  border:1px solid #2c3342; border-radius:10px; padding:12px 14px; font:inherit; font-size:15px; }
.qs-in:focus { outline:0; border-color:#00a99d; box-shadow:0 0 0 3px rgba(0,169,157,.14); }
.qs-in::placeholder { color:#5a6272; }
.qs-go { font:inherit; font-size:14px; font-weight:600; cursor:pointer; padding:0 18px;
  background:#0d3d39; color:#7fe0d6; border:1px solid #00a99d; border-radius:10px; }
.qs-go:disabled { opacity:.5; cursor:default; }
.qs-tips { color:#6f7789; font-size:12px; margin:9px 0 0; line-height:1.7; }
.qs-tips code { background:#151a23; border:1px solid #262b36; border-radius:5px;
  padding:1px 6px; color:#9aa3b4; font-size:11.5px; }
.qs-tips kbd { background:#151a23; border:1px solid #363d4c; border-bottom-width:2px;
  border-radius:5px; padding:0 5px; color:#cfd6e4; font-size:11px; }
.qs-chips { display:flex; gap:6px; flex-wrap:wrap; margin:14px 0 0; }
.qs-chip { font:inherit; font-size:12.5px; cursor:pointer; background:#151a23;
  color:#9aa3b4; border:1px solid #262b36; border-radius:999px; padding:6px 12px; }
.qs-chip:hover { color:#cfd6e4; border-color:#3b4356; }
.qs-err { background:#2a1618; border:1px solid #5a2a2f; color:#ffb4b4;
  border-radius:10px; padding:10px 13px; font-size:13.5px; margin:14px 0 0; }
.qs-note { color:#f0d9a6; background:#1d1a12; border:1px solid #4a4021;
  border-radius:9px; padding:9px 12px; font-size:12.5px; line-height:1.55; margin:12px 0 0; }
.qs-count { color:#8b93a5; font-size:13px; margin:18px 0 12px; }
.qs-did { font:inherit; font-size:13px; background:none; border:0; padding:0;
  color:#00a99d; cursor:pointer; text-decoration:underline; }
.qs-answer { margin:18px 0 0; padding:15px 17px; background:#0b0e14;
  border:1px solid #21252f; border-radius:11px; }
.qs-alabel { font-size:11px; letter-spacing:.09em; text-transform:uppercase;
  color:#00a99d; font-weight:700; margin:0 0 8px; }
.qs-answer > p { margin:0 0 4px; font-size:15px; line-height:1.62; color:#dbe2ee; }
.qs-dim { color:#9aa3b4; }
.qs-hitcard { border:1px solid #262b36; background:#10131a; border-radius:11px;
  padding:12px 14px; margin:0 0 10px; }
.qs-hhead { display:flex; justify-content:space-between; align-items:baseline;
  gap:10px; flex-wrap:wrap; margin:0 0 4px; }
.qs-htitle { font-size:14.5px; font-weight:600; color:#e9edf5; }
.qs-hmeta { color:#6f7789; font-size:12px; }
.qs-moment, .qs-cite { display:flex; gap:10px; align-items:baseline; width:100%;
  text-align:left; font:inherit; cursor:pointer; background:transparent; border:0;
  border-top:1px solid #1b1f28; padding:9px 0; color:#b8c0cf; font-size:13.5px; }
.qs-moment:disabled, .qs-cite:disabled { cursor:default; }
.qs-moment:hover:not(:disabled) .qs-quote, .qs-cite:hover:not(:disabled) .qs-quote { color:#e9edf5; }
.qs-at { color:#00a99d; font-variant-numeric:tabular-nums; flex:0 0 auto; font-size:12.5px; }
.qs-who { color:#8b93a5; flex:0 0 auto; }
.qs-quote { color:#9aa3b4; line-height:1.55; }
.qs-from { color:#5a6272; flex:0 0 auto; margin-left:auto; font-size:12px; }
.qs-hit { background:rgba(0,169,157,.2); color:#9df0e6; border-radius:3px; padding:0 1px; }
.qs-play { margin:16px 0; border:1px solid #262b36; border-radius:11px; overflow:hidden; }
.qs-playtop { display:flex; justify-content:space-between; align-items:center;
  gap:10px; padding:9px 13px; background:#10131a; color:#cfd6e4; font-size:13px; }
.qs-x { font:inherit; font-size:12.5px; cursor:pointer; background:transparent;
  color:#8b93a5; border:1px solid #262b36; border-radius:7px; padding:4px 10px; }
.qs-x:hover { color:#cfd6e4; }
`;
