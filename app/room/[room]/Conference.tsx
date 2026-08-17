"use client";

// The whole meeting: names on every tile, chat, screen share, mic and camera
// controls, leave — from LiveKit's own conference component. On top: the
// invite link, a live participant count, and recording that records the
// MEETING rather than asking which window to capture.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  useDataChannel,
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

// The one thing about a recording that cannot be put right afterwards is not
// having told people. The person who presses Record chose to be recorded;
// everyone arriving from a link did not. So the notice goes BEFORE the door,
// in one sentence, with a box that has to be ticked — and it is remembered for
// this meeting so nobody is asked the same question twice.
const CONSENT_TEXT = "I understand this meeting may be recorded";

function consentKey(room: string) {
  return `qm-consent-${room}`;
}

function alreadyAgreed(room: string): boolean {
  try {
    return window.sessionStorage.getItem(consentKey(room)) === "1";
  } catch {
    return false;
  }
}

// What the recorder broadcasts to everyone else in the room, on LiveKit's own
// data channel. A heartbeat rather than a one-off event: someone who joins
// halfway through a recording has to learn about it too, and a single message
// sent before they arrived would never reach them.
const REC_TOPIC = "qm-recording";
const REC_BEAT_MS = 3000;
const REC_STALE_MS = 9000;   // three missed beats → assume it stopped

export default function Conference({ room }: { room: string }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAgreed(alreadyAgreed(room));
  }, [room]);

  async function join() {
    if (busy || !agreed) return;
    setBusy(true);
    setError("");
    try {
      window.sessionStorage.setItem(consentKey(room), "1");
    } catch {
      /* a private window just means we ask again next time */
    }
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
            <button className="qmr-primary" onClick={join} disabled={busy || !agreed}>
              {busy ? "Joining…" : "Join meeting"}
            </button>
          </div>

          <div className="qmr-consent">
            <p className="qmr-consent-lead">This meeting may be recorded.</p>
            <label className="qmr-check">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{CONSENT_TEXT}</span>
            </label>
            <p className="qmr-consent-fine">
              If anyone records, everyone in the meeting sees a red “Recording”
              badge for as long as it lasts. You can leave at any time.
            </p>
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

  // ── Who is recording, as seen by EVERYONE ───────────────────────────────
  // `recording` below is "am I the one recording". This is "is anyone", and
  // it is what the badge is driven from — so the badge appears for the guests
  // too, which is the entire point of it.
  const [recBy, setRecBy] = useState<string | null>(null);
  const recSeen = useRef(0);
  const { send: sendRec } = useDataChannel(REC_TOPIC, (msg) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.payload));
      if (payload?.on) {
        recSeen.current = Date.now();
        setRecBy(String(payload.by || "Someone"));
      } else {
        recSeen.current = 0;
        setRecBy(null);
      }
    } catch {
      /* a malformed beat is ignored, not fatal */
    }
  });

  // If the beats stop — the recorder closed the tab, lost the network, or
  // crashed — the badge must come down on its own. A badge that stays up
  // forever teaches people to ignore it.
  useEffect(() => {
    const t = setInterval(() => {
      if (recSeen.current && Date.now() - recSeen.current > REC_STALE_MS) {
        recSeen.current = 0;
        setRecBy(null);
      }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // ── Host controls ────────────────────────────────────────────────────────
  const [isHost, setIsHost] = useState(false);
  const [locked, setLocked] = useState(false);
  const [panel, setPanel] = useState(false);
  const [acting, setActing] = useState("");

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

  const control = useCallback(
    async (action: string, identity?: string) => {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/host/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ room, action, identity }),
      });
      return r.json().catch(() => ({}));
    },
    [room]
  );

  // Am I this meeting's host? Asked once, of the server — never decided in the
  // browser, where anyone could decide they were.
  useEffect(() => {
    let alive = true;
    control("status")
      .then((s) => {
        if (!alive) return;
        setIsHost(Boolean(s?.host));
        setLocked(Boolean(s?.locked));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [control, signedIn]);

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
    announce(true);
  }

  // Tell the room. Called on start, on every heartbeat, whenever somebody new
  // arrives, and once on stop.
  const announce = useCallback(
    (on: boolean) => {
      try {
        const who = ctx.localParticipant?.name || "The host";
        sendRec(
          new TextEncoder().encode(JSON.stringify({ on, by: who })),
          { reliable: true }
        );
        // The recorder is in the room too, and must see the same badge as
        // everyone else — nobody should have to trust that it is on.
        if (on) {
          recSeen.current = Date.now();
          setRecBy(who);
        } else {
          recSeen.current = 0;
          setRecBy(null);
        }
      } catch {
        /* the recording itself must never fail over an announcement */
      }
    },
    [ctx, sendRec]
  );

  // The heartbeat. Three seconds is short enough that a guest who joins
  // mid-recording sees the badge before they have finished saying hello.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => announce(true), REC_BEAT_MS);
    return () => clearInterval(t);
  }, [recording, announce]);

  // …and an immediate beat the moment anyone new connects, so they don't wait
  // even those three seconds.
  useEffect(() => {
    if (recording) announce(true);
  }, [participants.length, recording, announce]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    announce(false);
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
  }, [announce]);

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

  const hostables = participants.filter((p) => p.identity !== ctx.localParticipant?.identity);

  return (
    <header className="qmr-bar">
      <span className="qmr-logo">Quantlys Meeting</span>

      {/* Everyone in the room sees this, not just whoever pressed Record. It
          is the second half of the promise made on the join screen. */}
      {recBy ? (
        <span className="qmr-recbadge" role="status">
          <span className="qmr-dot" />
          Recording
          <em className="qmr-recwho"> · started by {recBy}</em>
        </span>
      ) : null}

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
        {isHost ? (
          <button
            className={`qmr-ghost${panel ? " qmr-on" : ""}`}
            onClick={() => setPanel((v) => !v)}
            title="Mute or remove someone, or lock the meeting"
          >
            Manage people
          </button>
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

      {isHost && panel ? (
        <div className="qmr-panel">
          <div className="qmr-panel-head">
            <strong>People in this meeting</strong>
            <button
              className={`qmr-lock${locked ? " qmr-on" : ""}`}
              disabled={acting === "lock"}
              onClick={async () => {
                setActing("lock");
                const out = await control(locked ? "unlock" : "lock");
                if (out?.error) setStatus({ kind: "err", text: out.error });
                else setLocked(Boolean(out.locked));
                setActing("");
              }}
              title={
                locked
                  ? "The link is closed — nobody new can join"
                  : "Close the link so nobody new can join"
              }
            >
              {locked ? "Locked — unlock" : "Lock the meeting"}
            </button>
          </div>

          {hostables.length === 0 ? (
            <p className="qmr-muted">Nobody else is here yet.</p>
          ) : (
            <ul className="qmr-plist">
              {hostables.map((p) => (
                <li key={p.identity}>
                  <span className="qmr-pname">{p.name || p.identity.split("-")[0]}</span>
                  <button
                    className="qmr-ghost"
                    disabled={acting === p.identity}
                    onClick={async () => {
                      setActing(p.identity);
                      const out = await control("mute", p.identity);
                      setStatus(
                        out?.error
                          ? { kind: "err", text: out.error }
                          : { kind: "ok", text: `Muted ${p.name || "them"} — they can unmute themselves.` }
                      );
                      setActing("");
                    }}
                  >
                    Mute
                  </button>
                  <button
                    className="qmr-leave"
                    disabled={acting === p.identity}
                    onClick={async () => {
                      setActing(p.identity);
                      const out = await control("remove", p.identity);
                      setStatus(
                        out?.error
                          ? { kind: "err", text: out.error }
                          : { kind: "ok", text: `Removed ${p.name || "them"} from the meeting.` }
                      );
                      setActing("");
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="qmr-fine">
            Muting stops them being heard now; it does not stop them unmuting
            again. Removing ends their connection — the same link would let
            them back in unless you also lock the meeting.
          </p>
        </div>
      ) : null}

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

/* Consent, on the way in. */
.qmr-consent { margin-top: 18px; padding-top: 16px; border-top: 1px solid #262b36; }
.qmr-consent-lead { margin: 0 0 10px; font-size: 14px; color: #e9edf5; }
.qmr-check { display: flex; align-items: flex-start; gap: 9px; font-size: 14px;
  color: #cfd6e4; cursor: pointer; line-height: 1.45; }
.qmr-check input { margin-top: 3px; width: 16px; height: 16px; flex: 0 0 auto;
  accent-color: #00a99d; cursor: pointer; }
.qmr-consent-fine { margin: 10px 0 0; font-size: 12.5px; color: #8b93a5; line-height: 1.5; }

/* The badge everyone sees while it is happening. */
.qmr-recbadge { display: inline-flex; align-items: center; gap: 7px;
  background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38;
  border-radius: 999px; padding: 4px 12px; font-size: 12.5px; font-weight: 600; }
.qmr-recwho { font-style: normal; font-weight: 400; color: #e2aeb2; }

/* Host controls. */
.qmr-on { border-color: #00a99d; color: #7fe0d6; }
.qmr-panel { flex-basis: 100%; background: #10131a; border: 1px solid #262b36;
  border-radius: 10px; padding: 12px 14px; }
.qmr-panel-head { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.qmr-lock { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qmr-plist { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 7px; }
.qmr-plist li { display: flex; align-items: center; gap: 8px; }
.qmr-pname { flex: 1 1 auto; min-width: 0; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qmr-plist button { padding: 5px 12px; font-size: 12.5px; }
.qmr-fine { margin: 12px 0 0; font-size: 12px; color: #8b93a5; line-height: 1.5; }
`;
