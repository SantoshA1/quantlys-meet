"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Meetings() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { (async () => {
    const { data } = await supabase.from("recordings")
      .select("id, room_name, status, duration_s, created_at, expires_at, meetings(title)")
      .order("created_at", { ascending: false });
    setRows(data ?? []);
  })(); }, []);
  return (
    <div className="wrap"><div className="card">
      <h1>Meeting history</h1>
      {rows.length === 0 && <p className="muted">No recordings yet.</p>}
      {rows.map(r => (
        <div className="list-item" key={r.id}>
          <div>
            <b>{r.meetings?.title ?? r.room_name}</b>
            <div className="muted">
              {new Date(r.created_at).toLocaleString()} · {r.status}
              {r.duration_s ? ` · ${Math.round(r.duration_s/60)}m` : ""}
              {" · auto-deletes " + new Date(r.expires_at).toLocaleDateString()}
            </div>
          </div>
          <button className="ghost" disabled={r.status !== "ready"}
            onClick={() => router.push(`/meetings/${r.id}`)}>
            {r.status === "ready" ? "Open" : r.status}
          </button>
        </div>
      ))}
    </div></div>
  );
}
