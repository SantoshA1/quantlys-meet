"use client";

// A recording you cannot find is not a recording. This is where they live.

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

type Rec = { path: string; room: string; when: string; size: number };

function pretty(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export default function Recordings({ userId }: { userId: string }) {
  const [items, setItems] = useState<Rec[]>([]);
  const [note, setNote] = useState("Loading…");
  const [playing, setPlaying] = useState("");

  const load = useCallback(async () => {
    const rooms = await db().storage.from("recordings").list(userId, { limit: 100 });
    if (rooms.error) {
      setNote(`Could not read your recordings: ${rooms.error.message}`);
      return;
    }
    const out: Rec[] = [];
    for (const folder of rooms.data ?? []) {
      if (folder.id) continue; // a file at the top level, not a meeting folder
      const files = await db()
        .storage.from("recordings")
        .list(`${userId}/${folder.name}`, { limit: 100, sortBy: { column: "name", order: "desc" } });
      for (const f of files.data ?? []) {
        out.push({
          path: `${userId}/${folder.name}/${f.name}`,
          room: folder.name,
          when: (f.created_at || f.name.replace(/\.webm$/, "")).replace("T", " ").slice(0, 16),
          size: (f.metadata as any)?.size ?? 0,
        });
      }
    }
    out.sort((a, b) => (a.when < b.when ? 1 : -1));
    setItems(out);
    setNote(out.length ? "" : "No recordings yet — press Record during a meeting.");
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function play(path: string) {
    const { data, error } = await db().storage.from("recordings").createSignedUrl(path, 3600);
    if (error || !data) {
      setNote(`Could not open that recording: ${error?.message}`);
      return;
    }
    setPlaying(data.signedUrl);
  }

  async function download(path: string) {
    const { data, error } = await db().storage.from("recordings").createSignedUrl(path, 300, {
      download: true,
    });
    if (error || !data) {
      setNote(`Could not prepare the download: ${error?.message}`);
      return;
    }
    window.location.href = data.signedUrl;
  }

  async function remove(path: string) {
    const { error } = await db().storage.from("recordings").remove([path]);
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
      {playing ? (
        <video className="qm-player" src={playing} controls autoPlay playsInline />
      ) : null}
      {items.map((r) => (
        <div className="qm-item" key={r.path}>
          <span className="qm-name">
            {r.when} <span className="qm-ended"> · {r.room}{r.size ? ` · ${pretty(r.size)}` : ""}</span>
          </span>
          <span className="qm-row">
            <button className="qm-ghost" onClick={() => play(r.path)}>Play</button>
            <button className="qm-ghost" onClick={() => download(r.path)}>Download</button>
            <button className="qm-ghost" onClick={() => remove(r.path)}>Delete</button>
          </span>
        </div>
      ))}
    </section>
  );
}
