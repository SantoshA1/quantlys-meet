"use client";

// A recording you cannot find is not a recording. This is where they live —
// with the summary that was written after the meeting.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hms } from "@/lib/intelligence";
import { durationSecondsFromSummary } from "@/lib/recording-flush";
import { videoQualityLabel } from "@/lib/recording-quality";
import { captionsFile, type CaptionFormat } from "@/lib/caption-export";
import {
  resolveSessionMode,
  recordingsActionsTab, recordingsActionsHead, recordingsActionsEmpty,
  recordingsActionsFoot, recordingsAskHead, recordingsAskOpeners,
  recordingsSummaryDecisionsHead, recordingsSummaryFollowupsHead,
  recordingsSummaryTopicsHead,
} from "@/lib/session-ui";

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

type Rec = {
  path: string;
  room: string;
  when: string;
  size: number;
  duration?: number | null;
  /** "1080p" when the recorder reported the take's size. */
  quality?: string;
  audioPath?: string;
  summaryPath?: string;
};

const VIDEO_EXT = /\.(mp4|webm)$/i;
const AUDIO_EXT = /\.(m4a|audio\.webm)$/i;
const SUMMARY_EXT = /\.summary\.json$/i;

function pretty(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function stem(name: string) {
  return name.replace(SUMMARY_EXT, "").replace(AUDIO_EXT, "").replace(VIDEO_EXT, "");
}

export default function Recordings({ userId }: { userId: string }) {
  const [items, setItems] = useState<Rec[]>([]);
  const [note, setNote] = useState("Loading…");
  const [playing, setPlaying] = useState("");
  const player = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState<Record<string, string>>({});
  // The notes arrive as STRUCTURE now, not a wall of text, so they are held
  // as the parsed object and rendered as sections. Re-parsing headings back
  // out of a formatted string is how a summary loses its shape.
  const [payload, setPayload] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<Record<string, string>>({});

  // FIELD 2026-08-18 (Conclave round 39): this asked for 100 folders and 200
  // files and then rendered the answer as "your recordings". Somebody with a
  // longer history than that would see a list that simply stopped, with no
  // error and nothing saying it had stopped — so the honest reading is that
  // the older ones were lost. Page until a page comes back short.
  async function listAll(prefix: string, cap: number) {
    const out: any[] = [];
    for (let offset = 0; offset < cap; offset += 100) {
      const r = await db().storage.from("recordings").list(prefix, { limit: 100, offset });
      if (r.error) return { rows: out, error: r.error.message };
      const page = r.data ?? [];
      out.push(...page);
      if (page.length < 100) break;
    }
    return { rows: out, error: "" };
  }

  const load = useCallback(async () => {
    const rooms = await listAll(userId, 2000);
    if (rooms.error && !rooms.rows.length) {
      setNote(`Could not read your recordings: ${rooms.error}`);
      return;
    }
    const out: Rec[] = [];
    for (const folder of rooms.rows) {
      if (folder.id) continue; // a stray file at the top level, not a meeting folder
      const files = await listAll(`${userId}/${folder.name}`, 1000);
      const byStem = new Map<string, Rec>();
      for (const f of files.rows) {
        const key = stem(f.name);
        const rec =
          byStem.get(key) ||
          ({ path: "", room: folder.name, when: key.replace("T", " ").slice(0, 16), size: 0 } as Rec);
        const full = `${userId}/${folder.name}/${f.name}`;
        if (SUMMARY_EXT.test(f.name)) rec.summaryPath = full;
        else if (AUDIO_EXT.test(f.name)) rec.audioPath = full;
        else if (VIDEO_EXT.test(f.name)) {
          rec.path = full;
          rec.size = (f.metadata as any)?.size ?? 0;
        }
        byStem.set(key, rec);
      }
      byStem.forEach((r) => r.path && out.push(r));
    }
    out.sort((a, b) => (a.when < b.when ? 1 : -1));
    const stamped = await Promise.all(out.map(async (r) => {
      if (!r.summaryPath) return r;
      const { data, error } = await db().storage.from("recordings").download(r.summaryPath);
      if (error || !data) return r;
      try {
        const j = JSON.parse(await data.text());
        const secs = durationSecondsFromSummary(j);
        const quality = videoQualityLabel(j?.video?.height);
        return { ...r, ...(secs == null ? {} : { duration: secs }), ...(quality ? { quality } : {}) };
      } catch {
        return r;
      }
    }));
    setItems(stamped);
    setNote(stamped.length ? "" : "No recordings yet — press Record during a meeting.");
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function signed(path: string, seconds: number, download = false) {
    const { data, error } = await db()
      .storage.from("recordings")
      .createSignedUrl(path, seconds, download ? { download: true } : undefined);
    if (error || !data) {
      setNote(`Could not open that file: ${error?.message}`);
      return "";
    }
    return data.signedUrl;
  }

  async function play(path: string, at?: number) {
    const u = await signed(path, 3600);
    if (!u) return;
    // FIELD 2026-08-18: this took the second and dropped it. A citation you
    // still have to scrub for is a citation you have to verify by hand, which
    // is exactly the work it was supposed to remove. The media fragment gets
    // it right on load; the listener catches the browsers that ignore it and
    // the case where the same file is already open.
    const sec = Math.max(0, Math.floor(at || 0));
    setPlaying(sec ? `${u}#t=${sec}` : u);
    if (!sec) return;
    requestAnimationFrame(() => {
      const v = player.current;
      if (!v) return;
      const seek = () => { try { v.currentTime = sec; } catch {} };
      if (v.readyState >= 1) seek();
      v.addEventListener("loadedmetadata", seek, { once: true });
      v.play().catch(() => {});
    });
  }

  async function get(path: string) {
    const u = await signed(path, 300, true);
    if (u) window.location.href = u;
  }

  // Captions from the same timed lines "ask this meeting" cites.
  async function captions(rec: Rec, format: CaptionFormat) {
    if (!rec.summaryPath) return;
    const { data, error } = await db().storage.from("recordings").download(rec.summaryPath);
    if (error || !data) {
      setNote(`Could not read the transcript: ${error?.message}`);
      return;
    }
    try {
      const j = JSON.parse(await data.text());
      const lines = Array.isArray(j?.utterances) ? j.utterances : [];
      const text = captionsFile(lines, format);
      if (!lines.length || !text.replace(/^WEBVTT\s*/, "").trim()) {
        setNote("No timed caption lines in this recording — turn captions on next time.");
        return;
      }
      const url = URL.createObjectURL(new Blob([text], { type: format === "srt" ? "application/x-subrip" : "text/vtt" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${rec.room}-${rec.when.replace(/[: ]/g, "-")}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setNote("That transcript file could not be read.");
    }
  }

  async function showSummary(rec: Rec) {
    if (!rec.summaryPath) return;
    if (open[rec.path]) {
      setOpen((o) => ({ ...o, [rec.path]: "" }));
      return;
    }
    const { data, error } = await db().storage.from("recordings").download(rec.summaryPath);
    if (error || !data) {
      setNote(`Could not read the summary: ${error?.message}`);
      return;
    }
    try {
      const j = JSON.parse(await data.text());
      setPayload((p) => ({ ...p, [rec.path]: j }));
      setTab((t) => ({ ...t, [rec.path]: t[rec.path] || "summary" }));
      setOpen((o) => ({ ...o, [rec.path]: "open" }));
    } catch {
      setNote("That summary file could not be read.");
    }
  }

  async function remove(rec: Rec) {
    const paths = [rec.path, rec.audioPath, rec.summaryPath].filter(Boolean) as string[];
    const { error } = await db().storage.from("recordings").remove(paths);
    if (error) {
      setNote(`Could not delete: ${error.message}`);
      return;
    }
    setPlaying("");
    load();
  }

  return (
    <section className="qm-card">
      <h2>Recordings</h2>
      {note ? <p className="qm-muted">{note}</p> : null}
      {playing ? <video ref={player} className="qm-player" src={playing} controls autoPlay playsInline /> : null}
      {items.map((r) => (
        <div key={r.path}>
          <div className="qm-item">
            <span className="qm-name">
              {r.when}
              <span className="qm-ended">
                {" · "}
                {r.room}
                {r.size ? ` · ${pretty(r.size)}` : ""}
                {r.duration ? ` · ${hms(r.duration)}` : ""}
                {r.quality ? ` · ${r.quality}` : ""}
                {r.path.endsWith(".webm") ? " · WebM (opens in Chrome)" : " · MP4"}
              </span>
            </span>
            <span className="qm-row">
              <button className="qm-ghost" onClick={() => play(r.path)}>Play</button>
              <button className="qm-ghost" onClick={() => get(r.path)} title="The continuous take, full resolution">
                Download video
              </button>
              {r.audioPath ? (
                <button className="qm-ghost" onClick={() => get(r.audioPath!)}>Audio only</button>
              ) : null}
              {r.summaryPath ? (
                <>
                  <button className="qm-ghost" onClick={() => captions(r, "vtt")} title="WebVTT captions from the timed transcript">
                    Captions .vtt
                  </button>
                  <button className="qm-ghost" onClick={() => captions(r, "srt")} title="SubRip captions from the timed transcript">
                    .srt
                  </button>
                </>
              ) : null}
              {r.summaryPath ? (
                <button className="qm-ghost" onClick={() => showSummary(r)}>
                  {open[r.path] ? "Hide summary" : "Summary"}
                </button>
              ) : null}
              <button className="qm-ghost" onClick={() => remove(r)}>Delete</button>
            </span>
          </div>
          {open[r.path] ? (
            <NotesPanel
              data={payload[r.path]}
              tab={tab[r.path] || "summary"}
              onTab={(t) => setTab((x) => ({ ...x, [r.path]: t }))}
              summaryPath={r.summaryPath || ""}
              onSeek={(sec) => play(r.path, sec)}
            />
          ) : null}
        </div>
      ))}
      <style dangerouslySetInnerHTML={{ __html: NOTES_CSS }} />
    </section>
  );
}


// ───────────────────────────────────────────────────────────────────────────
// The notes, as a person reads them.
//
// Three tabs because there are three different reasons to open this. "What
// happened" is the summary. "Did they really say that" is the transcript.
// "What do I owe" is the action items — and that one is why anybody comes
// back a second time, so it carries its own count on the tab.
// ───────────────────────────────────────────────────────────────────────────

/** `**Paddle**` → bold, after escaping. Split rather than regex-replaced into
 *  HTML so nothing from a transcript is ever handed to dangerouslySetInnerHTML. */
/** mm:ss — the same clock the recording shows, so a citation is scrubbable. */
function fmtAt(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function Rich({ text }: { text: string }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="qm-nlist">
      {items.map((t, i) => (
        <li key={i}><Rich text={t} /></li>
      ))}
    </ul>
  );
}

function NotesPanel({
  data, tab, onTab, summaryPath, onSeek,
}: {
  data: any; tab: string; onTab: (t: string) => void;
  summaryPath: string; onSeek: (seconds: number) => void;
}) {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [ans, setAns] = useState<any>(null);

  // ── Ask the meeting a question ──────────────────────────────────────────
  // The rule that makes this trustworthy: it answers from the transcript
  // only, and it shows WHERE. An answer you can jump to is one you can check
  // in ten seconds; an answer without a moment attached is a claim about a
  // meeting you now have to re-listen to anyway.
  async function ask(question: string) {
    const text = (question || "").trim();
    if (!text || asking) return;
    setAsking(true);
    setAns(null);
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/notes/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ summaryPath, question: text }),
      });
      setAns(await r.json());
    } catch {
      setAns({ error: "Couldn't reach the answer service just now." });
    }
    setAsking(false);
  }

  if (!data) return <div className="qm-notes qm-nmuted">Opening the notes…</div>;

  const n = data.notes || {};
  const topics: Array<{ title: string; points: string[] }> = n.topics || data.topics || [];
  const actions: string[] = n.actions || data.actions || [];
  const decisions: string[] = n.decisions || data.decisions || [];
  const followups: string[] = n.followups || data.followups || [];
  const overview: string = n.overview || data.summaryText || "";
  const transcript: string = data.transcript || "";
  const steps: Array<{ ok: boolean; label: string; detail: string }> = data.steps || [];
  const failed = steps.filter((x) => !x.ok);
  // sessionMode travels on the summary JSON from recording/finish (#72).
  const mode = resolveSessionMode(data.sessionMode || n.sessionMode);

  // Nothing was produced. Say WHY — the finish route recorded the reason for
  // every step and it travels with the recording, so it is still here weeks
  // later when somebody finally asks.
  const empty = !overview && !topics.length && !actions.length && !transcript;

  const TABS: Array<[string, string]> = [
    ["summary", "Summary"],
    ["actions", recordingsActionsTab(mode, actions.length)],
    ["ask", "Ask"],
    ["transcript", "Transcript"],
  ];

  // Openers, so the box is not a blank stare. They are the questions people
  // actually have three weeks later, not a demo of what the model can do.
  const OPENERS = recordingsAskOpeners(mode);

  return (
    <div className="qm-notes">
      {data.title ? <h3 className="qm-ntitle">{data.title}</h3> : null}

      <div className="qm-ntabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`qm-ntab${tab === key ? " qm-non" : ""}`}
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {failed.length ? (
        <div className="qm-nwhy">
          <b>What didn&apos;t happen, and why</b>
          {failed.map((f, i) => (
            <p key={i}>
              <em>{f.label}</em> — {f.detail}
            </p>
          ))}
        </div>
      ) : null}

      {empty && !failed.length ? (
        <p className="qm-nmuted">No notes were produced for this one.</p>
      ) : null}

      {tab === "summary" ? (
        <>
          {overview ? <p className="qm-nover"><Rich text={overview} /></p> : null}
          {topics.length ? (
            <>
              <div className="qm-nhead">{recordingsSummaryTopicsHead(mode)}</div>
              {topics.map((t, i) => (
                <div className="qm-ntopic" key={i}>
                  <div className="qm-ntopich">
                    {i + 1}) <Rich text={t.title} />
                  </div>
                  <Bullets items={t.points || []} />
                </div>
              ))}
            </>
          ) : null}
          {decisions.length ? (
            <>
              <div className="qm-nhead">{recordingsSummaryDecisionsHead(mode)}</div>
              <Bullets items={decisions} />
            </>
          ) : null}
          {followups.length ? (
            <>
              <div className="qm-nhead">{recordingsSummaryFollowupsHead(mode)}</div>
              <Bullets items={followups} />
            </>
          ) : null}
        </>
      ) : null}

      {tab === "actions" ? (
        actions.length ? (
          <>
            <div className="qm-nhead">{recordingsActionsHead(mode)}</div>
            <Bullets items={actions} />
            <p className="qm-nfine">
              {recordingsActionsFoot(mode)}
            </p>
          </>
        ) : (
          <p className="qm-nmuted">{recordingsActionsEmpty(mode)}</p>
        )
      ) : null}

      {tab === "ask" ? (
        <>
          <div className="qm-nhead">{recordingsAskHead(mode)}</div>
          <p className="qm-nfine" style={{ margin: "0 0 12px" }}>
            Answered from the transcript only, with the moment it came from — so
            you can check it rather than take its word for it.
          </p>
          <div className="qm-askrow">
            <input
              className="qm-askin"
              placeholder="What did we decide about the billing provider?"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(q)}
            />
            <button className="qm-ntab qm-non" onClick={() => ask(q)} disabled={asking || !q.trim()}>
              {asking ? "Reading…" : "Ask"}
            </button>
          </div>
          <div className="qm-chips">
            {OPENERS.map((o) => (
              <button key={o} className="qm-chip" onClick={() => { setQ(o); ask(o); }}>
                {o}
              </button>
            ))}
          </div>

          {ans?.error ? <p className="qm-nwhy" style={{ marginTop: 14 }}>{ans.error}</p> : null}
          {ans && !ans.error ? (
            <div className="qm-answer">
              <p className={ans.grounded ? "" : "qm-nmuted"}>{ans.answer}</p>
              {(ans.cites || []).length ? (
                <>
                  <div className="qm-nfine" style={{ margin: "12px 0 6px" }}>Where it says so</div>
                  {ans.cites.map((c: any, i: number) => (
                    <button key={i} className="qm-cite" onClick={() => onSeek(c.at)}>
                      <span className="qm-citeat">{fmtAt(c.at)}</span>
                      <span className="qm-citewho">{c.who}</span>
                      <span className="qm-citeq">&ldquo;{c.quote}&rdquo;</span>
                    </button>
                  ))}
                </>
              ) : (
                <p className="qm-nfine" style={{ marginTop: 10 }}>
                  Nothing in the transcript settles that — so there is nothing to
                  point at, and this answer is not one to rely on.
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "transcript" ? (
        transcript ? (
          <pre className="qm-ntranscript">{transcript}</pre>
        ) : (
          <p className="qm-nmuted">There is no transcript for this recording.</p>
        )
      ) : null}
    </div>
  );
}

const NOTES_CSS = `
.qm-notes { background:#10131a; border:1px solid #262b36; border-radius:12px;
  padding:16px 18px; margin:0 0 14px; color:#cfd6e4; font-size:14px; }
.qm-ntitle { margin:0 0 12px; font-size:17px; color:#e9edf5; line-height:1.35; }
.qm-ntabs { display:flex; gap:6px; margin:0 0 16px; flex-wrap:wrap;
  border-bottom:1px solid #262b36; padding-bottom:10px; }
.qm-ntab { font:inherit; font-size:13px; cursor:pointer; background:transparent;
  color:#8b93a5; border:1px solid transparent; border-radius:8px; padding:6px 12px; }
.qm-ntab:hover { color:#cfd6e4; background:#171b24; }
.qm-non { background:#0d3d39; color:#7fe0d6; border-color:#00a99d; }
.qm-nover { margin:0 0 6px; font-size:15px; line-height:1.65; color:#dbe2ee; }
.qm-nhead { font-size:11.5px; letter-spacing:.08em; text-transform:uppercase;
  color:#00a99d; font-weight:700; margin:26px 0 10px; }
.qm-ntopic { margin:0 0 16px; }
.qm-ntopich { font-size:14.5px; font-weight:600; color:#e9edf5; margin:0 0 5px; }
.qm-nlist { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:5px; }
.qm-nlist li { line-height:1.55; color:#cfd6e4; }
.qm-nlist strong { color:#e9edf5; font-weight:600; }
.qm-nmuted { color:#8b93a5; margin:0; }
.qm-nfine { color:#6f7789; font-size:12.5px; margin:14px 0 0; line-height:1.55; }
.qm-nwhy { background:#1d1a12; border:1px solid #4a4021; border-radius:10px;
  padding:11px 13px; margin:0 0 16px; font-size:13px; color:#f0d9a6; }
.qm-nwhy b { display:block; margin:0 0 6px; }
.qm-nwhy p { margin:0 0 5px; line-height:1.5; }
.qm-nwhy em { font-style:normal; color:#ffe6b3; }
.qm-askrow { display:flex; gap:8px; margin:0 0 10px; }
.qm-askin { flex:1 1 auto; min-width:0; background:#0b0e14; color:#e9edf5;
  border:1px solid #2c3342; border-radius:9px; padding:9px 12px; font:inherit; font-size:14px; }
.qm-askin:focus { outline:0; border-color:#00a99d; }
.qm-askin::placeholder { color:#5a6272; }
.qm-chips { display:flex; gap:6px; flex-wrap:wrap; }
.qm-chip { font:inherit; font-size:12.5px; cursor:pointer; background:#151a23;
  color:#9aa3b4; border:1px solid #262b36; border-radius:999px; padding:5px 11px; }
.qm-chip:hover { color:#cfd6e4; border-color:#3b4356; }
.qm-answer { margin:18px 0 0; padding:14px 16px; background:#0b0e14;
  border:1px solid #21252f; border-radius:10px; }
.qm-answer > p { margin:0; font-size:15px; line-height:1.6; color:#dbe2ee; }
.qm-cite { display:flex; gap:10px; align-items:baseline; width:100%; text-align:left;
  font:inherit; cursor:pointer; background:transparent; border:0; border-top:1px solid #1b1f28;
  padding:8px 0; color:#b8c0cf; font-size:13px; }
.qm-cite:hover .qm-citeq { color:#e9edf5; }
.qm-citeat { color:#00a99d; font-variant-numeric:tabular-nums; flex:0 0 auto; }
.qm-citewho { color:#8b93a5; flex:0 0 auto; }
.qm-citeq { color:#9aa3b4; line-height:1.5; }
.qm-ntranscript { white-space:pre-wrap; word-break:break-word; margin:0;
  font:13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color:#b8c0cf;
  max-height:420px; overflow:auto; background:#0b0e14; border:1px solid #21252f;
  border-radius:10px; padding:14px; }
`;
