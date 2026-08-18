"use client";

// The watchdog. This is the fix for "I could hear them, they could not hear me."
//
// WHAT WENT WRONG, mechanically:
// A Bluetooth headset on Windows is two devices. A2DP sounds good and has no
// microphone; HFP has a microphone and sounds like a phone call. Windows
// switches between them when an app opens the mic — and when it switches, or
// the headset naps for a second, or another program grabs it, the
// MediaStreamTrack we are publishing ENDS.
//
// WebRTC does not care. The publication stays up. Opus keeps encoding an empty
// signal at 64kbps. Every other person in the room still sees you un-muted,
// with no warning, and you keep talking. Receiving is untouched, so you can
// still hear everyone — which is exactly the asymmetry that makes this so
// confusing to the person it happens to. LiveKit's own docs mention the
// profile transition; nothing in the app was listening for its consequences.
//
// THE RULE THIS COMPONENT EXISTS TO ENFORCE:
// measure the track that is ACTUALLY BEING PUBLISHED. It would be much easier
// to open a fresh getUserMedia and read a level off that — and it would be
// worse than useless, because a fresh capture succeeds while the published
// track is dead, and the app would cheerfully report a working microphone to
// somebody nobody can hear.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Track, RoomEvent, TrackEvent, ConnectionQuality } from "livekit-client";
import {
  micVerdict, levelFrom, bars, deviceLabel, describeMediaError, isBluetooth,
  retryDelay, shouldKeepTrying, connectionAdvice, speakerPickerWorks, speakerNote,
  audioConstraints, type Device, type Verdict,
} from "@/lib/media";

const SAVED = { mic: "qm.mic", cam: "qm.cam", spk: "qm.spk", blur: "qm.blur" };
const save = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch {} };
const load = (k: string) => { try { return window.localStorage.getItem(k) || ""; } catch { return ""; } };

export default function MediaGuard() {
  const room = useRoomContext();
  const { localParticipant, microphoneTrack } = useLocalParticipant();

  const [level, setLevel] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>({ level: "ok", title: "", detail: "", action: "none" });
  const [devices, setDevices] = useState<{ mic: Device[]; cam: Device[]; spk: Device[] }>({ mic: [], cam: [], spk: [] });
  const [open, setOpen] = useState(false);
  const [mediaErr, setMediaErr] = useState("");
  const [quality, setQuality] = useState("");
  const [blurOn, setBlurOn] = useState(false);
  const [blurNote, setBlurNote] = useState("");
  const [blurBusy, setBlurBusy] = useState(false);
  const [dismissed, setDismissed] = useState(0);

  const attempts = useRef(0);
  const lastSound = useRef(Date.now());
  const peak = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const wired = useRef<MediaStreamTrack | null>(null);
  const recovering = useRef(false);

  const pub = microphoneTrack;
  const micTrack: any = pub?.track;
  const mst: MediaStreamTrack | undefined = micTrack?.mediaStreamTrack;
  const micLabel = mst?.label || "";

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mic: all.filter((d) => d.kind === "audioinput") as Device[],
        cam: all.filter((d) => d.kind === "videoinput") as Device[],
        spk: all.filter((d) => d.kind === "audiooutput") as Device[],
      });
    } catch { /* the meeting is more important than the list */ }
  }, []);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  // ── bring a dead microphone back ────────────────────────────────────────
  const recover = useCallback(async () => {
    if (recovering.current || !room) return;
    recovering.current = true;
    const n = attempts.current;
    try {
      const wanted = load(SAVED.mic);
      // Turning it off and on again is not a joke here: it forces LiveKit to
      // drop the dead MediaStreamTrack and ask the OS for a live one. Without
      // it, the publication keeps its corpse and everyone keeps hearing
      // nothing.
      await localParticipant.setMicrophoneEnabled(false);
      await new Promise((r) => setTimeout(r, 120));
      await localParticipant.setMicrophoneEnabled(true, audioConstraints(wanted) as any);
      lastSound.current = Date.now();
      peak.current = 0;
      attempts.current = 0;
    } catch (e) {
      attempts.current = n + 1;
      setMediaErr(describeMediaError(e, "audioinput").what);
      const wait = retryDelay(attempts.current);
      if (shouldKeepTrying(attempts.current)) setTimeout(() => { recovering.current = false; recover(); }, wait);
    } finally {
      setTimeout(() => { recovering.current = false; }, 300);
    }
  }, [room, localParticipant]);

  // ── measure the published track, continuously ───────────────────────────
  useEffect(() => {
    if (!mst) return;
    if (wired.current === mst) return;
    wired.current = mst;
    lastSound.current = Date.now();
    peak.current = 0;
    attempts.current = 0;

    let dead = false;
    let analyser: AnalyserNode | null = null;
    let buf: Uint8Array | null = null;
    try {
      const ac = ctx.current || new AudioContext();
      ctx.current = ac;
      if (ac.state === "suspended") ac.resume().catch(() => {});
      const src = ac.createMediaStreamSource(new MediaStream([mst]));
      analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      buf = new Uint8Array(analyser.fftSize);
    } catch { /* without a meter we still have the track events below */ }

    const tick = () => {
      if (dead) return;
      let l = 0;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        l = levelFrom(buf);
        setLevel(l);
        if (l > 0.015) { lastSound.current = Date.now(); peak.current = l; }
        else peak.current = Math.max(0, peak.current * 0.97);
      }
      const v = micVerdict({
        mutedByUser: Boolean(pub?.isMuted),
        // readyState 'ended' is the device going away. `muted` on a
        // MediaStreamTrack is NOT the user's mute button — it means the source
        // stopped producing, which is precisely what a Bluetooth profile
        // switch does.
        ended: mst.readyState === "ended",
        mutedBySystem: mst.muted === true,
        quietMs: Date.now() - lastSound.current,
        peak: peak.current,
        publishing: Boolean(pub && micTrack),
        attempts: attempts.current,
        label: micLabel,
      });
      setVerdict(v);
      if (v.action === "recover" && !recovering.current) recover();
      raf.current = window.setTimeout(tick, 400) as unknown as number;
    };
    tick();

    const onEnded = () => { attempts.current = 0; recover(); };
    mst.addEventListener("ended", onEnded);
    micTrack?.on?.(TrackEvent.Ended, onEnded);

    return () => {
      dead = true;
      if (raf.current) clearTimeout(raf.current);
      mst.removeEventListener("ended", onEnded);
      micTrack?.off?.(TrackEvent.Ended, onEnded);
      wired.current = null;
    };
  }, [mst, pub, micTrack, micLabel, recover]);

  // ── the room's own alarms, which were being thrown away ────────────────
  useEffect(() => {
    if (!room) return;
    const onFail = (e: any) => setMediaErr(describeMediaError(e?.error || e, "audioinput").what);
    const onDevices = () => { refreshDevices(); };
    const onQuality = (q: ConnectionQuality, p: any) => {
      if (p?.identity && p.identity !== localParticipant?.identity) return;
      setQuality(connectionAdvice(String(q)));
    };
    room.on(RoomEvent.MediaDevicesError, onFail);
    room.on(RoomEvent.MediaDevicesChanged, onDevices);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onFail);
      room.off(RoomEvent.MediaDevicesChanged, onDevices);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
    };
  }, [room, localParticipant, refreshDevices]);

  async function switchTo(kind: "audioinput" | "videoinput" | "audiooutput", id: string) {
    save(kind === "audioinput" ? SAVED.mic : kind === "videoinput" ? SAVED.cam : SAVED.spk, id);
    try {
      await room.switchActiveDevice(kind, id);
      setMediaErr("");
      attempts.current = 0;
      lastSound.current = Date.now();
    } catch (e) {
      setMediaErr(describeMediaError(e, kind).what);
    }
  }

  // ── background blur ────────────────────────────────────────────────────
  async function toggleBlur() {
    if (blurBusy) return;
    setBlurBusy(true);
    setBlurNote("");
    try {
      const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
      const camTrack: any = camPub?.track;
      if (!camTrack) {
        setBlurNote("Turn your camera on first — there's nothing to blur yet.");
        setBlurBusy(false);
        return;
      }
      const mod = await import("@livekit/track-processors");
      // A control that cannot work must say so rather than doing nothing.
      const Supported = (mod as any).BackgroundTransformer?.isSupported;
      if (Supported === false) {
        setBlurNote("This browser can't run background blur. Chrome, Edge and Safari 17+ can; Firefox can't yet.");
        setBlurBusy(false);
        return;
      }
      if (blurOn) {
        await camTrack.stopProcessor();
        setBlurOn(false);
        save(SAVED.blur, "");
      } else {
        await camTrack.setProcessor(mod.BackgroundBlur(12));
        setBlurOn(true);
        save(SAVED.blur, "1");
      }
    } catch (e: any) {
      // Blur runs a segmentation model on every frame. On an older laptop it
      // can genuinely fail, and saying which is far better than a toggle that
      // flips back on its own.
      setBlurNote(
        `Background blur couldn't start on this machine (${String(e?.message || e).slice(0, 90)}). It needs a fairly recent browser and a bit of graphics power — everything else about the meeting is unaffected.`
      );
      setBlurOn(false);
    }
    setBlurBusy(false);
  }

  const show = verdict.level !== "ok" && dismissed < Date.now() - 30000;
  const spkWorks = speakerPickerWorks();

  return (
    <>
      {/* The banner. It only ever appears when something is actually wrong,
          and it never appears for somebody who muted themselves. */}
      {show ? (
        <div className={`qmg-alert${verdict.level === "dead" ? " qmg-dead" : ""}`} role="status">
          <div className="qmg-atext">
            <b>{verdict.title}</b>
            <span>{verdict.detail}</span>
          </div>
          <div className="qmg-arow">
            {verdict.action === "pick" ? (
              <button className="qmg-abtn" onClick={() => setOpen(true)}>Choose a microphone</button>
            ) : null}
            <button className="qmg-abtn" onClick={() => { attempts.current = 0; recover(); }}>Reconnect it</button>
            <button className="qmg-ax" onClick={() => setDismissed(Date.now())} aria-label="Dismiss">×</button>
          </div>
        </div>
      ) : null}

      {quality ? <div className="qmg-alert qmg-warn" role="status"><div className="qmg-atext"><span>{quality}</span></div></div> : null}
      {mediaErr ? <div className="qmg-alert qmg-dead" role="status"><div className="qmg-atext"><span>{mediaErr}</span></div></div> : null}

      <button
        className={`qmr-ghost qmg-btn${verdict.level === "dead" ? " qmg-btnbad" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Microphone, camera, speaker and blur"
      >
        <span className="qmg-mini" aria-hidden>
          {bars(level, 5).map((lit, i) => (
            <span key={i} className={`qmg-mbar${lit ? " qmg-mlit" : ""}`} />
          ))}
        </span>
        Devices
      </button>

      {open ? (
        <div className="qmg-panel">
          <div className="qmg-head">
            <b>Your devices</b>
            <button className="qmg-ax" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          <div className="qmg-meterrow">
            <div className="qmg-meter" aria-hidden>
              {bars(level, 14).map((lit, i) => <span key={i} className={`qmg-bar${lit ? " qmg-lit" : ""}`} />)}
            </div>
            <span className="qmg-mlabel">
              {pub?.isMuted ? "You're muted" : level > 0.02 ? "Sending your voice" : "Nothing coming in"}
            </span>
          </div>

          <label className="qmg-pick">
            <span>Microphone</span>
            <select value={load(SAVED.mic)} onChange={(e) => switchTo("audioinput", e.target.value)}>
              {devices.mic.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "audioinput")}</option>
              ))}
            </select>
          </label>
          <label className="qmg-pick">
            <span>Camera</span>
            <select value={load(SAVED.cam)} onChange={(e) => switchTo("videoinput", e.target.value)}>
              {devices.cam.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "videoinput")}</option>
              ))}
            </select>
          </label>
          <label className="qmg-pick">
            <span>Speaker</span>
            <select value={load(SAVED.spk)} disabled={!spkWorks} onChange={(e) => switchTo("audiooutput", e.target.value)}>
              {devices.spk.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{deviceLabel(d, i, "audiooutput")}</option>
              ))}
            </select>
          </label>
          {!spkWorks ? <p className="qmg-note">{speakerNote(false)}</p> : null}
          {isBluetooth(micLabel) ? (
            <p className="qmg-note">
              {deviceLabel({ label: micLabel, deviceId: "", kind: "audioinput" })} is Bluetooth. If people
              stop hearing you, that is nearly always the headset switching audio
              profiles — this page watches for it and reconnects on its own.
            </p>
          ) : null}

          <button className="qmg-blur" onClick={toggleBlur} disabled={blurBusy}>
            {blurBusy ? "Working…" : blurOn ? "Turn off background blur" : "Blur my background"}
          </button>
          {blurNote ? <p className="qmg-note">{blurNote}</p> : null}
        </div>
      ) : null}
    </>
  );
}

export const GUARD_CSS = `
.qmg-alert { position:absolute; left:50%; transform:translateX(-50%); top:64px; z-index:40;
  max-width:min(560px, calc(100% - 24px)); display:flex; gap:12px; align-items:flex-start;
  background:#1d1a12; border:1px solid #4a4021; color:#f0d9a6; border-radius:12px;
  padding:12px 14px; font-size:13.5px; line-height:1.55; box-shadow:0 12px 32px rgba(0,0,0,.5); }
.qmg-dead { background:#2a1618; border-color:#5a2a2f; color:#ffd0d0; }
.qmg-warn { background:#1d1a12; border-color:#4a4021; color:#f0d9a6; }
.qmg-atext { display:flex; flex-direction:column; gap:3px; min-width:0; }
.qmg-atext b { font-size:14px; }
.qmg-arow { display:flex; gap:6px; align-items:center; flex:0 0 auto; }
.qmg-abtn { font:inherit; font-size:12.5px; cursor:pointer; white-space:nowrap;
  background:rgba(255,255,255,.07); color:inherit; border:1px solid rgba(255,255,255,.2);
  border-radius:8px; padding:6px 10px; }
.qmg-abtn:hover { background:rgba(255,255,255,.14); }
.qmg-ax { font:inherit; font-size:17px; line-height:1; cursor:pointer; background:none;
  border:0; color:inherit; opacity:.6; padding:2px 4px; }
.qmg-ax:hover { opacity:1; }
.qmg-btn { display:inline-flex; align-items:center; gap:7px; }
.qmg-btnbad { border-color:#5a2a2f !important; color:#ffb4b4 !important; }
.qmg-mini { display:inline-flex; gap:2px; height:11px; align-items:flex-end; }
.qmg-mbar { width:2.5px; border-radius:1px; background:#3b4356; height:100%; }
.qmg-mlit { background:#00a99d; }
.qmg-panel { position:absolute; right:12px; top:60px; z-index:41; width:min(320px, calc(100vw - 24px));
  background:#10131a; border:1px solid #262b36; border-radius:13px; padding:14px;
  display:flex; flex-direction:column; gap:11px; box-shadow:0 18px 44px rgba(0,0,0,.6); }
.qmg-head { display:flex; justify-content:space-between; align-items:center; color:#e9edf5; font-size:14px; }
.qmg-meterrow { display:flex; flex-direction:column; gap:5px; }
.qmg-meter { display:flex; gap:3px; height:14px; }
.qmg-bar { flex:1 1 0; border-radius:2px; background:#1c212c; }
.qmg-lit { background:#00a99d; }
.qmg-mlabel { font-size:12px; color:#8b93a5; }
.qmg-pick { display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:#8b93a5; }
.qmg-pick select { background:#0b0e14; color:#e9edf5; border:1px solid #2c3342; border-radius:8px;
  padding:8px 10px; font:inherit; font-size:13px; width:100%; }
.qmg-pick select:disabled { opacity:.55; }
.qmg-note { color:#8b93a5; font-size:11.5px; line-height:1.5; margin:0; }
.qmg-blur { font:inherit; font-size:13px; cursor:pointer; background:#151a23; color:#cfd6e4;
  border:1px solid #2c3342; border-radius:9px; padding:9px 12px; }
.qmg-blur:hover { border-color:#3b4356; }
.qmg-blur:disabled { opacity:.6; cursor:default; }
`;
