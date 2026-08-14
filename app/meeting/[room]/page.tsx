"use client";
import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Room from "./Room";

export default function MeetingPage() {
  const { room } = useParams<{ room: string }>();
  const params = useSearchParams();
  const title = params.get("title") ?? room;
  const isGuest = params.get("guest") === "1";

  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function join() {
    const res = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room, name, guest: isGuest }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Could not join"); return; }
    setToken(data.token);
  }

  if (token) return <Room token={token} title={title} />;

  return (
    <div className="wrap"><div className="card">
      <h1>{title}</h1>
      <p className="muted">{isGuest ? "Guest join — enter your name" : "Enter your name"}</p>
      <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      <button disabled={!name} onClick={join}>Join meeting</button>
      {err && <p style={{ color: "#e5484d" }}>{err}</p>}
    </div></div>
  );
}
