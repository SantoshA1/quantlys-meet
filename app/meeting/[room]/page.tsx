"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Room from "./Room";

export default function MeetingPage() {
  const { room } = useParams<{ room: string }>();
  const supabase = supabaseBrowser();

  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s;
      } catch { /* preview optional; join still works */ }
    })();
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  async function join() {
    setErr(""); setBusy(true);
    streamRef.current?.getTracks().forEach(t => t.stop()); // LiveKit re-acquires
    const res = await fetch("/api/livekit/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ room, name: name.trim() || "Guest" }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.status === 202 && data.pending) { setPending(data.admissionId); return; }
    if (!res.ok) { setErr(data.error || "Could not join"); return; }
    setIsHost(!!data.isHost); setToken(data.token);
  }

  // Waiting-room: listen for host decision (realtime), then claim token.
  useEffect(() => {
    if (!pending) return;
    const ch = supabase.channel(`adm-${pending}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "pending_admissions", filter: `id=eq.${pending}` },
        async (p) => {
          const st = (p.new as any).status;
          if (st === "admitted") {
            const r = await fetch("/api/host/admit/claim", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ admissionId: pending }),
            });
            const d = await r.json();
            if (r.ok) { setToken(d.token); setPending(null); }
          } else if (st === "denied") { setErr("The host declined your request."); setPending(null); }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [pending]);

  if (token) return <Room token={token} isHost={isHost} roomName={room} />;

  if (pending) return (
    <div className="wrap"><div className="card">
      <h1>Ready to join</h1>
      <p className="muted">Waiting for the host to let you in…</p>
    </div></div>
  );

  return (
    <div className="wrap"><div className="card">
      <h1>Join meeting</h1>
      <video ref={videoRef} autoPlay playsInline muted
        style={{ width: "100%", borderRadius: 10, background: "#000", aspectRatio: "16/9" }} />
      <input placeholder="Your name (optional)" value={name}
        onChange={e => setName(e.target.value)} />
      <button disabled={busy} onClick={join} style={{ width: "100%", fontSize: 17, padding: 14 }}>
        {busy ? "Joining…" : "Join meeting"}
      </button>
      {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
    </div></div>
  );
}
