"use client";

// A recording you cannot find is not a recording. This is where they live —
// with the summary that was written after the meeting.

import { useCallback, useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  const [open, setOpen] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const rooms = await db().storage.from("recordings").list(userId, { limit: 100 });
    if (rooms.error) {
      setNote(`Could not read your recordings: ${rooms.error.message}`);
      return;
    }
    const out: Rec[] = [];
    for (const folder of rooms.data ?? []) {
      if (folder.id) continue; // a stray file at the top level, not a meeting folder
      const files = await db()
        .storage.from("recordings")
        .list(`${userId}/${folder.name}`, { limit: 200 });
      const byStem = new Map<string, Rec>();
      for (const f of files.data ?? []) {
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
    setItems(out);
    setNote(out.length ? "" : "No recordings yet — press Record during a meeting.");
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

  async function play(path: string) {
    const u = await signed(path, 3600);
    if (u) setPlaying(u);
  }

  async function get(path: string) {
    const u = await signed(path, 300, true);
    if (u) window.location.href = u;
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
      // FIELD 2026-08-17 — "No summary was produced for this one" is a fact
      // with no cause attached, which is the same as no answer. The finish
      // route now records WHY each step did or didn't happen, and it travels
      // with the recording, so the reason is still here weeks later.
      const steps: Array<{ ok: boolean; label: string; detail: string }> = j.steps || [];
      const failed = steps.filter((x) => !x.ok);
      const body = j.summary || j.transcript || "";
      const why = failed.length
        ? (body ? "\n\n" : "") +
          "What didn't happen, and why:\n" +
          failed.map((f) => `· ${f.label} — ${f.detail}`).join("\n")
        : "";
      setOpen((o) => ({
        ...o,
        [rec.path]: (body || (why ? "" : "No summary was produced for this one.")) + why,
      }));
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
      {playing ? <video className="qm-player" src={playing} controls autoPlay playsInline /> : null}
      {items.map((r) => (
        <div key={r.path}>
          <div className="qm-item">
            <span className="qm-name">
              {r.when}
              <span className="qm-ended">
                {" · "}
                {r.room}
                {r.size ? ` · ${pretty(r.size)}` : ""}
                {r.path.endsWith(".webm") ? " · WebM (opens in Chrome)" : ""}
              </span>
            </span>
            <span className="qm-row">
              <button className="qm-ghost" onClick={() => play(r.path)}>Play</button>
              <button className="qm-ghost" onClick={() => get(r.path)}>Download</button>
              {r.audioPath ? (
                <button className="qm-ghost" onClick={() => get(r.audioPath!)}>Audio only</button>
              ) : null}
              {r.summaryPath ? (
                <button className="qm-ghost" onClick={() => showSummary(r)}>
                  {open[r.path] ? "Hide summary" : "Summary"}
                </button>
              ) : null}
              <button className="qm-ghost" onClick={() => remove(r)}>Delete</button>
            </span>
          </div>
          {open[r.path] ? <p className="qm-summary">{open[r.path]}</p> : null}
        </div>
      ))}
      <style>{`
        .qm-summary { background:#10131a; border:1px solid #262b36; border-radius:10px;
          padding:14px 16px; margin:0 0 14px; color:#cfd6e4; font-size:14px;
          white-space:pre-wrap; }
      `}</style>
    </section>
  );
}
