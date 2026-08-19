"use client";

// The watchdog. This is the fix for "I could hear them, they could not hear
// me" — and, since 2026-08-19, for "his camera was on and his tile was black".
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
// with no warning, and you keep talking.
//
// CAMERAS FAIL THE SAME WAY, plus one of their own (FIELD 2026-08-19, a live
// three-person meeting, one Windows participant, black tile all call):
//   - another app (Teams/Zoom in the tray) holds the camera → it never starts;
//   - the track ends mid-call (USB renumber, driver hiccup) → black tile;
//   - Windows' camera privacy switch mutes the track while everything says ON;
//   - a closed privacy SHUTTER sends literally black frames — no API reports
//     this, so this file samples actual pixels off the published track.
//
// THE RULE THIS COMPONENT EXISTS TO ENFORCE:
// measure the track that is ACTUALLY BEING PUBLISHED. A fresh getUserMedia
// succeeding while the published track is dead is precisely how an app
// cheerfully reports a working device to somebody nobody can see or hear.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Track, RoomEvent, TrackEvent, ConnectionQuality } from "livekit-client";
import {
  micVerdict, levelFrom, bars, deviceLabel, describeMediaError, isBluetooth,
  retryDelay, shouldKeepTrying, connectionAdvice, speakerPickerWorks, speakerNote,
  audioConstraints, type Device, type Verdict,
} from "@/lib/media";
import {
  camVerdict, lumaFrom, blameKind, joinErrorText, CAM_BLACK,
  EFFECTS, restoreEffect, effectSupport, processorFor, type Effect,
  camRetryDelay, camShouldKeepTrying, type CamVerdict,
} from "@/lib/camera";

const SAVED = { mic: "qm.mic", cam: "qm.cam", spk: "qm.spk", blur: "qm.blur", effect: "qm.effect" };
const save = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch {} };
const load = (k: string) => { try { return window.localStorage.getItem(k) || ""; } catch { return ""; } };

export default function MediaGuard({ camWanted = true, micWanted = true }: {
  /** did this person JOIN wanting these on? Publication state can't answer
   *  this — a camera that failed to start and a camera turned off look the
   *  same from the publication's side, and only one of them is a fault. */
  camWanted?: boolean;
  micWanted?: boolean;
}) {
  const room = useRoomContext();
  const { localParticipant, microphoneTrack, cameraTrack } = useLocalParticipant();

  const [level, setLevel] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>({ level: "ok", title: "", detail: "", action: "none" });
  const [camV, setCamV] = useState<CamVerdict>({ level: "ok", title: "", detail: "", action: "none" });
  const [devices, setDevices] = useState<{ mic: Device[]; cam: Device[]; spk: Device[] }>({ mic: [], cam: [], spk: [] });
  const [open, setOpen] = useState(false);
  const [mediaErr, setMediaErr] = useState("");
  const [quality, setQuality] = useState("");
  const [fx, setFx] = useState("none");
  const [fxNote, setFxNote] = useState("");
  const [fxBusy, setFxBusy] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const [camDismissed, setCamDismissed] = useState(0);

  const attempts = useRef(0);
  const lastSound = useRef(Date.now());
  const peak = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const wired = useRef<MediaStreamTrack | null>(null);
  const recovering = useRef(false);

  const camAttempts = useRef(0);
  const camRecovering = useRef(false);
  const camDarkSince = useRef(0);
  const everCam = useRef(false);
  const effectRef = useRef<Effect>(EFFECTS[0]);
  const restored = useRef(false);
  const sampleVid = useRef<HTMLVideoElement | null>(null);
  const sampleCvs = useRef<HTMLCanvasElement | null>(null);

  const pub = microphoneTrack;
  const micTrack: any = pub?.track;
  const mst: MediaStreamTrack | undefined = micTrack?.mediaStreamTrack;
  const micLabel = mst?.label || "";
  // The banner speaks the device's NAME, not its USB id — the same cleanup
  // the pickers use, so "Logitech BRIO (046d:085e)" never reaches a person.
  const micSay = micLabel ? deviceLabel({ label: micLabel, deviceId: "", kind: "audioinput" }) : "";

  const camPub = cameraTrack;
  const camLkTrack: any = camPub?.track;
  const cmst: MediaStreamTrack | undefined = camLkTrack?.mediaStreamTrack;
  const camLabel = cmst?.label || "";
  const camSay = camLabel ? deviceLabel({ label: camLabel, deviceId: "", kind: "videoinput" }) : "";
  if (cmst) everCam.current = true;

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

  // ── bring a dead camera back — the same medicine, other organ ───────────
  const recoverCam = useCallback(async () => {
    if (camRecovering.current || !room) return;
    camRecovering.current = true;
    const n = camAttempts.current;
    try {
      const wanted = load(SAVED.cam);
      await localParticipant.setCameraEnabled(false);
      await new Promise((r) => setTimeout(r, 150));
      // `ideal`, never `exact`: if the remembered camera vanished, take the
      // next one and stay visible rather than throwing OverconstrainedError.
      await localParticipant.setCameraEnabled(
        true,
        wanted && wanted !== "default" ? ({ deviceId: { ideal: wanted } } as any) : undefined
      );
      camDarkSince.current = 0;
      camAttempts.current = 0;
    } catch (e) {
      camAttempts.current = n + 1;
      setMediaErr(describeMediaError(e, "videoinput").what);
      const wait = camRetryDelay(camAttempts.current);
      if (camShouldKeepTrying(camAttempts.current)) {
        setTimeout(() => { camRecovering.current = false; recoverCam(); }, wait);
      }
    } finally {
      setTimeout(() => { camRecovering.current = false; }, 400);
    }
  }, [room, localParticipant]);

  // ── measure the published mic track, continuously ───────────────────────
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
        label: micSay,
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
  }, [mst, pub, micTrack, micSay, recover]);

  // ── apply, remove, restore background effects ──────────────────────────
  const applyEffect = useCallback(async (effect: Effect, silent = false) => {
    if (fxBusy) return;
    setFxBusy(true);
    if (!silent) setFxNote("");
    const track: any = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    try {
      if (!track) {
        if (!silent) setFxNote("Turn your camera on first — effects apply to a live picture.");
        return;
      }
      const p = processorFor(effect);
      if (p.kind === "none") {
        if (track.processor) await track.stopProcessor();
        setFx("none"); effectRef.current = EFFECTS[0];
        save(SAVED.effect, ""); save(SAVED.blur, "");
        return;
      }
      const sup = effectSupport({
        trackGenerator: typeof (globalThis as any).MediaStreamTrackGenerator !== "undefined",
        trackProcessor: typeof (globalThis as any).MediaStreamTrackProcessor !== "undefined",
        offscreenCanvas: typeof OffscreenCanvas !== "undefined",
      });
      if (!sup.ok) {
        if (!silent) setFxNote(sup.why);
        return;
      }
      const mod = await import("@livekit/track-processors");
      const proc = p.kind === "blur" ? mod.BackgroundBlur(p.blurRadius) : mod.VirtualBackground(p.imagePath);
      // setProcessor replaces any active one; the segmentation model loads on
      // first use and can take a couple of seconds on a modest machine.
      await track.setProcessor(proc);
      setFx(effect.id); effectRef.current = effect;
      save(SAVED.effect, effect.id); save(SAVED.blur, "");
    } catch (e: any) {
      // THE RULE: an effect that fails degrades to PLAIN VIDEO, never to no
      // video. Being seen matters more than the nicer wall.
      try { if (track?.processor) await track.stopProcessor(); } catch { /* raw video is already flowing */ }
      setFx("none"); effectRef.current = EFFECTS[0]; save(SAVED.effect, "");
      // The reason only appears when there IS one a person could read —
      // "[object Event]" is not a reason, it is debris.
      const why = String(e?.message || "").trim();
      setFxNote(
        `That effect couldn't start on this machine${why && !/^\[object /.test(why) ? ` (${why.slice(0, 80)})` : ""}. ` +
        `It needs a recent Chrome or Edge and a moment of network to fetch its model. Your plain video is still being sent — everything else about the meeting is unaffected.`
      );
    } finally {
      setFxBusy(false);
    }
  }, [fxBusy, localParticipant]);

  // Remember-and-restore: the effect somebody chose last meeting comes back
  // on its own — qm.blur used to be saved and then never read again.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const wantedFx = restoreEffect(load(SAVED.effect), load(SAVED.blur));
    if (wantedFx.kind !== "none") { effectRef.current = wantedFx; setFx(wantedFx.id); }
  }, []);

  // ── watch the published camera track, continuously ─────────────────────
  useEffect(() => {
    camAttempts.current = 0;
    camDarkSince.current = 0;

    // Re-apply the chosen effect when the camera track is REPLACED — recovery
    // and "choose a camera" hand LiveKit a fresh track, and a fresh track has
    // no processor on it. Without this, every reconnect silently strips the
    // background somebody chose.
    if (cmst && camLkTrack && effectRef.current.kind !== "none" && !camLkTrack.processor) {
      applyEffect(effectRef.current, true);
    }

    // The pixel sampler: a tiny offscreen <video> playing the PUBLISHED
    // track, drawn to a 32×18 canvas. This is the only way to know the
    // difference between "camera running" and "camera running with the
    // privacy shutter closed" — no API reports a covered lens.
    if (cmst) {
      if (!sampleVid.current) {
        const v = document.createElement("video");
        v.muted = true; (v as any).playsInline = true; v.autoplay = true;
        sampleVid.current = v;
      }
      if (!sampleCvs.current) {
        const c = document.createElement("canvas");
        c.width = 32; c.height = 18;
        sampleCvs.current = c;
      }
      try {
        sampleVid.current.srcObject = new MediaStream([cmst]);
        sampleVid.current.play().catch(() => {});
      } catch { /* verdicts still work from track events */ }
    }

    const readLuma = (): number | null => {
      const v = sampleVid.current, c = sampleCvs.current;
      if (!cmst || !v || !c || v.readyState < 2) return null;
      try {
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(v, 0, 0, c.width, c.height);
        return lumaFrom(g.getImageData(0, 0, c.width, c.height).data);
      } catch { return null; }
    };

    const tick = () => {
      const luma = readLuma();
      const now = Date.now();
      if (luma !== null && luma <= CAM_BLACK) {
        if (!camDarkSince.current) camDarkSince.current = now;
      } else if (luma !== null) {
        camDarkSince.current = 0;
      }
      const wanted = camWanted || everCam.current;
      const v = camVerdict({
        offByUser: !wanted || camPub?.isMuted === true,
        publishing: Boolean(camPub && camLkTrack),
        ended: cmst?.readyState === "ended",
        mutedBySystem: cmst?.muted === true,
        luma,
        darkMs: camDarkSince.current ? now - camDarkSince.current : 0,
        attempts: camAttempts.current,
        label: camSay,
      });
      setCamV(v);
      if (v.action === "recover" && !camRecovering.current) recoverCam();
    };
    tick();
    const iv = window.setInterval(tick, 2000);

    const onEnded = () => { camAttempts.current = 0; recoverCam(); };
    cmst?.addEventListener("ended", onEnded);
    camLkTrack?.on?.(TrackEvent.Ended, onEnded);

    return () => {
      window.clearInterval(iv);
      cmst?.removeEventListener("ended", onEnded);
      camLkTrack?.off?.(TrackEvent.Ended, onEnded);
    };
  }, [cmst, camPub, camLkTrack, camSay, camWanted, recoverCam, applyEffect]);

  // ── the room's own alarms, which were being thrown away ────────────────
  useEffect(() => {
    if (!room) return;
    const onFail = (e: any) => {
      const err = e?.error || e;
      // Blame the device that is actually missing — a camera failure
      // described as a microphone problem sends the person debugging the
      // wrong device. When both or neither are missing, say so neutrally.
      const kind = blameKind({
        wantCam: camWanted || everCam.current,
        hasCam: Boolean(localParticipant?.getTrackPublication(Track.Source.Camera)?.track),
        wantMic: micWanted,
        hasMic: Boolean(localParticipant?.getTrackPublication(Track.Source.Microphone)?.track),
      });
      setMediaErr(kind ? describeMediaError(err, kind).what : joinErrorText(err?.name, err?.message));
    };
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
  }, [room, localParticipant, refreshDevices, camWanted, micWanted]);

  async function switchTo(kind: "audioinput" | "videoinput" | "audiooutput", id: string) {
    save(kind === "audioinput" ? SAVED.mic : kind === "videoinput" ? SAVED.cam : SAVED.spk, id);
    try {
      await room.switchActiveDevice(kind, id);
      setMediaErr("");
      attempts.current = 0;
      camAttempts.current = 0;
      camDarkSince.current = 0;
      lastSound.current = Date.now();
    } catch (e) {
      setMediaErr(describeMediaError(e, kind).what);
    }
  }

  const show = verdict.level !== "ok" && dismissed < Date.now() - 30000;
  const showCam = camV.level !== "ok" && camDismissed < Date.now() - 30000;
  const spkWorks = speakerPickerWorks();

  return (
    <>
      <div className="qmg-stack">
        {/* The banners. They only ever appear when something is actually
            wrong, and never for somebody who muted themselves or turned
            their own camera off. */}
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

        {showCam ? (
          <div className={`qmg-alert${camV.level === "dead" ? " qmg-dead" : ""}`} role="status">
            <div className="qmg-atext">
              <b>{camV.title}</b>
              <span>{camV.detail}</span>
            </div>
            <div className="qmg-arow">
              {camV.action === "pick" ? (
                <button className="qmg-abtn" onClick={() => setOpen(true)}>Choose a camera</button>
              ) : null}
              <button className="qmg-abtn" onClick={() => { camAttempts.current = 0; recoverCam(); }}>Reconnect it</button>
              <button className="qmg-ax" onClick={() => setCamDismissed(Date.now())} aria-label="Dismiss">×</button>
            </div>
          </div>
        ) : null}

        {quality ? <div className="qmg-alert qmg-warn" role="status"><div className="qmg-atext"><span>{quality}</span></div></div> : null}
        {mediaErr ? <div className="qmg-alert qmg-dead" role="status"><div className="qmg-atext"><span>{mediaErr}</span></div></div> : null}
      </div>

      <button
        className={`qmr-ghost qmg-btn${verdict.level === "dead" || camV.level === "dead" ? " qmg-btnbad" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Microphone, camera, speaker, blur and backgrounds"
      >
        <span className="qmg-mini" aria-hidden>
          {bars(level, 5).map((lit, i) => (
            <span key={i} className={`qmg-mbar${lit ? " qmg-mlit" : ""}`} />
          ))}
        </span>
        Devices & effects
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

          <div className="qmg-fxhead">Background</div>
          <div className="qmg-fx" role="group" aria-label="Background effect">
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                className={`qmg-swatch${fx === e.id ? " qmg-son" : ""}`}
                onClick={() => applyEffect(e)}
                disabled={fxBusy}
                title={e.label}
              >
                {e.kind === "image" ? (
                  <img src={e.src} alt="" />
                ) : (
                  <span className={e.kind === "blur" ? "qmg-swblur" : "qmg-swnone"}>
                    {e.kind === "blur" ? "◐" : "∅"}
                  </span>
                )}
                <i>{e.label}</i>
              </button>
            ))}
          </div>
          {fxBusy ? <p className="qmg-note">Starting the effect — the first time takes a moment while the model loads…</p> : null}
          {fxNote ? <p className="qmg-note">{fxNote}</p> : null}
        </div>
      ) : null}
    </>
  );
}

export const GUARD_CSS = `
.qmg-stack { position:absolute; left:50%; transform:translateX(-50%); top:64px; z-index:40;
  display:flex; flex-direction:column; gap:8px; width:min(560px, calc(100% - 24px));
  pointer-events:none; }
.qmg-stack > * { pointer-events:auto; }
.qmg-alert { display:flex; gap:12px; align-items:flex-start;
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
.qmg-panel { position:absolute; right:12px; top:60px; z-index:60; width:min(340px, calc(100vw - 24px));
  background:#10131a; border:1px solid #262b36; border-radius:13px; padding:14px;
  display:flex; flex-direction:column; gap:11px; box-shadow:0 18px 44px rgba(0,0,0,.6);
  max-height:calc(100vh - 84px); overflow-y:auto; }
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
.qmg-fxhead { font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:#8b93a5;
  border-top:1px solid #1c212c; padding-top:11px; }
.qmg-fx { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
.qmg-swatch { position:relative; cursor:pointer; border-radius:9px; overflow:hidden;
  border:1px solid #2c3342; background:#0b0e14; padding:0; aspect-ratio:16/10;
  display:flex; align-items:center; justify-content:center; }
.qmg-swatch img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.qmg-swatch i { position:absolute; left:0; right:0; bottom:0; font-style:normal;
  font-size:10px; letter-spacing:.06em; color:#cfd6e4; text-align:center; padding:2px 0 3px;
  background:linear-gradient(transparent, rgba(4,6,10,.85)); }
.qmg-swatch:hover { border-color:#3b4356; }
.qmg-swatch:disabled { opacity:.6; cursor:default; }
.qmg-son { border-color:#00a99d; box-shadow:0 0 0 1px #00a99d inset; }
.qmg-swnone, .qmg-swblur { font-size:17px; color:#8b93a5; }
.qmg-swblur { filter:blur(1px); }
`;
