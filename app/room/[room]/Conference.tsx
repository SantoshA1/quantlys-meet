"use client";

// The whole meeting: names on every tile, chat, screen share, mic and camera
// controls, leave — from LiveKit's own conference component. On top: the
// invite link, a live participant count, and recording that records the
// MEETING rather than asking which window to capture.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
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

// A file people can OPEN. MP4/H.264 plays in QuickTime, Windows, iOS and
// Android without installing anything; WebM/VP9 plays in Chrome and looks
// broken everywhere else. Prefer MP4 and only fall back when the browser
// genuinely cannot make one.
const VIDEO_FORMATS: Array<[string, string]> = [
  ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm", "webm"],
];
// The audio-only copy: small enough to share and to transcribe. M4A/AAC is
// the universally-openable audio container browsers can actually produce —
// MediaRecorder has no MP3 encoder in any browser.
const AUDIO_FORMATS: Array<[string, string]> = [
  ["audio/mp4;codecs=mp4a.40.2", "m4a"],
  ["audio/mp4", "m4a"],
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
];

function pick(formats: Array<[string, string]>): [string, string] | null {
  for (const [mime, ext] of formats) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return [mime, ext];
    } catch {
      /* keep looking */
    }
  }
  return null;
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
      <LiveKitRoom token={token} serverUrl={url} connect video audio style={{ height: "100%" }}>
        <RoomHeader room={room} />
        <div className="qmr-conf">
          <VideoConference />
        </div>
      </LiveKitRoom>
    </div>
  );
}

// An <audio> element can only be handed to createMediaElementSource ONCE for
// the lifetime of the page. Recording twice in one meeting would throw and
// silently lose that person's voice, so the sources are kept and reused.
const AUDIO_SOURCES = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function RoomHeader({ room }: { room: string }) {
  const participants = useParticipants();
  const ctx = useRoomContext();
  const [copied, setCopied] = useState(false);
  const [signedIn, setSignedIn] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "busy"; text: string } | null>(null);

  const vRec = useRef<MediaRecorder | null>(null);
  const aRec = useRef<MediaRecorder | null>(null);
  const vChunks = useRef<BlobPart[]>([]);
  const aChunks = useRef<BlobPart[]>([]);
  const vExt = useRef("mp4");
  const aExt = useRef("m4a");
  const raf = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const ticker = useRef<any>(null);
  const stopping = useRef(0);

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => setSignedIn(data.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (status?.kind === "busy") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  const invite = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/room/${room}`),
    [room]
  );

  const names = participants.map((p) => p.name || p.identity.split("-")[0]).filter(Boolean);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus({ kind: "err", text: invite });
    }
  }

  function liveVideos(): HTMLVideoElement[] {
    return Array.from(document.querySelectorAll("video")).filter(
      (v) => v.videoWidth > 0 && v.videoHeight > 0 && !v.paused
    ) as HTMLVideoElement[];
  }

  function buildAudio(): MediaStream {
    const ac = audioCtx.current || new AudioContext();
    audioCtx.current = ac;
    if (ac.state === "suspended") ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();

    Array.from(document.querySelectorAll("audio")).forEach((el) => {
      const a = el as HTMLAudioElement;
      try {
        let src = AUDIO_SOURCES.get(a);
        if (!src) {
          src = ac.createMediaElementSource(a);
          AUDIO_SOURCES.set(a, src);
          src.connect(ac.destination); // keep it audible in the room
        }
        src.connect(dest);
      } catch {
        /* one voice missing must not stop the recording */
      }
    });

    try {
      const pub = ctx.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mst = pub?.track?.mediaStreamTrack;
      if (mst) ac.createMediaStreamSource(new MediaStream([mst])).connect(dest);
    } catch {
      /* recording without your own voice beats no recording */
    }
    return dest.stream;
  }

  function startRecording() {
    if (!signedIn || recording) return;
    setStatus(null);

    const vf = pick(VIDEO_FORMATS);
    const af = pick(AUDIO_FORMATS);
    if (!vf) {
      setStatus({ kind: "err", text: "This browser can't record video. Try Chrome." });
      return;
    }
    vExt.current = vf[1];

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext("2d");
    if (!g) {
      setStatus({ kind: "err", text: "This browser can't record. Try Chrome." });
      return;
    }

    const draw = () => {
      const vids = liveVideos();
      g.fillStyle = "#0b0d13";
      g.fillRect(0, 0, canvas.width, canvas.height);
      const n = Math.max(vids.length, 1);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cw = canvas.width / cols;
      const ch = canvas.height / rows;
      vids.forEach((v, i) => {
        const cx = (i % cols) * cw;
        const cy = Math.floor(i / cols) * ch;
        const scale = Math.min(cw / v.videoWidth, ch / v.videoHeight);
        const w = v.videoWidth * scale;
        const h = v.videoHeight * scale;
        try {
          g.drawImage(v, cx + (cw - w) / 2, cy + (ch - h) / 2, w, h);
        } catch {
          /* a frame that isn't ready is skipped, not fatal */
        }
      });
      raf.current = requestAnimationFrame(draw);
    };
    draw();

    const audio = buildAudio();
    const videoStream = new MediaStream([
      ...canvas.captureStream(24).getVideoTracks(),
      ...audio.getAudioTracks(),
    ]);

    let vr: MediaRecorder;
    try {
      vr = new MediaRecorder(videoStream, {
        mimeType: vf[0],
        videoBitsPerSecond: 2_500_000,
      });
    } catch (e: any) {
      setStatus({ kind: "err", text: `Could not start recording: ${e?.message || e}` });
      return;
    }

    vChunks.current = [];
    aChunks.current = [];
    stopping.current = af ? 2 : 1;

    vr.ondataavailable = (e) => e.data && e.data.size && vChunks.current.push(e.data);
    vr.onerror = (e: any) =>
      setStatus({ kind: "err", text: `Recording stopped: ${e?.error?.message || "unknown error"}` });
    vr.onstop = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      videoStream.getTracks().forEach((t) => t.stop());
      if (--stopping.current <= 0) void save();
    };
    vr.start(2000);
    vRec.current = vr;

    // The audio-only twin: what gets transcribed, and what fits in an email.
    if (af) {
      aExt.current = af[1];
      try {
        const ar = new MediaRecorder(new MediaStream(audio.getAudioTracks()), { mimeType: af[0] });
        ar.ondataavailable = (e) => e.data && e.data.size && aChunks.current.push(e.data);
        ar.onstop = () => {
          if (--stopping.current <= 0) void save();
        };
        ar.start(2000);
        aRec.current = ar;
      } catch {
        stopping.current = 1; // video alone is still a recording
        aRec.current = null;
      }
    }

    setRecording(true);
    setElapsed(0);
    ticker.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  const stopRecording = useCallback(() => {
    setRecording(false);
    if (ticker.current) clearInterval(ticker.current);
    try {
      aRec.current?.stop();
    } catch {
      /* the video is the one that matters */
    }
    try {
      vRec.current?.stop();
    } catch {
      setStatus({ kind: "err", text: "Recording could not be closed cleanly." });
    }
  }, []);

  async function save() {
    if (!signedIn) return;
    const video = new Blob(vChunks.current, { type: `video/${vExt.current}` });
    const audio = aChunks.current.length
      ? new Blob(aChunks.current, { type: `audio/${aExt.current}` })
      : null;
    vChunks.current = [];
    aChunks.current = [];
    if (video.size < 1024) {
      setStatus({ kind: "err", text: "Nothing was captured — the recording was empty." });
      return;
    }

    const mb = (video.size / 1048576).toFixed(1);
    setStatus({ kind: "busy", text: `Saving ${mb} MB…` });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${signedIn}/${room}/${stamp}`;
    const videoPath = `${base}.${vExt.current}`;

    const up = await db()
      .storage.from("recordings")
      .upload(videoPath, video, { contentType: video.type, upsert: false });
    if (up.error) {
      setStatus({ kind: "err", text: `Could not save the recording: ${up.error.message}` });
      return;
    }

    let audioPath: string | null = null;
    if (audio && audio.size > 1024) {
      audioPath = `${base}.${aExt.current === "m4a" ? "m4a" : "audio.webm"}`;
      const ua = await db()
        .storage.from("recordings")
        .upload(audioPath, audio, { contentType: audio.type, upsert: false });
      if (ua.error) audioPath = null; // the video is saved; the extra is optional
    }

    setStatus({ kind: "busy", text: `Saved ${mb} MB. Writing the summary…` });
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/recording/finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ room, videoPath, audioPath }),
      });
      const out = await r.json();
      if (!r.ok) {
        setStatus({
          kind: "ok",
          text: `Saved ${mb} MB — find it under Recordings. (${out.error || "No summary this time."})`,
        });
        return;
      }
      setStatus({
        kind: "ok",
        text: out.emailed
          ? `Saved and emailed to ${out.emailed} — the summary is on your host page too.`
          : `Saved ${mb} MB — summary written. Find it under Recordings.`,
      });
    } catch {
      setStatus({ kind: "ok", text: `Saved ${mb} MB — find it under Recordings on your host page.` });
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <header className="qmr-bar">
      <span className="qmr-logo">Quantlys Meeting</span>

      <span className="qmr-people" title={names.join(", ")}>
        {participants.length} in the meeting
        {names.length ? (
          <em className="qmr-names">
            {" · "}
            {names.slice(0, 4).join(", ")}
            {names.length > 4 ? ` +${names.length - 4}` : ""}
          </em>
        ) : null}
      </span>

      <span className="qmr-actions">
        {signedIn ? (
          recording ? (
            <button className="qmr-rec" onClick={stopRecording}>
              <span className="qmr-dot" /> Stop recording · {mmss}
            </button>
          ) : (
            <button
              className="qmr-ghost"
              onClick={startRecording}
              disabled={status?.kind === "busy"}
              title="Records the meeting — no window picker"
            >
              {status?.kind === "busy" ? "Saving…" : "Record"}
            </button>
          )
        ) : null}
        <button className="qmr-ghost" onClick={copyInvite} title={invite}>
          {copied ? "Copied" : "Copy invite link"}
        </button>
        <button
          className="qmr-leave"
          onClick={() => {
            if (status?.kind === "busy") return;
            ctx.disconnect();
            window.location.href = "/host";
          }}
          disabled={status?.kind === "busy"}
          title={status?.kind === "busy" ? "Wait for the recording to finish saving" : "Leave"}
        >
          Leave
        </button>
      </span>

      {status ? (
        <span className={`qmr-status qmr-${status.kind}`}>
          {status.text}
          <button className="qmr-x" onClick={() => setStatus(null)} aria-label="Dismiss">
            ×
          </button>
        </span>
      ) : null}
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
.qmr-prejoin button:disabled, .qmr-bar button:disabled { opacity: .55; cursor: default; }
.qmr-primary { background: #00a99d; color: #06110f; border: 0; font-weight: 600; }
.qmr-ghost { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qmr-ghost:hover { border-color: #3b4356; }
.qmr-leave { background: #3a1f26; color: #ffc9c9; border: 1px solid #5c2b35; }
.qmr-rec { background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38;
  display: inline-flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.qmr-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5964;
  animation: qmr-pulse 1.2s ease-in-out infinite; }
@keyframes qmr-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
.qmr-stage { height: 100vh; display: flex; flex-direction: column; background: #0b0d13;
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
.qmr-status { flex-basis: 100%; display: flex; align-items: center; gap: 10px;
  font-size: 13px; padding: 7px 11px; border-radius: 8px; border: 1px solid #262b36;
  background: #10131a; }
.qmr-ok  { color: #8fd8cf; border-color: #1f4f49; }
.qmr-err { color: #ffb4b4; border-color: #5c2b35; }
.qmr-busy{ color: #ffd9a0; border-color: #5a4520; }
.qmr-x { background: none; border: 0; color: inherit; font-size: 16px;
  line-height: 1; padding: 0 4px; margin-left: auto; }
`;
