"use client";

// The thirty seconds before you join.
//
// FIELD 2026-08-18: he joined, talked, and found out from his team that
// nobody could hear him. The app had no step between typing your name and
// being live in front of people — so the first thing that tested his
// microphone was the meeting itself.
//
// Every serious meeting tool has this screen and it is not vanity. It exists
// because the only cheap moment to discover a dead microphone is while nobody
// is waiting for you. A level meter you can watch move is the difference
// between "I think it's working" and "I know it's working", and it is the one
// piece of evidence that distinguishes a broken microphone from a quiet room.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeMediaError, audioConstraints, videoConstraints, deviceLabel,
  pickDevice, levelFrom, bars, speakerPickerWorks, speakerNote, isBluetooth,
  type Device, type Explained,
} from "@/lib/media";

const SAVED = { mic: "qm.mic", cam: "qm.cam", spk: "qm.spk" };

function remember(key: string, id: string) {
  try { window.localStorage.setItem(key, id); } catch { /* private window */ }
}
function recall(key: string): string {
  try { return window.localStorage.getItem(key) || ""; } catch { return ""; }
}

export type Choice = { micId: string; camId: string; spkId: string; camOn: boolean; micOn: boolean };

export default function DeviceCheck({
  name, onJoin, busy, blocked, blockedLabel,
}: {
  name: string;
  onJoin: (c: Choice) => void;
  /** genuinely mid-join */
  busy?: boolean;
  /** cannot join YET, for a reason the person can fix */
  blocked?: boolean;
  blockedLabel?: string;
}) {
  const [mics, setMics] = useState<Device[]>([]);
  const [cams, setCams] = useState<Device[]>([]);
  const [spks, setSpks] = useState<Device[]>([]);
  const [micId, setMicId] = useState(recall(SAVED.mic));
  const [camId, setCamId] = useState(recall(SAVED.cam));
  const [spkId, setSpkId] = useState(recall(SAVED.spk));
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [micErr, setMicErr] = useState<Explained | null>(null);
  const [camErr, setCamErr] = useState<Explained | null>(null);
  const [switched, setSwitched] = useState("");
  const [testing, setTesting] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  /** Acquire, preview, and measure. Audio and video are asked for SEPARATELY
   *  on purpose: with one combined call, a camera held by another app fails
   *  the whole request and takes the microphone down with it — so the person
   *  with a Teams window open in the background arrives with no audio either,
   *  and no idea why. */
  const start = useCallback(async (wantMic: string, wantCam: string) => {
    stop();
    const out = new MediaStream();

    let audioTrack: MediaStreamTrack | null = null;
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(wantMic) });
      audioTrack = a.getAudioTracks()[0] || null;
      if (audioTrack) out.addTrack(audioTrack);
      setMicErr(null);
    } catch (e) {
      setMicErr(describeMediaError(e, "audioinput"));
    }

    try {
      const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(wantCam) });
      v.getVideoTracks().forEach((t) => out.addTrack(t));
      setCamErr(null);
    } catch (e) {
      setCamErr(describeMediaError(e, "videoinput"));
    }

    stream.current = out;
    if (video.current) video.current.srcObject = out;

    // Labels only exist once permission has been granted, which is why the
    // list is read AFTER asking and not before.
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mi = all.filter((d) => d.kind === "audioinput") as Device[];
      const ci = all.filter((d) => d.kind === "videoinput") as Device[];
      const si = all.filter((d) => d.kind === "audiooutput") as Device[];
      setMics(mi); setCams(ci); setSpks(si);

      const pm = pickDevice(mi, wantMic);
      const pc = pickDevice(ci, wantCam);
      if (pm.id) setMicId(pm.id);
      if (pc.id) setCamId(pc.id);
      // Do not swap somebody's microphone without telling them.
      setSwitched(
        pm.savedIsGone
          ? "The microphone you used last time isn't here now, so this one is selected instead."
          : pc.savedIsGone
            ? "The camera you used last time isn't here now, so this one is selected instead."
            : ""
      );
    } catch { /* the preview still works without a list */ }

    if (audioTrack) {
      try {
        const ac = ctx.current || new AudioContext();
        ctx.current = ac;
        if (ac.state === "suspended") await ac.resume();
        const src = ac.createMediaStreamSource(new MediaStream([audioTrack]));
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        let top = 0;
        const tick = () => {
          an.getByteTimeDomainData(buf);
          const l = levelFrom(buf);
          setLevel(l);
          if (l > top) { top = l; setPeak(l); }
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch { /* no meter is survivable; no microphone is not */ }
    }
  }, [stop]);

  useEffect(() => {
    start(recall(SAVED.mic), recall(SAVED.cam));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A headset plugged in while this screen is open should appear in the list.
  useEffect(() => {
    const onChange = () => {
      navigator.mediaDevices.enumerateDevices().then((all) => {
        setMics(all.filter((d) => d.kind === "audioinput") as Device[]);
        setCams(all.filter((d) => d.kind === "videoinput") as Device[]);
        setSpks(all.filter((d) => d.kind === "audiooutput") as Device[]);
      }).catch(() => {});
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  async function testSpeaker() {
    if (testing) return;
    setTesting(true);
    try {
      const ac = ctx.current || new AudioContext();
      ctx.current = ac;
      if (ac.state === "suspended") await ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.75);
    } catch { /* nothing to do; the button simply did not sound */ }
    setTimeout(() => setTesting(false), 800);
  }

  const spkWorks = speakerPickerWorks();
  const micLabel = deviceLabel(mics.find((d) => d.deviceId === micId), 0, "audioinput");
  const heard = peak > 0.02;

  function go() {
    remember(SAVED.mic, micId); remember(SAVED.cam, camId); remember(SAVED.spk, spkId);
    stop();
    onJoin({ micId, camId, spkId, camOn: camOn && !camErr, micOn: micOn && !micErr });
  }

  return (
    <div className="qmd">
      <div className="qmd-prev">
        {camErr ? (
          <div className="qmd-off">
            <b>{camErr.what}</b>
            <span>{camErr.fix}</span>
            <button className="qmd-retry" onClick={() => start(micId, camId)}>Retry camera</button>
          </div>
        ) : (
          <>
            <video
              ref={video}
              autoPlay
              muted
              playsInline
              className={`qmd-video${camOn ? "" : " qmd-hidden"}`}
            />
            {!camOn ? <div className="qmd-off"><b>Camera off</b><span>People will see your name.</span></div> : null}
          </>
        )}
        <div className="qmd-toggles">
          <button
            className={`qmd-t${micOn && !micErr ? " qmd-ton" : ""}`}
            onClick={() => setMicOn((v) => !v)}
            disabled={Boolean(micErr)}
          >
            {micErr ? "No mic" : micOn ? "Mic on" : "Mic off"}
          </button>
          <button
            className={`qmd-t${camOn && !camErr ? " qmd-ton" : ""}`}
            onClick={() => setCamOn((v) => !v)}
            disabled={Boolean(camErr)}
          >
            {camErr ? "No camera" : camOn ? "Camera on" : "Camera off"}
          </button>
        </div>
      </div>

      {/* The meter. This is the whole reason the screen exists: a thing that
          moves when you talk is the only proof that separates a dead
          microphone from a quiet room. */}
      <div className="qmd-meter-wrap">
        <div className="qmd-meter" aria-hidden>
          {bars(level, 14).map((lit, i) => (
            <span key={i} className={`qmd-bar${lit ? " qmd-lit" : ""}`} />
          ))}
        </div>
        <div className={`qmd-say${micErr ? " qmd-bad" : heard ? " qmd-good" : ""}`}>
          {micErr
            ? micErr.what
            : heard
              ? "Your microphone is working — that's you."
              : "Say something. The bar should move."}
        </div>
      </div>

      {micErr ? (
        <div className="qmd-err">
          <b>{micErr.what}</b>
          <span>{micErr.fix}</span>
          <button className="qmd-retry" onClick={() => start(micId, camId)}>Retry microphone</button>
        </div>
      ) : null}
      {switched ? <p className="qmd-note">{switched}</p> : null}
      {!micErr && isBluetooth(micLabel) ? (
        <p className="qmd-note">
          {micLabel} is a Bluetooth device. If people stop hearing you mid-call,
          that is almost always the headset switching audio profiles — we watch
          for it and reconnect, and you can also pick a different microphone here.
        </p>
      ) : null}

      <div className="qmd-picks">
        <label className="qmd-pick">
          <span>Microphone</span>
          <select value={micId} onChange={(e) => { setMicId(e.target.value); start(e.target.value, camId); }}>
            {mics.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "audioinput")}</option>
            ))}
            {!mics.length ? <option value="">No microphone found</option> : null}
          </select>
        </label>
        <label className="qmd-pick">
          <span>Camera</span>
          <select value={camId} onChange={(e) => { setCamId(e.target.value); start(micId, e.target.value); }}>
            {cams.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "videoinput")}</option>
            ))}
            {!cams.length ? <option value="">No camera found</option> : null}
          </select>
        </label>
        <label className="qmd-pick">
          <span>Speaker</span>
          <div className="qmd-spk">
            <select
              value={spkId}
              disabled={!spkWorks}
              onChange={(e) => setSpkId(e.target.value)}
            >
              {spks.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "audiooutput")}</option>
              ))}
              {!spks.length ? <option value="">System default</option> : null}
            </select>
            <button className="qmd-test" onClick={testSpeaker} disabled={testing}>
              {testing ? "♪" : "Test"}
            </button>
          </div>
        </label>
      </div>
      {!spkWorks ? <p className="qmd-note">{speakerNote(false)}</p> : null}

      {/* FIELD 2026-08-18, read off a live screenshot: this said "Joining…"
          while it was simply waiting for the consent box to be ticked. A
          button reporting an action nobody started is worse than one saying
          nothing — the person waits for something that is not happening. */}
      <button className="qmr-primary qmd-join" onClick={go} disabled={busy || blocked}>
        {busy
          ? "Joining…"
          : blocked
            ? blockedLabel || "Not ready yet"
            : name
              ? `Join as ${name}`
              : "Join meeting"}
      </button>
    </div>
  );
}

export const DEVICE_CSS = `
.qmd { display:flex; flex-direction:column; gap:14px; }
.qmd-prev { position:relative; aspect-ratio:16/9; background:#0b0e14; border:1px solid #262b36;
  border-radius:12px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
.qmd-video { width:100%; height:100%; object-fit:cover; transform:scaleX(-1); }
.qmd-hidden { visibility:hidden; }
.qmd-off { position:absolute; inset:0; display:flex; flex-direction:column; gap:6px;
  align-items:center; justify-content:center; text-align:center; padding:22px;
  color:#8b93a5; font-size:13.5px; line-height:1.55; }
.qmd-off b { color:#e9edf5; font-size:15px; }
.qmd-off span { max-width:46ch; }
.qmd-toggles { position:absolute; left:0; right:0; bottom:10px; display:flex;
  gap:8px; justify-content:center; }
.qmd-t { font:inherit; font-size:13px; cursor:pointer; padding:7px 14px; border-radius:999px;
  background:rgba(10,13,20,.82); color:#9aa3b4; border:1px solid #333b4a; backdrop-filter:blur(6px); }
.qmd-ton { background:rgba(0,169,157,.16); color:#7fe0d6; border-color:#00a99d; }
.qmd-t:disabled { opacity:.55; cursor:default; }
.qmd-meter-wrap { display:flex; flex-direction:column; gap:7px; }
.qmd-meter { display:flex; gap:3px; height:16px; align-items:stretch; }
.qmd-bar { flex:1 1 0; border-radius:2px; background:#1c212c; transition:background .06s linear; }
.qmd-lit { background:#00a99d; }
.qmd-bar:nth-last-child(-n+3).qmd-lit { background:#f0b354; }
.qmd-say { font-size:13px; color:#8b93a5; }
.qmd-good { color:#7fe0d6; }
.qmd-bad { color:#ffb4b4; }
.qmd-err { background:#2a1618; border:1px solid #5a2a2f; border-radius:10px; padding:12px 14px;
  display:flex; flex-direction:column; gap:6px; font-size:13.5px; color:#ffd0d0; line-height:1.55; }
.qmd-err b { color:#ffb4b4; }
.qmd-retry { align-self:flex-start; font:inherit; font-size:12.5px; cursor:pointer; margin-top:4px;
  background:#3a1f22; color:#ffd0d0; border:1px solid #6b3238; border-radius:8px; padding:6px 12px; }
.qmd-note { color:#f0d9a6; background:#1d1a12; border:1px solid #4a4021; border-radius:9px;
  padding:9px 12px; font-size:12.5px; line-height:1.55; margin:0; }
.qmd-picks { display:grid; grid-template-columns:1fr; gap:10px; }
.qmd-pick { display:flex; flex-direction:column; gap:5px; font-size:12px; color:#8b93a5; }
.qmd-pick select { background:#0b0e14; color:#e9edf5; border:1px solid #2c3342; border-radius:9px;
  padding:9px 11px; font:inherit; font-size:13.5px; width:100%; }
.qmd-pick select:disabled { opacity:.55; }
.qmd-spk { display:flex; gap:8px; }
.qmd-spk select { flex:1 1 auto; min-width:0; }
.qmd-test { font:inherit; font-size:12.5px; cursor:pointer; background:#151a23; color:#9aa3b4;
  border:1px solid #2c3342; border-radius:9px; padding:0 14px; }
.qmd-test:hover { color:#cfd6e4; }
.qmd-join { width:100%; margin-top:2px; }
@media (min-width: 620px) { .qmd-picks { grid-template-columns:1fr 1fr; } }
`;
