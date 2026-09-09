"use client";

// MEETING HISTORY — every meeting, searchable by what was said.
//
// DESIGN 2026-08-18. One table: when, what, what it produced, when it gets
// deleted. The sizes and formats come from the storage listing (the same
// files the Recordings panel plays), the action counts from the rows the
// digest ticks off, and the delete date from the retention the deployment
// actually configured — no date is invented for a cron that was never set up.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Search from "../host/Search";
import { gb, hms, deletesOn, deletesLabel } from "@/lib/intelligence";
import { durationSecondsFromSummary } from "@/lib/recording-flush";

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

const VIDEO_EXT = /\.(mp4|webm)$/i;
const SUMMARY_EXT = /\.summary\.json$/i;

type Row = {
  room: string;
  title: string;
  project: string | null;
  when: string;         // sortable stem timestamp
  bytes: number;
  format: string;       // MP4 / WEBM
  hasNotes: boolean;
  actions: number;
  people: number | null;
  duration: number | null;
  createdISO: string | null;
};

async function listAll(prefix: string, cap: number) {
  const out: any[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const r = await db().storage.from("recordings").list(prefix, { limit: 100, offset });
    if (r.error) return out;
    const page = r.data ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export default function MeetingHistory() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("Reading your meetings…");
  const [projects, setProjects] = useState<string[]>([]);
  const [proj, setProj] = useState("");
  const [retDays, setRetDays] = useState(0);
  const [actionsTotal, setActionsTotal] = useState(0);

  useEffect(() => {
    db().auth.getSession().then(({ data }) => {
      setUser((data.session?.user as any) ?? null);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    fetch("/api/recording/retention")
      .then((r) => r.json())
      .then((j) => setRetDays(Number(j?.days) || 0))
      .catch(() => { /* no date shown, which is the honest default */ });
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    // Titles and projects come from the meetings table…
    const meta: Record<string, { title: string; project: string | null }> = {};
    const { data: ms } = await db()
      .from("meetings")
      .select("room_name, title, project")
      .eq("created_by", user.id)
      .limit(500);
    for (const m of ms || []) meta[m.room_name] = { title: m.title || "", project: (m as any).project ?? null };

    // …the action counts from the digest's own rows…
    const counts: Record<string, number> = {};
    const { data: its, count } = await db()
      .from("action_items")
      .select("room_name", { count: "exact" })
      .eq("user_id", user.id)
      .limit(1000);
    for (const it of its || []) counts[it.room_name] = (counts[it.room_name] || 0) + 1;
    setActionsTotal(count ?? (its?.length || 0));

    // …and the files themselves from storage, which is what actually exists.
    const folders = (await listAll(user.id, 2000)).filter((f: any) => !f.id);
    const out: Row[] = [];
    for (const folder of folders) {
      const files = await listAll(`${user.id}/${folder.name}`, 1000);
      const stems = new Map<string, Row>();
      for (const f of files) {
        const stem = f.name.replace(SUMMARY_EXT, "").replace(/\.(m4a|audio\.webm)$/i, "").replace(VIDEO_EXT, "");
        const r = stems.get(stem) || {
          room: folder.name,
          title: meta[folder.name]?.title || "",
          project: meta[folder.name]?.project ?? null,
          when: stem, bytes: 0, format: "", hasNotes: false,
          actions: counts[folder.name] || 0, people: null, duration: null as number | null,
          createdISO: null,
        };
        if (SUMMARY_EXT.test(f.name)) r.hasNotes = true;
        else if (VIDEO_EXT.test(f.name)) {
          r.format = f.name.toLowerCase().endsWith(".mp4") ? "MP4" : "WEBM";
          r.bytes += (f.metadata as any)?.size ?? 0;
          r.createdISO = (f as any).created_at || null;
        } else {
          r.bytes += (f.metadata as any)?.size ?? 0;
        }
        stems.set(stem, r);
      }
      stems.forEach((r) => r.format && out.push(r));
    }
    out.sort((a, b) => (a.when < b.when ? 1 : -1));
    setRows(out);
    setProjects(Array.from(new Set(out.map((r) => (r.project || "").trim()).filter(Boolean))).sort());
    setNote(out.length ? "" : "No recorded meetings yet — press Record during one and it lands here.");
    // Length lives on the summary written at finish (duration_s). The list
    // used to leave duration null forever, so every meeting looked untimed.
    const stamped = await Promise.all(out.map(async (r) => {
      if (!r.hasNotes) return r;
      const path = `${user.id}/${r.room}/${r.when}.summary.json`;
      const { data, error } = await db().storage.from("recordings").download(path);
      if (error || !data) return r;
      try {
        const secs = durationSecondsFromSummary(JSON.parse(await data.text()));
        return secs == null ? r : { ...r, duration: secs };
      } catch {
        return r;
      }
    }));
    setRows(stamped);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (proj ? rows.filter((r) => (r.project || "").trim() === proj) : rows),
    [rows, proj]
  );
  const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);

  return (
    <main className="qmh-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="qmh-top">
        <span className="qmh-crumb">04 / MEETING HISTORY</span>
        <span className="qmh-line" />
        <span className="qmh-crumb2">/meetings · SEARCHABLE BY WHAT WAS SAID</span>
      </header>

      {!ready ? (
        <p className="qmh-dim">Loading…</p>
      ) : !user ? (
        <section className="qmh-card">
          <h1>Meeting history</h1>
          <p className="qmh-dim">
            Sign in on your <a href="/host">host page</a> first — the history shows your own
            meetings, and only to you.
          </p>
        </section>
      ) : (
        <section className="qmh-card">
          <div className="qmh-head">
            <h1>
              Meeting history{" "}
              <em>
                {rows.length} MEETING{rows.length === 1 ? "" : "S"}
                {totalBytes ? <> · {gb(totalBytes)}</> : null}
                {actionsTotal ? <> · {actionsTotal} ACTIONS EXTRACTED</> : null}
              </em>
            </h1>
            {projects.length ? (
              <select className="qmh-select" value={proj} onChange={(e) => setProj(e.target.value)}
                      aria-label="Filter by project">
                <option value="">ALL PROJECTS</option>
                {projects.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            ) : null}
          </div>

          <Search />

          {note ? <p className="qmh-dim">{note}</p> : null}
          {shown.length ? (
            <table className="qmh-table">
              <thead>
                <tr><th>WHEN</th><th>MEETING</th><th>OUTPUT</th><th>RETENTION</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const d = new Date(r.when.replace("T", " ").slice(0, 16).replace(" ", "T") + ":00");
                  const del = r.createdISO ? deletesLabel(deletesOn(r.createdISO, retDays)) : "";
                  return (
                    <tr key={r.room + r.when}>
                      <td className="qmh-when">
                        {isNaN(d.getTime()) ? r.when.slice(0, 16) :
                          d.toLocaleDateString([], { day: "numeric", month: "short" }).toUpperCase() +
                          " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td>
                        <b className="qmh-title">{r.title || "Quantlys Meeting"}</b>
                        <span className="qmh-sub">
                          {[r.project, r.bytes ? gb(r.bytes) : "", r.duration ? hms(r.duration) : ""]
                            .filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="qmh-chips">
                        {r.hasNotes ? <i className="qmh-chip is-on">NOTES</i> : null}
                        <i className="qmh-chip">{r.format}</i>
                        {r.actions ? <i className="qmh-chip">{r.actions} ACTIONS</i> : null}
                      </td>
                      <td className="qmh-ret">{del || "—"}</td>
                      <td className="qmh-open">
                        <button className="qmh-btn" onClick={() => router.push(`/room/${r.room}`)}>OPEN</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          {retDays === 0 && rows.length ? (
            <p className="qmh-fine">
              No automatic deletion is configured — recordings stay until you delete them.
              Set RECORDING_RETENTION_DAYS and the dates appear here.
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

const CSS = `
.qmh-wrap { max-width: 1520px; margin: 0 auto; padding: 26px 24px 80px;
  font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif; color: var(--text, #e8eef5); }
.qmh-top { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.qmh-crumb { font: 11px/1 'IBM Plex Mono', monospace; letter-spacing: .22em; color: var(--accent2, #4DD7CF); }
.qmh-crumb2 { font: 10.5px/1 'IBM Plex Mono', monospace; letter-spacing: .12em; color: var(--dim, #4a566b); }
.qmh-line { flex: 1; height: 1px; background: var(--line, #16202c); }
.qmh-card { position: relative; border: 1px solid var(--line, #16202c); background:
  radial-gradient(900px 420px at 80% -20%, var(--glow, rgba(0,169,157,.16)), transparent 62%),
  var(--panel, #070b10); padding: 24px 28px; }
.qmh-card::before { content: ""; position: absolute; top: -1px; left: -1px; width: 14px; height: 14px;
  border-top: 2px solid var(--accent, #00A99D); border-left: 2px solid var(--accent, #00A99D); }
.qmh-head { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; margin-bottom: 8px; }
.qmh-head h1 { font-size: 26px; font-weight: 600; margin: 0; }
.qmh-head em { font: 10.5px/1 'IBM Plex Mono', monospace; font-style: normal; letter-spacing: .12em;
  color: var(--dim, #4a566b); margin-left: 10px; }
.qmh-select { margin-left: auto; background: var(--sunk, #070a0f); border: 1px solid var(--fieldline, #1e2937);
  color: var(--text2, #c3cddb); padding: 9px 12px; font: 11px 'IBM Plex Mono', monospace; letter-spacing: .1em; }
.qmh-dim { color: var(--muted, #7b8aa0); font-size: 14px; line-height: 1.55; }
.qmh-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.qmh-table th { text-align: left; font: 9.5px 'IBM Plex Mono', monospace; letter-spacing: .2em;
  color: var(--dim, #4a566b); padding: 10px 12px; border-bottom: 1px solid var(--line, #16202c); }
.qmh-table td { padding: 13px 12px; border-bottom: 1px solid var(--line2, #131c26); vertical-align: middle; }
.qmh-when { font: 11px 'IBM Plex Mono', monospace; color: var(--muted, #7b8aa0); white-space: nowrap; }
.qmh-title { display: block; font-weight: 600; font-size: 14.5px; }
.qmh-sub { font: 11px 'IBM Plex Mono', monospace; color: var(--dim, #4a566b); letter-spacing: .04em; }
.qmh-chips { white-space: nowrap; }
.qmh-chip { display: inline-block; font: 9.5px 'IBM Plex Mono', monospace; letter-spacing: .12em;
  font-style: normal; border: 1px solid var(--fieldline, #1e2937); color: var(--muted, #7b8aa0);
  padding: 4px 8px; margin-right: 6px; }
.qmh-chip.is-on { color: var(--accent2, #4DD7CF); border-color: var(--accent, #00A99D); }
.qmh-ret { font: 10px 'IBM Plex Mono', monospace; letter-spacing: .1em; color: var(--dim, #4a566b);
  white-space: nowrap; }
.qmh-open { text-align: right; }
.qmh-btn { background: var(--accent, #00A99D); color: var(--onAccent, #031310); border: 0;
  padding: 9px 18px; font: 600 11px 'IBM Plex Mono', monospace; letter-spacing: .14em; cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); }
.qmh-btn:hover { background: var(--accent2, #4DD7CF); }
.qmh-fine { font: 10.5px/1.6 'IBM Plex Mono', monospace; color: var(--dim, #4a566b); margin-top: 12px; }
a { color: var(--accent2, #4DD7CF); }
`;
