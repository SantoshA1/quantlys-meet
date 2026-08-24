"use client";

// The whole meeting: names on every tile, chat, screen share, mic and camera
// controls, leave — from LiveKit's own conference component. On top: the
// invite link, a live participant count, and recording that records the
// MEETING rather than asking which window to capture.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LiveKitRoom,
  VideoConference,
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, AudioPresets, VideoPresets, RoomEvent } from "livekit-client";
import DeviceCheck, { DEVICE_CSS, type Choice } from "./DeviceCheck";
import MediaGuard, { GUARD_CSS } from "./MediaGuard";
import { connectionAdvice } from "@/lib/media";
import { joinErrorText, deviceFailText } from "@/lib/camera";
import { waitingMessage, pollDelay } from "@/lib/waiting";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Caption, Engine } from "@/lib/captions";
import { catchLive, caughtCounts, talked, atLabel, flagAt } from "@/lib/live";
import { BAR, dockAnchor } from "@/lib/dock";
import { surfaceFor, penLabel } from "@/lib/draw";
import Board, { BOARD_CSS } from "./Board";
import {
  CC_TOPIC, mergeCaption, pruneStale, visible, finals, stamp,
  toTranscript, toUtterances, engineNote, pickEngine, toggleLabel,
} from "@/lib/captions";

// SELF-HOST 2026-08-19: db() used to assert the Supabase env with `!` and
// throw from inside a mount effect when it was absent — which crashed the
// whole room UI on a self-hosted deployment that never configured accounts.
// A meeting app must MEET without its optional cloud. Null here means the
// signed-in extras (host console, saved recordings) quietly don't exist.
let _db: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_db) _db = createClient(url, key);
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
  const [choice, setChoice] = useState<Choice>({ micId: "", camId: "", spkId: "", camOn: true, micOn: true });
  const [mediaFail, setMediaFail] = useState("");
  // The waiting room, from the outside.
  const [knock, setKnock] = useState<{ id: string; since: number } | null>(null);
  const [wait, setWait] = useState<{ state: string; hostPresent?: boolean; position?: number }>({ state: "connecting" });

  const [starts, setStarts] = useState<string | null>(null);
  // Who is already inside, who invited you, whether others are waiting —
  // everything the link already grants, fetched fresh so the lobby cannot
  // disagree with the room.
  const [info, setInfo] = useState<{ host: string | null; in: string[]; waiting: number } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/room/info?room=${encodeURIComponent(room)}`);
        const j = await r.json();
        if (alive && j && !j.error) setInfo({ host: j.host || null, in: j.in || [], waiting: j.waiting || 0 });
      } catch { /* the lobby renders what it has */ }
    })();
    return () => { alive = false; };
  }, [room]);
  const [meetingName, setMeetingName] = useState("");

  useEffect(() => {
    setAgreed(alreadyAgreed(room));
  }, [room]);

  // Someone who opens a scheduled link early meets an empty room and concludes
  // the app is broken. Tell them when to come back — and never stop them
  // joining anyway, because "early" is often "the host is already here".
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await db()?.rpc("meeting_by_code", { code: room });
        const data = res?.data;
        if (!alive || !data) return;
        const m = Array.isArray(data) ? data[0] : data;
        if (!m) return;
        setMeetingName(String(m.title || ""));
        if (m.scheduled_at) setStarts(String(m.scheduled_at));
      } catch {
        /* a room whose name isn't in the table still joins — the code is what matters */
      }
    })();
    return () => {
      alive = false;
    };
  }, [room]);

  async function join(c?: Choice) {
    if (busy || !agreed) return;
    if (c) setChoice(c);
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

      // 202: the host runs a waiting room. Nobody has been refused — a person
      // is going to decide. That distinction is the whole feature.
      if (r.status === 202 && data?.waiting) {
        const who = name.trim() || "Guest";
        const kr = await fetch("/api/room/knock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, name: who }),
        });
        const kd = await kr.json();
        if (!kr.ok || !kd?.knockId) {
          setError(kd?.error || "Could not let the host know you're here.");
          setBusy(false);
          return;
        }
        setKnock({ id: kd.knockId, since: Date.now() });
        setWait({ state: "pending", hostPresent: kd.hostPresent, position: kd.position });
        setBusy(false);
        return;
      }

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

  // Poll while waiting. Quick at first — the host is watching them not appear —
  // then settling down, so a ten-minute wait does not hammer anything.
  useEffect(() => {
    if (!knock || joined) return;
    let alive = true;
    let timer: any;
    const beat = async () => {
      if (!alive) return;
      try {
        const r = await fetch("/api/room/knock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, knockId: knock.id }),
        });
        const d = await r.json();
        if (!alive) return;
        if (d?.state === "admitted" && d.token) {
          setToken(d.token);
          setUrl(d.url);
          setJoined(true);
          return;
        }
        if (d?.state === "expired") {
          // Knock again rather than leaving somebody polling a ghost.
          setKnock(null);
          setWait({ state: "connecting" });
          return;
        }
        setWait({ state: d?.state || "pending", hostPresent: d?.hostPresent, position: d?.position });
      } catch {
        if (alive) setWait((w) => ({ ...w, state: w.state === "pending" ? "pending" : "error" }));
      }
      if (alive) timer = setTimeout(beat, pollDelay(Date.now() - knock.since));
    };
    beat();
    return () => { alive = false; clearTimeout(timer); };
  }, [knock, joined, room]);

  // ── the view from outside the door ──────────────────────────────────────
  if (knock && !joined) {
    const denied = wait.state === "denied";
    return (
      <main className="qmr-prejoin">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="qmr-card">
          <h1>{meetingName || "Waiting to be let in"}</h1>
          <div className={`qmr-knock${denied ? " qmr-knockno" : ""}`}>
            {!denied ? <span className="qmr-knockdot" aria-hidden /> : null}
            <p>
              {waitingMessage(wait.state as any, {
                hostPresent: wait.hostPresent,
                position: wait.position,
                waitedMs: Date.now() - knock.since,
              })}
            </p>
          </div>
          <p className="qmr-muted">
            You're knocking as <b>{name.trim() || "Guest"}</b>. Keep this tab open —
            it will take you in by itself.
          </p>
          {denied ? (
            <button className="qmr-primary" onClick={() => { setKnock(null); setWait({ state: "connecting" }); }}>
              Try again
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  if (!joined) {
    return (
      <main className="qmr-prejoin">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="qmr-card">
          {/* The design's lobby is two columns: what you look like on the
              left, what you are about to join on the right. They are the two
              questions a person actually has standing outside a meeting, and
              stacking them buries the second one under a webcam. */}
          <div className="qmr-lobby">
          <div className="qmr-lobbyside">
          <p className="qmr-eyebrow">{starts ? "You've been invited to" : "No account · one click"}</p>
          <h1>{meetingName || "Join meeting"}</h1>
          <div className="qmr-meta">
            {starts && new Date(starts).getTime() - Date.now() > 90_000 ? (
              <>
                <b>
                  STARTS{" "}
                  {new Date(starts).toLocaleString([], {
                    weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                  }).toUpperCase()}
                </b>
                <span className="qmr-sep">│</span>
              </>
            ) : null}
            <span>{room.toUpperCase()}</span>
            {info && info.waiting > 0 ? (
              <>
                <span className="qmr-sep">│</span>
                <span>{info.waiting} ALREADY WAITING</span>
              </>
            ) : null}
          </div>
          {info && (info.in.length || info.host) ? (
            <div className="qmr-lobbyfacts">
              {info.in.length ? (
                <span><i>ALREADY IN</i><b>{info.in.join(", ")}</b></span>
              ) : null}
              {info.host ? (
                <span><i>HOST</i><b>{info.host}</b></span>
              ) : null}
              <span><i>THIS LINK</i><b>Works until the host ends it</b></span>
            </div>
          ) : null}
          {starts && new Date(starts).getTime() - Date.now() > 90_000 ? (
            <p className="qmr-when">
              You&apos;re early — you can wait here, or come back then. This link keeps working.
            </p>
          ) : null}
          <p className="qmr-muted">No account needed — just a name so people know who joined.</p>
          <div className="qmr-row">
            <input
              className="qmr-input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && agreed && join(choice)}
              autoFocus
            />
          </div>
          </div>

          {/* FIELD 2026-08-18: there used to be nothing between typing your
              name and being live in front of people, so the first thing that
              ever tested your microphone was the meeting itself. He found out
              he was inaudible from his team, mid-call. */}
          <DeviceCheck
            name={name.trim()}
            busy={busy}
            blocked={!agreed}
            blockedLabel="Tick the recording box below to join"
            onJoin={(c) => { setChoice(c); join(c); }}
          />

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
        </div>
      </main>
    );
  }

  return (
    <div className="qmr-stage" data-lk-theme="default">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* FIELD 2026-08-18. This used to read `connect video audio` — LiveKit's
          hello-world — which grabs whatever the browser calls "default" at the
          instant you join, publishes it, and never looks at it again. No
          device memory, no error handler, and nothing watching whether the
          track it is publishing is still alive. That last one is what let a
          Bluetooth headset go dead mid-sentence while everybody in the room
          still saw him un-muted.
          The error handlers below use joinErrorText/deviceFailText, which
          only name a device when the error IS a device error — the old
          handlers described websocket failures and camera failures alike as
          microphone problems, which sent a Windows user whose camera was
          held by Teams off to debug his mic. */}
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect
        video={choice.camOn ? { deviceId: choice.camId || undefined } : false}
        audio={
          choice.micOn
            ? {
                deviceId: choice.micId || undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,   // the fix for "you're very quiet"
              }
            : false
        }
        options={{
          // Voice quality. The default preset is 32kbps; 64kbps mono Opus is
          // transparent for speech and costs nothing next to 1.7Mbps of video.
          // RED sends each packet twice over, which is what keeps a voice
          // intelligible on a lossy hotel connection rather than robotic.
          publishDefaults: {
            audioPreset: AudioPresets.musicHighQuality,
            dtx: true,
            red: true,
            simulcast: true,
            // VP8 on purpose: every browser and every phone can decode it.
            // VP9 and AV1 look better and are exactly how one person in a
            // meeting ends up as a black rectangle to everyone else.
            videoCodec: "vp8",
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
            stopMicTrackOnMute: false,
          },
          audioCaptureDefaults: {
            deviceId: choice.micId || undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          videoCaptureDefaults: {
            deviceId: choice.camId || undefined,
            resolution: VideoPresets.h720.resolution,
          },
        }}
        onError={(e) => setMediaFail(joinErrorText((e as any)?.name, (e as any)?.message))}
        onMediaDeviceFailure={(f) => setMediaFail(deviceFailText(f ? String(f) : ""))}
        className="qmr-lk"
      >
        <RoomHeader room={room} title={meetingName} camWanted={choice.camOn} micWanted={choice.micOn} />
        <PlaybackGate />
        {mediaFail ? <div className="qmr-mediafail">{mediaFail}</div> : null}
        <div className="qmr-conf">
          <VideoConference />
          <Drawing />
        </div>
        <Reactions />
      </LiveKitRoom>
    </div>
  );
}

/** The other half of "nobody could hear me".
 *
 *  FIELD 2026-08-24. Everything else in this app watches what LEAVES the
 *  machine. This watches whether anything is ARRIVING, because a browser is
 *  allowed to refuse to play it.
 *
 *  Chrome and Edge block autoplay on a site the person has not built up a
 *  media-engagement score with — a brand-new meeting domain is exactly that,
 *  and a Windows work profile that has never been to quantlys-meeting.com
 *  before is the textbook case. LiveKit knows: it sets `room.canPlaybackAudio`
 *  to false and fires the event below. `<VideoConference/>` renders
 *  RoomAudioRenderer but NOT `<StartAudio/>` (checked against
 *  @livekit/components-react 2.6.2), so there was nothing on the page that
 *  could unblock it. The person heard silence, assumed the speaker they
 *  chose was wrong, and left and rejoined — and rejoining sometimes works,
 *  because by then the click on "Join" counts as the gesture.
 *
 *  It is one click, and it must be impossible to miss. */
function PlaybackGate() {
  const room = useRoomContext();
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!room) return;
    const read = () => setBlocked(room.canPlaybackAudio === false || room.canPlaybackVideo === false);
    read();
    room.on(RoomEvent.AudioPlaybackStatusChanged, read);
    room.on(RoomEvent.VideoPlaybackStatusChanged, read);
    // Some blocks only become visible once somebody else publishes, so ask
    // again when the room changes shape rather than only at mount.
    room.on(RoomEvent.TrackSubscribed, read);
    room.on(RoomEvent.ParticipantConnected, read);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, read);
      room.off(RoomEvent.VideoPlaybackStatusChanged, read);
      room.off(RoomEvent.TrackSubscribed, read);
      room.off(RoomEvent.ParticipantConnected, read);
    };
  }, [room]);

  if (!blocked) return null;
  return (
    <button
      className="qmr-playgate"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // Both, always. A browser that blocked one has usually blocked the
        // other, and a person who clicks once should not have to find out
        // there was a second permission underneath.
        try { await room.startAudio(); } catch { /* the button stays until it works */ }
        try { await room.startVideo(); } catch { /* same */ }
        setBusy(false);
      }}
    >
      <b>Click to hear and see the meeting</b>
      <span>
        Your browser blocked the meeting&apos;s sound and picture until you click once.
        Nobody is missing — this is Chrome and Edge asking permission, and one click fixes it for good.
      </span>
    </button>
  );
}

// An <audio> element can only be handed to createMediaElementSource ONCE for
// the lifetime of the page. Recording twice in one meeting would throw and
// silently lose that person's voice, so the sources are kept and reused.
const AUDIO_SOURCES = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function RoomHeader({ room, title, camWanted, micWanted }: {
  room: string; title?: string; camWanted?: boolean; micWanted?: boolean;
}) {
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
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [waiting, setWaiting] = useState<Array<{ id: string; display_name: string }>>([]);
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
      ?.auth.getSession()
      .then(({ data }) => setSignedIn(data.session?.user?.id ?? null));
  }, []);

  // The host is not going to remember to check. A person standing outside is
  // only a feature if somebody inside finds out about them without looking.
  useEffect(() => {
    if (!isHost || !waitingRoom) { setWaiting([]); return; }
    let alive = true;
    let timer: any;
    const beat = async () => {
      if (!alive) return;
      try {
        const sess = (await db()?.auth.getSession())?.data;
        const r = await fetch("/api/host/control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess?.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ room, action: "waiting" }),
        });
        const d = await r.json();
        if (alive && Array.isArray(d?.waiting)) setWaiting(d.waiting);
      } catch { /* the meeting carries on */ }
      if (alive) timer = setTimeout(beat, 4000);
    };
    beat();
    return () => { alive = false; clearTimeout(timer); };
  }, [isHost, waitingRoom, room]);

  const control = useCallback(
    async (action: string, identity?: string, knockId?: string) => {
      const sess = (await db()?.auth.getSession())?.data;
      const r = await fetch("/api/host/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess?.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ room, action, identity, knockId }),
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
        setWaitingRoom(Boolean(s?.waitingRoom));
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

  // Captions. Held here rather than in a child so the caption LOG is in scope
  // when the recording finishes — a meeting captioned live but never
  // transcribed still has all its words, and throwing them away because one
  // API key is missing is the app choosing to know less than it does.
  const meId = ctx?.localParticipant?.identity || "me";
  const meName = ctx?.localParticipant?.name || meId.split("-")[0] || "You";
  const cc = useCaptions(room, meId, meName);

  // The meeting writing itself down — the rail on the right. Open by default
  // where there is room for it; a laptop keeps the video and gets a button.
  const [railOpen, setRailOpen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1180px)").matches : false);
  // Moments the host marks by hand. They ride into the recording's captions
  // payload, so the transcript and the search can find them afterwards —
  // a flag that lives only on this screen dies with the tab.
  const [flags, setFlags] = useState<Array<{ at: number; by: string }>>([]);
  // Ending the whole meeting asks once, in place — never a browser confirm.
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  // Where the header actually ends. The rail pins below it — measured, not
  // assumed, because the theme strip above and flex wrapping below both move
  // it, and a guessed offset already shipped a rail tangled into the header.
  const barRef = useRef<HTMLElement | null>(null);
  const [headroom, setHeadroom] = useState(110);
  useEffect(() => {
    const read = () => {
      const r = barRef.current?.getBoundingClientRect();
      if (r) setHeadroom(Math.round(r.bottom + 6));
    };
    read();
    window.addEventListener("resize", read);
    const t = setInterval(read, 2000);   // the header wraps when chips appear
    return () => { window.removeEventListener("resize", read); clearInterval(t); };
  }, []);
  // When captions switched on — so a flag pressed before anyone has spoken
  // still gets a clock. FIELD 2026-08-18: that case used to return -1 and the
  // button silently did nothing.
  const ccStartRef = useRef<number>(0);
  useEffect(() => {
    if (cc.on && !ccStartRef.current) ccStartRef.current = Date.now();
    if (!cc.on) ccStartRef.current = 0;
  }, [cc.on]);
  const flagNow = () => {
    const last = finals(cc.log).slice(-1)[0];
    const at = flagAt({
      ccOn: cc.on,
      lastFinalAt: last ? last.at : null,
      ccElapsedMs: ccStartRef.current ? Date.now() - ccStartRef.current : null,
      recording,
      recElapsedSec: elapsed,
    });
    if (at < 0) return;   // nothing durable to anchor to — button is disabled in that state
    setFlags((f) => [...f, { at, by: meName }]);
  };

  // Round-trip time straight off the WebRTC stats, and the quality LiveKit
  // already computes. Reported together because they answer different halves
  // of "is it me or is it them": the word is the verdict, the number is the
  // evidence.
  const [link, setLink] = useState<{ word: string; ms: number; bars: number; detail: string }>(
    { word: "CHECKING", ms: 0, bars: 2, detail: "Measuring your connection…" }
  );
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      if (!alive) return;
      const q = String(ctx?.localParticipant?.connectionQuality || "unknown").toLowerCase();
      const word = q === "excellent" ? "EXCELLENT" : q === "good" ? "GOOD"
        : q === "poor" ? "POOR" : q === "lost" ? "LOST" : "CHECKING";
      const bars = q === "excellent" ? 4 : q === "good" ? 3 : q === "poor" ? 1 : 2;
      let ms = 0;
      try {
        const pc: any = (ctx as any)?.engine?.pcManager?.publisher?.pc
          || (ctx as any)?.engine?.publisher?.pc;
        const stats: any = pc ? await pc.getStats() : null;
        stats?.forEach?.((r: any) => {
          if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime != null) {
            ms = Math.round(r.currentRoundTripTime * 1000);
          }
        });
      } catch { /* the word alone is still worth showing */ }
      if (alive) {
        setLink({
          word, ms, bars,
          detail: connectionAdvice(q) ||
            (ms ? `Round trip to the meeting server is ${ms}ms.` : "Connection looks healthy."),
        });
      }
      if (alive) setTimeout(beat, 5000);
    };
    beat();
    return () => { alive = false; };
  }, [ctx]);
  const [ccOpen, setCcOpen] = useState(false);

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
    const client = db();
    if (!signedIn || !client) return;
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

    const up = await client
      .storage.from("recordings")
      .upload(videoPath, video, { contentType: video.type, upsert: false });
    if (up.error) {
      setStatus({ kind: "err", text: `Could not save the recording: ${up.error.message}` });
      return;
    }

    let audioPath: string | null = null;
    if (audio && audio.size > 1024) {
      audioPath = `${base}.${aExt.current === "m4a" ? "m4a" : "audio.webm"}`;
      const ua = await client
        .storage.from("recordings")
        .upload(audioPath, audio, { contentType: audio.type, upsert: false });
      if (ua.error) audioPath = null; // the video is saved; the extra is optional
    }

    setStatus({ kind: "busy", text: `Saved ${mb} MB. Writing the summary…` });
    try {
      const { data: sess } = await client.auth.getSession();
      const r = await fetch("/api/recording/finish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        // Who was actually in the room. The app has always known this —
        // everybody types a name on the way in — and it was thrown away before
        // the notes were written, which is why every set of them said
        // "Speaker 2". A commitment made by a number is one nobody can chase.
        body: JSON.stringify({
          room, videoPath, audioPath, people: names, title,
          // Everything that was captioned, as timed lines. If Deepgram can't
          // transcribe the file afterwards — no key, silence, a rejected
          // upload — these ARE the transcript, and the notes are written from
          // them instead of the app reporting that it heard nothing.
          captions: [
            ...toUtterances(cc.log),
            // Flagged moments become lines of the record itself.
            ...flags.map((f) => ({ start: Math.round(f.at / 1000), speaker: -1,
                                   transcript: `⚑ Moment flagged by ${f.by}` })),
          ].slice(0, 4000),
          captionText: toTranscript(cc.log).slice(0, 200000),
        }),
      });
      const out = await r.json();
      if (!r.ok) {
        setStatus({
          kind: "ok",
          text: `Saved ${mb} MB — find it under Recordings. (${out.error || "No summary this time."})`,
        });
        return;
      }
      // FIELD 2026-08-17 — this used to say "summary written" whether or not
      // one was, and never mentioned the email at all when it failed. If a
      // step didn't happen, the person who pressed Record is the one who needs
      // to know, at the moment they can still do something about it.
      const failed: Array<{ label: string; detail: string }> = (out.steps || []).filter(
        (x: any) => x && !x.ok
      );
      setStatus({
        kind: failed.length ? "err" : "ok",
        text: out.emailed
          ? `Saved and emailed to ${out.emailed} — the summary is on your host page too.`
          : failed.length
          ? `Saved ${mb} MB. ${failed[0].detail}${failed.length > 1 ? ` (+${failed.length - 1} more — see “Check my setup” on your host page.)` : ""}`
          : `Saved ${mb} MB — summary written. Find it under Recordings.`,
      });
    } catch {
      setStatus({ kind: "ok", text: `Saved ${mb} MB — find it under Recordings on your host page.` });
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  const hostables = participants.filter((p) => p.identity !== ctx.localParticipant?.identity);

  return (
    <header className="qmr-bar" ref={barRef}>
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
        <b>{participants.length} IN THE MEETING</b>
        {names.length ? (
          <em className="qmr-names">
            {" │ "}
            {names.slice(0, 4).join(", ").toUpperCase()}
            {names.length > 4 ? ` +${names.length - 4}` : ""}
          </em>
        ) : null}
      </span>

      <span className="qmr-actions">
        {/* The design puts the link quality in the header, in milliseconds.
            It earns its place: "your connection is bad" is the single most
            argued-about claim in any meeting, and a number nobody can argue
            with ends the argument. */}
        <span className="q-chip" title={link.detail}>
          <span className="q-bars" style={{ opacity: link.bars / 4 }}>
            <i style={{ animation: "none", height: "40%" }} />
            <i style={{ animation: "none", height: link.bars >= 2 ? "65%" : "18%" }} />
            <i style={{ animation: "none", height: link.bars >= 3 ? "100%" : "18%" }} />
          </span>
          LINK {link.word}
          {link.ms ? ` · ${link.ms} MS` : ""}
        </span>
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
        <button
          className={`qmr-ghost${cc.on ? " qmr-on" : ""}`}
          onClick={cc.toggle}
          aria-pressed={cc.on}
          title={cc.note || "Show what is being said, as it is said"}
        >
          {toggleLabel(cc.engine === "none" && !cc.on ? "browser" : cc.engine, cc.on)}
        </button>
        <button
          className={`qmr-ghost${railOpen ? " qmr-on" : ""}`}
          onClick={() => setRailOpen((v) => !v)}
          aria-pressed={railOpen}
          title="What was just said, and what got caught as a decision or an action"
        >
          Live notes
        </button>
        {/* The watchdog lives in the header because that is where somebody
            looks when they suspect they cannot be heard. */}
        <MediaGuard camWanted={camWanted} micWanted={micWanted} />
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

          <div className="qmr-panel-head qmr-wr">
            <span className="qmr-fine" style={{ margin: 0 }}>
              {waitingRoom
                ? "New people knock and wait for you to let them in."
                : "Anyone with the link walks straight in."}
            </span>
            <button
              className={`qmr-lock${waitingRoom ? " qmr-on" : ""}`}
              disabled={acting === "wr"}
              onClick={async () => {
                setActing("wr");
                const out = await control(waitingRoom ? "waiting_off" : "waiting_on");
                if (out?.error) setStatus({ kind: "err", text: out.error });
                else setWaitingRoom(Boolean(out.waitingRoom));
                setActing("");
              }}
            >
              {waitingRoom ? "Waiting room on" : "Turn on waiting room"}
            </button>
          </div>

          {waiting.length ? (
            <div className="qmr-waitlist">
              <div className="qmr-panel-head">
                <strong>
                  {waiting.length === 1
                    ? `${waiting[0].display_name || "Someone"} is waiting`
                    : `${waiting.length} people waiting`}
                </strong>
                <button
                  className="qmr-lock qmr-on"
                  disabled={acting === "all"}
                  onClick={async () => {
                    setActing("all");
                    const out = await control("admit_all");
                    if (out?.error) setStatus({ kind: "err", text: out.error });
                    else setWaiting(out.waiting || []);
                    setActing("");
                  }}
                >
                  Let everyone in
                </button>
              </div>
              <ul className="qmr-plist">
                {waiting.map((k) => (
                  <li key={k.id}>
                    <span className="qmr-pname">{k.display_name || "Guest"}</span>
                    <button
                      className="qmr-ghost qmr-admit"
                      disabled={acting === k.id}
                      onClick={async () => {
                        setActing(k.id);
                        const out = await control("admit", undefined, k.id);
                        if (out?.error) setStatus({ kind: "err", text: out.error });
                        else setWaiting(out.waiting || []);
                        setActing("");
                      }}
                    >
                      Let in
                    </button>
                    <button
                      className="qmr-ghost"
                      disabled={acting === k.id}
                      onClick={async () => {
                        setActing(k.id);
                        const out = await control("deny", undefined, k.id);
                        if (out?.error) setStatus({ kind: "err", text: out.error });
                        else setWaiting(out.waiting || []);
                        setActing("");
                      }}
                    >
                      Not now
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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

          {/* FIELD 2026-08-18, his words: "there no way to end the meeting."
              LEAVE walks YOU out and the meeting carries on; the host also
              needs the other thing — the whole room ends, for everyone, and
              the meeting is marked over. It lives here with the other
              host-only controls, and it asks once, in place. */}
          <div className="qmr-endrow">
            {confirmEnd ? (
              <>
                <span className="qmr-fine" style={{ margin: 0 }}>
                  Everyone is disconnected and the meeting is marked ended.
                  {recording ? " Stop the recording first or it is cut off here." : ""}
                </span>
                <button
                  className="qmr-endbtn"
                  disabled={ending}
                  onClick={async () => {
                    setEnding(true);
                    const out = await control("end");
                    setEnding(false);
                    if (out?.error) {
                      setStatus({ kind: "err", text: out.error });
                      setConfirmEnd(false);
                      return;
                    }
                    ctx.disconnect();
                    window.location.href = "/host";
                  }}
                >
                  {ending ? "Ending…" : "Yes — end it for everyone"}
                </button>
                <button className="qmr-ghost" onClick={() => setConfirmEnd(false)}>Keep going</button>
              </>
            ) : (
              <button className="qmr-endbtn" onClick={() => setConfirmEnd(true)}>
                End meeting for everyone
              </button>
            )}
          </div>
        </div>
      ) : null}

      {railOpen ? (
        <LiveRail
          cc={cc}
          recording={recording}
          flags={flags}
          onFlag={flagNow}
          canFlag={cc.on || recording}
          onClose={() => setRailOpen(false)}
          shifted={isHost && panel}
          top={headroom}
        />
      ) : null}

      <CaptionBar cc={cc} open={ccOpen} onOpen={() => setCcOpen((o) => !o)} />

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


// ───────────────────────────────────────────────────────────────────────────
// Reactions
//
// A meeting is people, and people interrupt. Without a way to agree, disagree
// or ask to speak, the only tool anyone has is to talk over whoever is
// talking — so the loudest person wins and the quietest one never says the
// thing they came to say. That is what these buttons are for. They are not
// decoration.
//
// Two kinds, and the difference matters:
//   · A REACTION is a moment. Clap, thumbs, laugh. It floats up and it is
//     gone, because "I agreed with that sentence" stops being true a sentence
//     later.
//   · A STATE is a fact about a person right now. A raised hand, or stepping
//     away. It stays until they take it down, everyone can see WHOSE it is,
//     and — the part that is easy to get wrong — somebody who joins the call
//     afterwards sees it too.
//
// The state half is heartbeated for exactly that reason. A raised hand
// re-announces itself every few seconds; one that stops announcing is taken
// down after fifteen. So a late joiner learns about it within a heartbeat,
// and a hand belonging to somebody whose laptop died does not stay up for the
// rest of the meeting with nobody able to lower it.
// ───────────────────────────────────────────────────────────────────────────

const REACT_TOPIC = "qm-react";
const STATE_TOPIC = "qm-state";
const STATE_TTL_MS = 15000;
const STATE_BEAT_MS = 5000;

const QUICK: Array<{ key: string; glyph: string; label: string }> = [
  { key: "clap",   glyph: "👏", label: "Applaud" },
  { key: "up",     glyph: "👍", label: "Agree" },
  { key: "down",   glyph: "👎", label: "Disagree" },
  { key: "smile",  glyph: "🙂", label: "Smile" },
  { key: "laugh",  glyph: "😂", label: "Laugh" },
  { key: "party",  glyph: "🎉", label: "Celebrate" },
  { key: "heart",  glyph: "❤️", label: "Love it" },
  { key: "think",  glyph: "🤔", label: "Not sure" },
];

type Floater = { id: string; glyph: string; who: string; x: number };
type Held = { kind: "hand" | "brb"; who: string; at: number };

// ── LIVE NOTES — the rail where the meeting writes itself down ──────────
//
// DESIGN 2026-08-18. Timestamped finals, and cards for the two kinds of
// sentence a meeting exists to produce. The rules are lib/live's — the SAME
// ones the finish route applies to the recording, so tonight's email can
// never disagree with what this rail showed in the room.
function LiveRail({
  cc, recording, flags, onFlag, canFlag, onClose, shifted, top,
}: {
  cc: CaptionsApi;
  recording: boolean;
  flags: Array<{ at: number; by: string }>;
  onFlag: () => void;
  canFlag: boolean;
  onClose: () => void;
  shifted?: boolean;
  top: number;
}) {
  // The button answers the press even when the newest card is off-screen —
  // an action with no acknowledgement reads as a button that does nothing.
  const [flashed, setFlashed] = useState(false);
  const settled = finals(cc.log);
  const caught = catchLive(settled.map((c) => ({ who: c.who, text: c.text, at: c.at })));
  const counts = caughtCounts(caught);
  const talk = talked(settled.map((c) => ({ who: c.who, text: c.text })));
  const talkers = Object.entries(talk).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const feed = [
    ...settled.slice(-14).map((c) => ({ kind: "said" as const, at: c.at, who: c.who, text: c.text })),
    ...caught.map((c) => ({ kind: c.kind, at: c.at, who: c.who, text: c.text })),
    ...flags.map((f) => ({ kind: "flag" as const, at: f.at, who: f.by, text: "Moment flagged" })),
  ].sort((a, b) => a.at - b.at).slice(-24);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <aside className={`qmr-liverail${shifted ? " is-shifted" : ""}`} style={{ top }} aria-label="Live notes">
      <div className="qmr-lrhead">
        <span className="qmr-lrtitle"><span className="q-dot q-beat" /> LIVE NOTES</span>
        <span className="qmr-lrsub">NOBODY TAKES MINUTES</span>
        <button className="qmr-lrclose" onClick={onClose} aria-label="Close live notes">×</button>
      </div>

      {!cc.on ? (
        <p className="qmr-lrnote">
          Turn captions on and the meeting starts writing itself down here —
          decisions and commitments get caught as they are said.
        </p>
      ) : null}

      <div className="qmr-lrfeed" ref={box}>
        {feed.length === 0 && cc.on ? <p className="qmr-lrnote">Listening…</p> : null}
        {feed.map((f, i) =>
          f.kind === "said" ? (
            <p className="qmr-lrsaid" key={`${f.at}-${i}`}>
              <span className="qmr-lrat">{atLabel(f.at)}</span>
              <b>{f.who}:</b> {f.text}
            </p>
          ) : (
            <div className={`qmr-lrcard ${f.kind === "decision" ? "is-dec" : f.kind === "flag" ? "is-flag" : "is-act"}`}
                 key={`${f.at}-${i}`}>
              <p className="qmr-lrkind">
                {atLabel(f.at)} {f.kind === "decision" ? "DECISION CAUGHT"
                  : f.kind === "flag" ? `FLAGGED BY ${f.who.toUpperCase()}` : `ACTION → ${f.who.toUpperCase()}`}
              </p>
              {f.kind !== "flag" ? <p className="qmr-lrtext">{f.text}</p> : null}
            </div>
          )
        )}
      </div>

      {talkers.length ? (
        <div className="qmr-lrtalk">
          {talkers.map(([who, pct]) => (
            <span key={who} title={`${who} — ${pct}% of the words so far`}>
              {who.split(" ")[0].toUpperCase()} {pct}%
            </span>
          ))}
        </div>
      ) : null}

      <div className="qmr-lrfoot">
        <span className="qmr-lrcount">
          CAUGHT SO FAR&nbsp;&nbsp;<b>{counts.decisions}</b> DECISION{counts.decisions === 1 ? "" : "S"} ·{" "}
          <b>{counts.actions}</b> ACTION{counts.actions === 1 ? "" : "S"}
        </span>
        <button className="qmr-lrflag" disabled={!canFlag}
          onClick={() => { onFlag(); setFlashed(true); setTimeout(() => setFlashed(false), 1200); }}
          title={canFlag ? "Mark this moment — it goes into the transcript and the notes"
                         : "Turn captions on (or record) first — a flag needs a clock to attach to"}>
          {flashed ? "FLAGGED ✓" : "FLAG THIS MOMENT"}
        </button>
        <p className="qmr-lrfine">
          Everyone here sees the recording badge for as long as it lasts. Notes and
          the summary email go out the moment you stop.
        </p>
      </div>
    </aside>
  );
}

function Reactions() {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [open, setOpen] = useState(false);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [held, setHeld] = useState<Record<string, Held>>({});
  const [mine, setMine] = useState<{ hand: boolean; brb: boolean }>({ hand: false, brb: false });
  const seq = useRef(0);

  const me = localParticipant?.identity || "me";
  const myName = localParticipant?.name || me.split("-")[0] || "Someone";

  const show = useCallback((glyph: string, who: string) => {
    const id = `${Date.now()}-${seq.current++}`;
    // Spread them across the width so three people clapping at once reads as
    // three claps rather than one thick smudge.
    setFloaters((f) => [...f, { id, glyph, who, x: 8 + Math.random() * 76 }].slice(-24));
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 3200);
  }, []);

  const { send: sendReact } = useDataChannel(REACT_TOPIC, (msg) => {
    try {
      const m = JSON.parse(new TextDecoder().decode(msg.payload));
      if (m?.glyph) show(String(m.glyph), String(m.who || "Someone"));
    } catch {
      /* a malformed reaction is not worth a broken meeting */
    }
  });

  const { send: sendState } = useDataChannel(STATE_TOPIC, (msg) => {
    try {
      const m = JSON.parse(new TextDecoder().decode(msg.payload));
      if (!m?.id || !m?.kind) return;
      setHeld((h) => {
        const next = { ...h };
        const key = `${m.id}:${m.kind}`;
        if (m.on) next[key] = { kind: m.kind, who: String(m.who || "Someone"), at: Date.now() };
        else delete next[key];
        return next;
      });
    } catch {
      /* ignore */
    }
  });

  const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

  function react(glyph: string) {
    show(glyph, "You");
    try {
      sendReact(bytes({ glyph, who: myName }), { topic: REACT_TOPIC });
    } catch {
      /* a reaction that doesn't leave the room is not worth an error */
    }
    setOpen(false);
  }

  const announce = useCallback(
    (kind: "hand" | "brb", on: boolean) => {
      try {
        sendState(bytes({ kind, on, id: me, who: myName }), { topic: STATE_TOPIC });
      } catch {
        /* ignore */
      }
    },
    [sendState, me, myName]
  );

  function toggle(kind: "hand" | "brb") {
    const on = !mine[kind];
    setMine((m) => ({ ...m, [kind]: on }));
    setHeld((h) => {
      const next = { ...h };
      const key = `${me}:${kind}`;
      if (on) next[key] = { kind, who: "You", at: Date.now() };
      else delete next[key];
      return next;
    });
    announce(kind, on);
    setOpen(false);
  }

  // The heartbeat, and the sweep. Whatever I am holding, I keep saying so;
  // whatever I haven't heard about lately, I take down.
  useEffect(() => {
    const beat = setInterval(() => {
      if (mine.hand) announce("hand", true);
      if (mine.brb) announce("brb", true);
      const now = Date.now();
      setHeld((h) => {
        const alive: Record<string, Held> = {};
        for (const [k, v] of Object.entries(h)) {
          const isMine = k.startsWith(`${me}:`);
          if (isMine || now - v.at < STATE_TTL_MS) alive[k] = v;
        }
        return alive;
      });
    }, STATE_BEAT_MS);
    return () => clearInterval(beat);
  }, [mine, announce, me]);

  // Someone who leaves takes their hand with them. Without this a person who
  // drops out mid-question leaves a hand up that nobody in the room is able
  // to lower.
  useEffect(() => {
    const here = new Set(participants.map((p) => p.identity));
    here.add(me);
    setHeld((h) => {
      const kept: Record<string, Held> = {};
      for (const [k, v] of Object.entries(h)) if (here.has(k.split(":")[0])) kept[k] = v;
      return Object.keys(kept).length === Object.keys(h).length ? h : kept;
    });
  }, [participants, me]);

  const hands = Object.values(held).filter((h) => h.kind === "hand");
  const away = Object.values(held).filter((h) => h.kind === "brb");

  return (
    <>
      {/* Raised hands are the one thing in this whole component that must be
          impossible to miss — the point of raising your hand is being seen. */}
      {hands.length || away.length ? (
        <div className="qmr-held" role="status" aria-live="polite">
          {hands.length ? (
            <span className="qmr-heldpill qmr-hand">
              ✋ {hands.length === 1 ? `${hands[0].who} has a question` : `${hands.length} hands up`}
              {hands.length > 1 ? <em> · {hands.map((h) => h.who).join(", ")}</em> : null}
            </span>
          ) : null}
          {away.length ? (
            <span className="qmr-heldpill qmr-brb">
              ☕ {away.map((a) => a.who).join(", ")} — back shortly
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="qmr-floats" aria-hidden="true">
        {floaters.map((f) => (
          <span key={f.id} className="qmr-float" style={{ left: `${f.x}%` }}>
            {f.glyph}
            <em>{f.who}</em>
          </span>
        ))}
      </div>

      {/* FIELD 2026-08-20: these three used to float in a pill across the
          middle of the video — over the speaker's chest, on every screen,
          all meeting, whether anybody pressed them or not. Controls belong
          in the control bar with the other controls; only STATE (a hand
          actually up, a reaction actually flying) earns space over the
          picture, and only while it is true. */}
      <ControlDock>
        {open ? (
          <div className="qmr-reactmenu" role="menu">
            {QUICK.map((q) => (
              <button
                key={q.key}
                className="qmr-reactbtn"
                title={q.label}
                aria-label={q.label}
                onClick={() => react(q.glyph)}
              >
                {q.glyph}
              </button>
            ))}
          </div>
        ) : null}
        <button
          className={`qmr-dockbtn${mine.hand ? " qmr-dockon" : ""}`}
          onClick={() => toggle("hand")}
          aria-pressed={mine.hand}
          title={mine.hand ? "Put your hand down" : "Raise your hand"}
        >
          <span aria-hidden>✋</span>
          <span className="qmr-docklabel">{mine.hand ? "Hand up" : "Raise hand"}</span>
        </button>
        <button
          className={`qmr-dockbtn${mine.brb ? " qmr-dockon" : ""}`}
          onClick={() => toggle("brb")}
          aria-pressed={mine.brb}
          title={mine.brb ? "You're back" : "Step away for a moment"}
        >
          <span aria-hidden>☕</span>
          <span className="qmr-docklabel">{mine.brb ? "Away" : "Be right back"}</span>
        </button>
        <button
          className={`qmr-dockbtn${open ? " qmr-dockon" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="React"
        >
          <span aria-hidden>🙂</span>
          <span className="qmr-docklabel">React</span>
        </button>
      </ControlDock>
    </>
  );
}

/* The pen, and the surface it draws on.
   ANNOTATE when somebody is sharing a screen; WHITEBOARD when nobody is —
   one button whose label says which, because offering "annotate" with
   nothing to annotate is a button that does nothing, and offering only a
   whiteboard mid-presentation hides the pen exactly when it is wanted. */
function Drawing() {
  const [on, setOn] = useState(false);
  const shares = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const sharing = shares.length > 0;
  const surface = surfaceFor({ screenShareOn: sharing, boardOpen: on && !sharing });

  // Somebody stopping their share mid-annotation must not leave marks
  // floating over live faces: the surface underneath them is gone, so the
  // pen falls back to a whiteboard rather than lying about what it is on.
  return (
    <>
      <ControlDock>
        <button
          className={`qmr-dockbtn${on ? " qmr-dockon" : ""}`}
          onClick={() => setOn((v) => !v)}
          aria-pressed={on}
          title={sharing ? "Draw over the shared screen" : "Open a shared whiteboard"}
        >
          <span aria-hidden>✎</span>
          <span className="qmr-docklabel">{penLabel({ screenShareOn: sharing, on })}</span>
        </button>
      </ControlDock>
      <Board
        open={on && surface !== "none"}
        surface={surface === "screen" ? "screen" : "board"}
        onClose={() => setOn(false)}
      />
    </>
  );
}

/* Puts its children INSIDE LiveKit's control bar, immediately after the
   screen-share button — the place a person already looks for meeting
   controls. A portal rather than a re-implementation of the whole bar,
   because LiveKit owns mic/camera/share/leave and re-implementing them to
   add three buttons is how a product inherits four bugs.

   The bar is rendered by <VideoConference/> AFTER we mount, and it comes and
   goes with the layout, so we watch for it instead of looking once. Until it
   exists these controls render nowhere at all — which is correct: there is
   no meeting to react to yet. */
function ControlDock({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let node: HTMLElement | null = null;
    const attach = () => {
      // isConnected FIRST, and it is a property read. This callback runs on
      // every DOM mutation in a live meeting — captions alone rewrite the
      // tree several times a second — so the common case (already docked)
      // must not cost a document-wide querySelector. Measured concern, not a
      // hypothetical: the whole point of this round was giving CPU back.
      if (node?.isConnected) return;
      const bar = document.querySelector(BAR) as HTMLElement | null;
      if (!bar) return;
      const { ok, before } = dockAnchor(bar);
      if (!ok) return;
      if (!node) {
        node = document.createElement("div");
        node.className = "qmr-dock";
      }
      bar.insertBefore(node, before);
      setHost(node);
    };
    attach();
    // The bar is re-rendered when someone shares a screen or the layout
    // flips; an observer keeps us docked instead of silently vanishing.
    const mo = new MutationObserver(attach);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      node?.parentNode?.removeChild(node);
    };
  }, []);

  if (!host) return null;
  return createPortal(children as any, host);
}



// ───────────────────────────────────────────────────────────────────────────
// Live captions
//
// FIELD 2026-08-17: we had none. For somebody who can't hear well that is not
// a missing feature, it is whether the meeting is attendable at all — and
// everyone else leans on captions in a noisy room, on a bad line, or in a
// language they read better than they hear.
//
// Each person captions THEIR OWN microphone and broadcasts the text. The
// obvious alternative — mix the room on a server and transcribe the mix — has
// to guess who is speaking from voice alone, costs per-minute for everybody,
// and adds a network hop to the one feature people notice at 200ms. Captioning
// your own microphone knows who you are for free. Attribution stops being a
// machine-learning problem and becomes a fact.
//
// Two engines behind one behaviour. Deepgram when a key exists: more accurate,
// works in every browser, and the same vendor the recording uses, so the live
// text and the saved transcript agree. The browser's own recogniser when it
// doesn't: free, no setup, and available to anyone who opens the app. Whichever
// runs, the person is told — including where their voice goes.
// ───────────────────────────────────────────────────────────────────────────

function hasBrowserRecogniser(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

type CaptionsApi = {
  on: boolean;
  engine: Engine;
  note: string;
  log: Caption[];
  toggle: () => void;
};

function useCaptions(room: string, me: string, myName: string): CaptionsApi {
  const [on, setOn] = useState(false);
  const [engine, setEngine] = useState<Engine>("none");
  const [note, setNote] = useState("");
  const [log, setLog] = useState<Caption[]>([]);
  const t0 = useRef<number>(0);
  const seq = useRef(0);
  const stopper = useRef<null | (() => void)>(null);
  const wantOn = useRef(false);

  const { send } = useDataChannel(CC_TOPIC, (msg) => {
    try {
      const c = JSON.parse(new TextDecoder().decode(msg.payload));
      if (c?.id) setLog((l) => mergeCaption(l, c as Caption));
    } catch {
      /* one malformed packet is not worth losing the captions */
    }
  });

  const emit = useCallback(
    (c: Caption) => {
      setLog((l) => mergeCaption(l, c));
      try {
        send(new TextEncoder().encode(JSON.stringify(c)), { topic: CC_TOPIC });
      } catch {
        /* my own captions still show even if the channel hiccups */
      }
    },
    [send]
  );

  // An unfinished line left frozen on screen reads as "they are still
  // talking". Sweep the drafts; never the finals.
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setLog((l) => pruneStale(l, Date.now() - t0.current)), 2000);
    return () => clearInterval(t);
  }, [on]);

  // ── the browser's own recogniser ────────────────────────────────────────
  const startBrowser = useCallback(() => {
    const R = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!R) return null;
    let rec: any = null;
    let stopped = false;
    let utter = `${me}-${seq.current++}`;

    const boot = () => {
      rec = new R();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = String(r[0]?.transcript || "").trim();
          if (!text) continue;
          emit({
            id: utter,
            who: myName,
            text,
            final: Boolean(r.isFinal),
            at: Date.now() - t0.current,
          });
          // A finished sentence closes its line. The next one is a new
          // utterance — without this every sentence overwrites the last.
          if (r.isFinal) utter = `${me}-${seq.current++}`;
        }
      };
      // Web Speech stops on its own after a stretch of quiet, silently, with
      // no error. Left alone, captions work for a minute and then never
      // again — and nothing on screen says why. Restart it.
      rec.onend = () => { if (!stopped) setTimeout(boot, 300); };
      rec.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          stopped = true;
          setNote("Your browser refused microphone access for captions. Allow the microphone and turn captions on again.");
          setOn(false);
        }
        // "no-speech" and "aborted" are normal. onend restarts.
      };
      try { rec.start(); } catch { /* already running */ }
    };
    boot();
    return () => { stopped = true; try { rec?.stop(); } catch {} };
  }, [emit, me, myName]);

  // ── Deepgram, streaming ─────────────────────────────────────────────────
  const startDeepgram = useCallback(async (token: string) => {
    let ws: WebSocket | null = null;
    let mr: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;
    let utter = `${me}-${seq.current++}`;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNote("Couldn't open the microphone for captions.");
      setOn(false);
      return () => {};
    }

    const qs = new URLSearchParams({
      model: "nova-2",
      smart_format: "true",
      interim_results: "true",
      punctuate: "true",
      encoding: "opus",
    });
    ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${qs}`, ["token", token]);

    ws.onopen = () => {
      if (stopped || !stream) return;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mr = new MediaRecorder(stream, { mimeType: mime });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      mr.start(250);   // a quarter second — the latency people actually feel
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        const text = String(m?.channel?.alternatives?.[0]?.transcript || "").trim();
        if (!text) return;
        const isFinal = Boolean(m?.is_final || m?.speech_final);
        emit({ id: utter, who: myName, text, final: isFinal, at: Date.now() - t0.current });
        if (isFinal) utter = `${me}-${seq.current++}`;
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      // Falling back is better than going quiet. The person asked for
      // captions; which service produces them is our problem, not theirs.
      if (stopped) return;
      setNote("Deepgram dropped the caption connection — switching to your browser's own recogniser.");
      setEngine("browser");
      stopper.current?.();
      stopper.current = startBrowser();
    };

    return () => {
      stopped = true;
      try { mr?.stop(); } catch {}
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { ws?.close(); } catch {}
    };
  }, [emit, me, myName, startBrowser]);

  const toggle = useCallback(() => {
    if (on) {
      wantOn.current = false;
      stopper.current?.();
      stopper.current = null;
      setOn(false);
      return;
    }
    wantOn.current = true;
    if (!t0.current) t0.current = Date.now();
    setOn(true);
    (async () => {
      let picked: Engine = pickEngine(false, hasBrowserRecogniser());
      let token = "";
      try {
        const r = await fetch("/api/captions/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
        const j = await r.json();
        if (j?.engine === "deepgram" && j?.token) {
          picked = "deepgram";
          token = j.token;
        } else if (j?.reason && !hasBrowserRecogniser()) {
          setNote(j.reason);
        }
      } catch {
        /* no token service reachable — the browser path still works */
      }
      if (!wantOn.current) return;
      setEngine(picked);
      setNote(engineNote(picked));
      if (picked === "deepgram") stopper.current = await startDeepgram(token);
      else if (picked === "browser") stopper.current = startBrowser();
      else setOn(false);
    })();
  }, [on, room, startBrowser, startDeepgram]);

  useEffect(() => () => { stopper.current?.(); }, []);

  return { on, engine, note, log, toggle };
}

function CaptionBar({ cc, open, onOpen }: { cc: CaptionsApi; open: boolean; onOpen: () => void }) {
  const lines = visible(cc.log, 3);
  const settled = finals(cc.log);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [open, settled.length]);

  if (!cc.on) return null;
  return (
    <>
      {open ? (
        <div className="qmr-cchist">
          <div className="qmr-cchead">
            <b>Captions so far</b>
            <button className="qmr-x" onClick={onOpen} aria-label="Close">×</button>
          </div>
          <div className="qmr-cclist" ref={box}>
            {settled.length ? (
              settled.map((c) => (
                <p key={c.id}>
                  <span className="qmr-ccat">{stamp(c.at)}</span>
                  <span className="qmr-ccwho">{c.who}</span>
                  {c.text}
                </p>
              ))
            ) : (
              <p className="qmr-ccnone">Nothing has been said yet.</p>
            )}
          </div>
          <p className="qmr-ccfine">{cc.note}</p>
        </div>
      ) : null}

      <div className="qmr-ccbar" role="log" aria-live="polite" aria-label="Live captions">
        {lines.length ? (
          lines.map((c) => (
            <p key={c.id} className={c.final ? "" : "qmr-ccdraft"}>
              <span className="qmr-ccwho">{c.who}</span>
              {c.text}
            </p>
          ))
        ) : (
          <p className="qmr-ccdraft">Listening…</p>
        )}
        <button className="qmr-cctoggle" onClick={onOpen}>
          {open ? "Hide" : `All ${settled.length || ""}`.trim()}
        </button>
      </div>
    </>
  );
}


const CSS = DEVICE_CSS + GUARD_CSS + BOARD_CSS + `
/* The playback gate. Impossible to miss on purpose: a person who cannot hear
   the meeting is thirty seconds from leaving it. */
.qmr-playgate { position:absolute; left:50%; transform:translateX(-50%); top:64px; z-index:80;
  width:min(560px, calc(100% - 24px)); display:flex; flex-direction:column; gap:4px; text-align:left;
  font:inherit; cursor:pointer; background:#0d2a2a; border:1px solid #00a99d; color:#c8f5f0;
  border-radius:12px; padding:13px 15px; box-shadow:0 14px 36px rgba(0,0,0,.55); }
.qmr-playgate b { font-size:14.5px; color:#7fe0d6; }
.qmr-playgate span { font-size:12.5px; line-height:1.55; }
.qmr-playgate:hover:not(:disabled) { background:#10393a; }
.qmr-playgate:disabled { opacity:.6; cursor:default; }
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
.qmr-mediafail { position:absolute; left:50%; transform:translateX(-50%); top:64px; z-index:39;
  max-width:min(560px, calc(100% - 24px)); background:#2a1618; border:1px solid #5a2a2f;
  color:#ffd0d0; border-radius:12px; padding:11px 14px; font-size:13.5px; line-height:1.5; }
.qmr-wr { margin-top:12px; padding-top:12px; border-top:1px solid #262b36; gap:10px; }
.qmr-waitlist { margin-top:12px; padding:10px 12px; background:#0d3d39; border:1px solid #00a99d;
  border-radius:11px; }
.qmr-waitlist .qmr-panel-head strong { color:#c8f2ec; }
.qmr-admit { border-color:#00a99d !important; color:#7fe0d6 !important; }
.qmr-knock { display:flex; gap:11px; align-items:flex-start; background:#0d3d39;
  border:1px solid #00a99d; border-radius:12px; padding:14px 16px; margin:0 0 14px;
  color:#c8f2ec; font-size:14.5px; line-height:1.6; }
.qmr-knock p { margin:0; }
.qmr-knockno { background:#2a1618; border-color:#5a2a2f; color:#ffd0d0; }
.qmr-knockdot { width:9px; height:9px; border-radius:50%; background:#7fe0d6; flex:0 0 auto;
  margin-top:7px; animation:qmr-pulse 1.6s ease-in-out infinite; }
@keyframes qmr-pulse { 0%,100% { opacity:.35; transform:scale(.8) } 50% { opacity:1; transform:scale(1.15) } }
.qmr-ghost { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qmr-ghost:hover { border-color: #3b4356; }
.qmr-leave { background: #3a1f26; color: #ffc9c9; border: 1px solid #5c2b35; }
.qmr-rec { background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38;
  display: inline-flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.qmr-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5964;
  animation: qmr-pulse 1.2s ease-in-out infinite; }
@keyframes qmr-pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
/* FIELD 2026-08-17, from a screenshot of a live meeting: the controls were
   off the bottom of the window and you had to scroll a video call to find
   Leave.

   The cause was one line. ".qmr-stage" was a 100vh flex column, and
   "<LiveKitRoom>" sat inside it with an inline "height: 100%" — but
   LiveKitRoom renders a plain <div>, which is NOT a flex container. So
   ".qmr-conf { flex: 1 }" was addressing a parent that had no flex layout to
   take part in: the rule did nothing, the conference sized itself to its
   content, and the whole column grew past the viewport. The header, being
   "flex-wrap: wrap", then made it worse every time a panel opened.

   Now the chain is unbroken: stage is the viewport, LiveKitRoom is a flex
   column that fills it, and the conference takes whatever is left. And
   "overflow: hidden" on the stage means a mistake like this can never again
   express itself as a scrollbar the user has to discover. */
.qmr-stage { height: 100vh; height: 100dvh; overflow: hidden;
  display: flex; flex-direction: column; background: #0b0d13;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; }
.qmr-lk { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.qmr-bar { position: relative; flex: 0 0 auto; display: flex; align-items: center;
  gap: 12px; padding: 8px 14px; background: #12151d;
  border-bottom: 1px solid #262b36; flex-wrap: nowrap; overflow: visible; }
.qmr-logo { font-weight: 600; }
.qmr-people { color: #8b93a5; font-size: 13px; }
.qmr-bar button { flex: 0 0 auto; }
.qmr-names { font-style: normal; color: #6f7789; }
.qmr-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: nowrap;
  overflow-x: auto; scrollbar-width: none; }
.qmr-actions::-webkit-scrollbar { display: none; }
.qmr-people { flex: 0 1 auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.qmr-logo { flex: 0 0 auto; }
@media (max-width: 720px) {
  .qmr-logo, .qmr-people { display: none; }   /* the meeting is the point */
  .qmr-bar { padding: 6px 10px; }
}
.qmr-conf { flex: 1 1 auto; min-height: 0; min-width: 0; position: relative; }
/* Both of these used to be "flex-basis: 100%" inside the header, so opening
   "Manage people" made the header a second row tall and pushed the video down
   — the meeting itself got smaller because you asked who was in it. They
   float over the stage now: the video never moves. */
.qmr-status { position: absolute; top: calc(100% + 8px); right: 12px; z-index: 30;
  max-width: min(440px, calc(100vw - 24px)); display: flex; align-items: center;
  gap: 10px; font-size: 13px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #262b36; background: #10131a;
  box-shadow: 0 12px 30px rgba(0,0,0,.5); }
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
.qmr-when { margin: 0 0 14px; font-size: 14px; color: #8fd8cf; line-height: 1.5;
  background: #10131a; border: 1px solid #1f4f49; border-radius: 10px; padding: 11px 13px; }

/* The badge everyone sees while it is happening. */
.qmr-recbadge { display: inline-flex; align-items: center; gap: 7px;
  background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38;
  border-radius: 999px; padding: 4px 12px; font-size: 12.5px; font-weight: 600; }
.qmr-recwho { font-style: normal; font-weight: 400; color: #e2aeb2; }

/* Host controls. */
.qmr-on { border-color: #00a99d; color: #7fe0d6; }
.qmr-panel { position: absolute; top: calc(100% + 8px); right: 12px; z-index: 40;
  width: min(360px, calc(100vw - 24px)); max-height: min(60vh, 460px);
  overflow: auto; background: #10131a; border: 1px solid #262b36;
  border-radius: 12px; padding: 14px; box-shadow: 0 18px 44px rgba(0,0,0,.6); }
.qmr-panel-head { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.qmr-lock { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qmr-plist { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 7px; }
.qmr-plist li { display: flex; align-items: center; gap: 8px; }
.qmr-pname { flex: 1 1 auto; min-width: 0; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qmr-plist button { padding: 5px 12px; font-size: 12.5px; }
/* ── Reactions ─────────────────────────────────────────────────────────── */
/* The presence controls, now INSIDE LiveKit's control bar rather than
   floating over the speaker's chest (FIELD 2026-08-20). They borrow the
   bar's own metrics so they read as part of it, not as a bolt-on. */
.qmr-dock { display: flex; align-items: center; gap: 6px; position: relative; }
.qmr-dockbtn { display: inline-flex; align-items: center; gap: 7px; font: inherit;
  font-size: 14px; line-height: 1; cursor: pointer; background: #1a1f2a;
  color: #cfd6e4; border: 1px solid #2b3240; border-radius: 8px;
  padding: 0 12px; height: 42px; white-space: nowrap; }
.qmr-dockbtn:hover { background: #222835; }
.qmr-dockon { background: #0d3d39; color: #7fe0d6; border-color: #00a99d; }
/* Below this the bar would wrap, and a wrapped control bar is how the Leave
   button ended up off-screen once already. Glyphs alone, then. */
@media (max-width: 760px) { .qmr-docklabel { display: none; } }
.qmr-reactmenu { position: absolute; bottom: calc(100% + 10px); left: 50%;
  transform: translateX(-50%); display: flex; gap: 4px;
  background: rgba(16,19,26,.97); border: 1px solid #2b3240;
  border-radius: 999px; padding: 6px; z-index: 40;
  backdrop-filter: blur(8px); box-shadow: 0 10px 30px rgba(0,0,0,.55); }
.qmr-reactbtn { font-size: 21px; line-height: 1; cursor: pointer;
  background: transparent; border: 0; border-radius: 50%; width: 40px;
  height: 40px; transition: transform .12s ease, background .12s ease; }
.qmr-reactbtn:hover { background: #1f2531; transform: scale(1.22); }

.qmr-floats { position: absolute; inset: 0; overflow: hidden;
  pointer-events: none; z-index: 24; }
.qmr-float { position: absolute; bottom: 120px; font-size: 34px; line-height: 1;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  animation: qmr-rise 3.2s cubic-bezier(.22,.7,.3,1) forwards; }
.qmr-float em { font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, sans-serif; font-style: normal; color: #e9edf5;
  background: rgba(11,13,19,.72); border-radius: 999px; padding: 3px 8px;
  white-space: nowrap; }
@keyframes qmr-rise {
  0%   { opacity: 0; transform: translateY(20px) scale(.6); }
  12%  { opacity: 1; transform: translateY(0) scale(1.1); }
  30%  { transform: translateY(-40px) scale(1); }
  100% { opacity: 0; transform: translateY(-230px) scale(.85); }
}
@media (prefers-reduced-motion: reduce) {
  .qmr-float { animation: qmr-fade 2.2s linear forwards; }
  @keyframes qmr-fade { 0%,70% { opacity: 1 } 100% { opacity: 0 } }
  .qmr-dot { animation: none; }
}

.qmr-held { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 26; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
  max-width: calc(100% - 24px); pointer-events: none; }
.qmr-heldpill { display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600; border-radius: 999px; padding: 6px 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.qmr-heldpill em { font-style: normal; font-weight: 400; opacity: .8; }
.qmr-hand { background: #4a3a13; color: #ffe08a; border: 1px solid #7a611f; }
.qmr-brb  { background: #1b2430; color: #a9c2dd; border: 1px solid #33455c; }
@media (max-width: 720px) {
  .qmr-dockbtn { padding: 0 10px; font-size: 16px; }
}

/* ── Live captions ─────────────────────────────────────────────────────── */
.qmr-ccbar { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: 130px; z-index: 27; width: min(920px, calc(100% - 32px));
  background: rgba(8,10,14,.9); border: 1px solid #262b36; border-radius: 12px;
  padding: 12px 56px 12px 16px; backdrop-filter: blur(10px);
  box-shadow: 0 14px 40px rgba(0,0,0,.55); }
/* Caption text is bigger than body text on purpose. It is being READ, at a
   glance, by somebody who may not be hearing the words at all. */
.qmr-ccbar p { margin: 0 0 4px; font-size: 17px; line-height: 1.45; color: #f2f5fa; }
.qmr-ccbar p:last-of-type { margin-bottom: 0; }
.qmr-ccdraft { color: #97a0b2 !important; }
.qmr-ccwho { color: #00a99d; font-weight: 600; margin-right: 8px; }
.qmr-cctoggle { position: absolute; top: 10px; right: 10px; font: inherit;
  font-size: 12px; cursor: pointer; background: #1a1f2a; color: #9aa3b4;
  border: 1px solid #2b3240; border-radius: 999px; padding: 4px 10px; }
.qmr-cctoggle:hover { color: #e9edf5; }

.qmr-cchist { position: absolute; right: 16px; bottom: 200px; z-index: 28;
  width: min(420px, calc(100% - 32px)); max-height: min(52vh, 420px);
  display: flex; flex-direction: column;
  background: rgba(8,10,14,.96); border: 1px solid #262b36; border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0,0,0,.6); }
.qmr-cchead { display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; border-bottom: 1px solid #21252f; font-size: 13px; }
.qmr-cclist { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 14px; }
.qmr-cclist p { margin: 0 0 9px; font-size: 14px; line-height: 1.5; color: #cfd6e4; }
.qmr-ccat { color: #6f7789; font-variant-numeric: tabular-nums; margin-right: 8px;
  font-size: 12px; }
.qmr-ccnone { color: #8b93a5 !important; }

/* ── live notes rail ── */
.qmr-liverail { position: fixed; top: 60px; right: 12px; bottom: 92px; width: 320px;
  z-index: 45; display: flex; flex-direction: column; border: 1px solid #1b2735;
  background: rgba(5, 8, 13, .97); backdrop-filter: blur(10px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .55);
  transition: right .18s ease; }
.qmr-liverail.is-shifted { right: calc(12px + min(360px, calc(100vw - 24px)) + 10px); }
.qmr-liverail::before { content: ""; position: absolute; top: -1px; left: -1px; width: 12px;
  height: 12px; border-top: 2px solid #00a99d; border-left: 2px solid #00a99d; }
.qmr-lrhead { display: flex; align-items: center; gap: 10px; padding: 11px 14px;
  border-bottom: 1px solid #131c26; }
.qmr-lrtitle { display: flex; align-items: center; gap: 7px; font: 600 10.5px/1 'IBM Plex Mono', monospace;
  letter-spacing: .18em; color: #4dd7cf; white-space: nowrap; }
.qmr-lrsub { font: 9px/1 'IBM Plex Mono', monospace; letter-spacing: .1em; color: #4a566b; margin-left: auto; white-space: nowrap; }
.qmr-lrclose { background: none; border: 0; color: #7b8aa0; font-size: 16px; cursor: pointer; padding: 0 2px; }
.qmr-lrclose:hover { color: #e8eef5; }
.qmr-lrnote { padding: 10px 14px; margin: 0; font-size: 12.5px; line-height: 1.55; color: #7b8aa0; }
.qmr-lrfeed { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 14px; }
.qmr-lrsaid { margin: 0 0 9px; font-size: 12.5px; line-height: 1.5; color: #a9b3c4; }
.qmr-lrsaid b { color: #cfd6e4; font-weight: 600; }
.qmr-lrat { font: 10px/1 'IBM Plex Mono', monospace; color: #4a566b; margin-right: 7px;
  font-variant-numeric: tabular-nums; }
.qmr-lrcard { margin: 4px 0 10px; padding: 9px 12px; border-left: 2px solid #00a99d;
  background: rgba(0, 169, 157, .08); }
.qmr-lrcard.is-act { border-left-color: #ffc98a; background: rgba(255, 201, 138, .07); }
.qmr-lrcard.is-flag { border-left-color: #4dd7cf; background: rgba(77, 215, 207, .07); }
.qmr-lrkind { margin: 0 0 3px; font: 600 9.5px/1.4 'IBM Plex Mono', monospace;
  letter-spacing: .14em; color: #4dd7cf; }
.qmr-lrcard.is-act .qmr-lrkind { color: #ffc98a; }
.qmr-lrtext { margin: 0; font-size: 12.5px; line-height: 1.5; color: #e2e8f2; }
.qmr-lrtalk { display: flex; gap: 10px; flex-wrap: wrap; padding: 8px 14px;
  border-top: 1px solid #131c26; font: 9.5px/1 'IBM Plex Mono', monospace;
  letter-spacing: .1em; color: #7b8aa0; }
.qmr-lrfoot { border-top: 1px solid #131c26; padding: 10px 14px; }
.qmr-lrcount { display: block; font: 10px/1.5 'IBM Plex Mono', monospace; letter-spacing: .12em;
  color: #7b8aa0; margin-bottom: 8px; }
.qmr-lrcount b { color: #4dd7cf; }
.qmr-lrflag { display: block; width: 100%; padding: 9px; background: none;
  border: 1px solid #1e2937; color: #c3cddb; font: 10.5px/1 'IBM Plex Mono', monospace;
  letter-spacing: .16em; cursor: pointer; }
.qmr-lrflag:hover:not(:disabled) { border-color: #00a99d; color: #7ff0e8; }
.qmr-lrflag:disabled { opacity: .45; cursor: default; }
.qmr-lrfine { margin: 8px 0 0; font-size: 10.5px; line-height: 1.5; color: #4a566b; }
@media (max-width: 900px) { .qmr-liverail { display: none; } }

/* ── end meeting ── */
.qmr-endrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px; border-top: 1px solid #262b36; }
.qmr-endbtn { background: transparent; border: 1px solid #7a2f38; color: #ff5964;
  padding: 9px 14px; font: 600 11px 'IBM Plex Mono', monospace; letter-spacing: .1em;
  cursor: pointer; }
.qmr-endbtn:hover:not(:disabled) { background: rgba(255, 89, 100, .1); }
.qmr-endbtn:disabled { opacity: .5; cursor: default; }

/* ── lobby facts row ── */
.qmr-lobbyfacts { display: flex; gap: 26px; flex-wrap: wrap; margin: 14px 0 2px;
  padding-top: 12px; border-top: 1px solid #131c26; }
.qmr-lobbyfacts i { display: block; font: 9.5px/1 'IBM Plex Mono', monospace; font-style: normal;
  letter-spacing: .18em; color: #4a566b; margin-bottom: 4px; }
.qmr-lobbyfacts b { font-size: 13px; font-weight: 500; color: #c3cddb; }
.qmr-ccfine { margin: 0; padding: 10px 14px; border-top: 1px solid #21252f;
  font-size: 11.5px; line-height: 1.5; color: #6f7789; }
@media (max-width: 720px) {
  .qmr-ccbar { bottom: 118px; padding: 10px 50px 10px 12px; }
  .qmr-ccbar p { font-size: 15px; }
  .qmr-cchist { right: 8px; left: 8px; width: auto; bottom: 186px; }
}

.qmr-fine { margin: 12px 0 0; font-size: 12px; color: #8b93a5; line-height: 1.5; }
`;
