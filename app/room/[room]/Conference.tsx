"use client";

// The whole meeting: names on every tile, chat, screen share, mic and camera
// controls, leave — all of it from LiveKit's own conference component, so it
// behaves the way people already expect. On top of that: the invite link with
// a Copy button, a live participant count, and recording for the host.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
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

export default function Conference({ room }: { room: string }) {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/room/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, name: name.trim() || "Guest" }),
      });
      const data = await r.json();
      if (!r.ok || !data.token) {
        setError(data.error || "Could not join this meeting.");
        setBusy(false);
        return;
      }
      setToken(data.token);
      setUrl(data.url);
      setJoined(true);
    } catch {
      setError("Could not reach the meeting service. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (!joined) {
    return (
      <main className="qmr-prejoin">
        <style>{CSS}</style>
        <div className="qmr-card">
          <h1>Join meeting</h1>
          <p className="qmr-muted">No account needed — just a name so people know who joined.</p>
          <div className="qmr-row">
            <input
              className="qmr-input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              autoFocus
            />
            <button className="qmr-primary" onClick={join} disabled={busy}>
              {busy ? "Joining…" : "Join meeting"}
            </button>
          </div>
          {error ? <p className="qmr-error">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <div className="qmr-stage" data-lk-theme="default">
      <style>{CSS}</style>
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect
        video
        audio
        onDisconnected={() => {
          window.location.href = "/";
        }}
        style={{ height: "100%" }}
      >
        <RoomHeader room={room} />
        <div className="qmr-conf">
          <VideoConference />
        </div>
      </LiveKitRoom>
    </div>
  );
}

function RoomHeader({ room }: { room: string }) {
  const participants = useParticipants();
  const ctx = useRoomContext();
  const [copied, setCopied] = useState(false);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => setSignedIn(data.session?.user?.id ?? null));
  }, []);

  const invite = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/room/${room}`),
    [room]
  );

  const names = participants
    .map((p) => p.name || p.identity.split("-")[0])
    .filter(Boolean);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* nothing to do — the link is shown in the title attribute */
    }
  }

  const stopRecording = useCallback(() => {
    recorder.current?.stop();
  }, []);

  async function startRecording() {
    if (!signedIn || recording) return;
    setSaved("");
    let stream: MediaStream;
    try {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
    } catch {
      return; // the person cancelled the picker
    }
    chunks.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setSaving(true);
      const blob = new Blob(chunks.current, { type: "video/webm" });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${signedIn}/${room}/${stamp}.webm`;
      const { error } = await db().storage.from("recordings").upload(path, blob, {
        contentType: "video/webm",
        upsert: false,
      });
      setSaving(false);
      setSaved(error ? `Could not save: ${error.message}` : "Recording saved to your account.");
      setTimeout(() => setSaved(""), 6000);
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", stopRecording);
    rec.start(2000);
    recorder.current = rec;
    setRecording(true);
  }

  return (
    <header className="qmr-bar">
      <span className="qmr-logo">Quantlys Meeting</span>

      <span className="qmr-people" title={names.join(", ")}>
        {participants.length} in the meeting
        {names.length ? <em className="qmr-names"> · {names.slice(0, 4).join(", ")}
          {names.length > 4 ? ` +${names.length - 4}` : ""}</em> : null}
      </span>

      <span className="qmr-actions">
        {signedIn ? (
          recording ? (
            <button className="qmr-rec" onClick={stopRecording}>
              <span className="qmr-dot" /> Stop recording
            </button>
          ) : (
            <button className="qmr-ghost" onClick={startRecording} disabled={saving}>
              {saving ? "Saving…" : "Record"}
            </button>
          )
        ) : null}
        <button className="qmr-ghost" onClick={copyInvite} title={invite}>
          {copied ? "Copied" : "Copy invite link"}
        </button>
        <button className="qmr-leave" onClick={() => ctx.disconnect()}>
          Leave
        </button>
      </span>

      {saved ? <span className="qmr-toast">{saved}</span> : null}
    </header>
  );
}

const CSS = `
.qmr-prejoin { min-height: 100vh; display: grid; place-items: center; padding: 20px;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; }
.qmr-card { background: #171a22; border: 1px solid #262b36; border-radius: 14px;
  padding: 26px; width: min(520px, 100%); }
.qmr-card h1 { font-size: 21px; margin: 0 0 6px; }
.qmr-muted { color: #8b93a5; font-size: 14px; margin: 0 0 18px; }
.qmr-error { color: #ff9d9d; font-size: 14px; margin: 14px 0 0; }
.qmr-row { display: flex; gap: 10px; flex-wrap: wrap; }
.qmr-input { flex: 1 1 220px; min-width: 0; background: #10131a;
  border: 1px solid #2b3240; border-radius: 10px; padding: 11px 13px;
  color: #e9edf5; font: inherit; }
.qmr-input:focus { outline: none; border-color: #00a99d; }
.qmr-prejoin button, .qmr-bar button { font: inherit; cursor: pointer;
  border-radius: 10px; padding: 10px 16px; width: auto; white-space: nowrap; }
.qmr-primary { background: #00a99d; color: #06110f; border: 0; font-weight: 600; }
.qmr-ghost { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qmr-ghost:hover { border-color: #3b4356; }
.qmr-leave { background: #3a1f26; color: #ffc9c9; border: 1px solid #5c2b35; }
.qmr-rec { background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38;
  display: inline-flex; align-items: center; gap: 8px; }
.qmr-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5964;
  animation: qmr-pulse 1.2s ease-in-out infinite; }
@keyframes qmr-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
.qmr-stage { height: 100vh; display: flex; flex-direction: column;
  background: #0b0d13;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; }
.qmr-bar { position: relative; display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; background: #12151d; border-bottom: 1px solid #262b36;
  flex-wrap: wrap; }
.qmr-logo { font-weight: 600; }
.qmr-people { color: #8b93a5; font-size: 13px; }
.qmr-names { font-style: normal; color: #6f7789; }
.qmr-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.qmr-conf { flex: 1; min-height: 0; }
.qmr-toast { position: absolute; left: 16px; bottom: -30px; background: #12151d;
  border: 1px solid #262b36; border-radius: 8px; padding: 5px 10px;
  font-size: 13px; color: #8fd8cf; }
`;
