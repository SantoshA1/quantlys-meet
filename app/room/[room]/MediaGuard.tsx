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
  camVerdict, lumaFrom, frameSignature, blameKind, joinErrorText, CAM_BLACK,
  EFFECTS, restoreEffect, effectSupport, processorFor, effectSrc, customReady, type Effect,
  shelfEffects, effectUsable,
  camRetryDelay, camShouldKeepTrying, type CamVerdict,
} from "@/lib/camera";
import { SLOTS, LOOPS } from "@/lib/backgrounds";
import {
  shouldApplyEffect, effectIdOfProcessor, BLUR_PX,
  DEFAULT_EFFECT_ID, effectCostNote, panelShouldClose,
} from "@/lib/effects";
import { acceptCustom, CUSTOM_ID } from "@/lib/backgrounds";
import {
  dueForRetry, isStuck, shouldReattach, withTimeout, RECOVER_TIMEOUT_MS,
} from "@/lib/recovery";
import { isConnected, trustDevices, REJOIN_GRACE_MS } from "@/lib/link";

const SAVED = { mic: "qm.mic", cam: "qm.cam", spk: "qm.spk", blur: "qm.blur", effect: "qm.effect", custom: "qm.bg.custom" };
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
  const [customBg, setCustomBg] = useState("");
  /** which room backdrops this deployment actually ships a PHOTOGRAPH for.
   *  Empty is the honest normal state until somebody adds the files — see
   *  shelfEffects in lib/camera.ts for why a drawn room is not offered. */
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  /** Living loops whose files exist in this deployment — same probe as photos. */
  const [loopIds, setLoopIds] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(0);
  const [camDismissed, setCamDismissed] = useState(0);

  // FIELD 2026-08-25. The room's own state, which NOTHING in here consulted
  // before — and that is the whole bug. When the connection drops, every local
  // publication goes with it; a device supervisor that does not know the
  // difference reads "no microphone publication" as "your microphone is
  // broken", says so, and then tries to publish into a room it is not in.
  const connectedSince = useRef(0);
  const roomState = useRef<string>("connecting");

  const attempts = useRef(0);
  const lastSound = useRef(Date.now());
  const peak = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const wired = useRef<MediaStreamTrack | null>(null);
  const recovering = useRef(false);
  // When the current recovery STARTED. `recovering` alone could never be
  // cleared if the call it guards never settled — which is exactly how one
  // hung setMicrophoneEnabled silenced somebody for a whole meeting.
  const recoverStart = useRef(0);
  const lastTry = useRef(0);
  /** silence-triggered restarts. Separate from `attempts` (failures) so a
   *  restart that succeeds and is STILL silent stops instead of blipping the
   *  microphone every twenty seconds for the rest of the call. */
  const quietFixes = useRef(0);
  const everMic = useRef(false);
  /** Is the level meter genuinely running? The analyser is built in a
   *  try/catch that used to swallow its own failure, after which the
   *  "quiet for N seconds" counter climbed for ever while the person talked —
   *  the 838-second screenshot. No reading is not a reading of zero. */
  const metering = useRef(false);
  /** Has this microphone ever produced a sound? Once it has, going quiet is
   *  somebody listening, which is what people do in meetings. */
  const everHeard = useRef(false);

  const photoIdsRef = useRef<string[]>([]);
  photoIdsRef.current = photoIds;
  const loopIdsRef = useRef<string[]>([]);
  loopIdsRef.current = loopIds;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const poorSince = useRef(0);
  const camAttempts = useRef(0);
  const camRecovering = useRef(false);
  const camRecoverStart = useRef(0);
  const camLastTry = useRef(0);
  const camDarkSince = useRef(0);
  const camSig = useRef("");
  const camFrozenSince = useRef(0);
  const freezeFixes = useRef(0);
  /** the picture froze twice: the background effect is the suspect, and after
   *  the second time we take it off and SAY we took it off, rather than
   *  restarting the camera into the same stall for the rest of the meeting. */
  const effectDisabled = useRef(false);
  const everCam = useRef(false);
  const effectRef = useRef<Effect>(EFFECTS[0]);
  // Mirrors of the two values the camera watcher needs but must not DEPEND
  // on: a dependency on either rebuilt the watcher mid-apply (the flashing).
  const fxBusyRef = useRef(false);
  const applyEffectRef = useRef<((e: Effect, silent?: boolean) => void) | null>(null);
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
  if (mst) everMic.current = true;

  // The supervisor below runs on a timer, not on renders, so it reads the
  // live objects through a ref rather than through a stale closure. A watcher
  // rebuilt on every render is a watcher that loses its own history.
  const live = useRef({ pub, micTrack, mst, micSay, camPub, camLkTrack, cmst, camSay });
  live.current = { pub, micTrack, mst, micSay, camPub, camLkTrack, cmst, camSay };

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

  /** May the app judge — or touch — a device right now?
   *
   *  No, unless the room is connected AND has been for longer than the
   *  republish window. Everything downstream of this asks it first: the two
   *  supervisors before they set a verdict, and the two recoveries before they
   *  call the device. The screenshot that produced this rule had four device
   *  banners on screen under the word "Disconnected". */
  const canJudgeDevices = useCallback(
    () => trustDevices(roomState.current, connectedSince.current ? Date.now() - connectedSince.current : 0),
    []
  );

  // ── bring a dead microphone back ────────────────────────────────────────
  //
  // FIELD 2026-08-24. The old version of this function turned the microphone
  // off and on again, which sounds like the right medicine and — for the
  // commonest Bluetooth failure of all — does NOTHING. livekit-client's
  // `setMicrophoneEnabled(false)` MUTES the publication; `(true)` unmutes it,
  // and unmute only re-acquires the device when the track has actually ENDED
  // (or when stopMicTrackOnMute is on, and we deliberately keep it off). A
  // headset that switched to A2DP hands us a track that is still `live` and
  // still `unmuted` and produces silence for ever — so off-and-on unmuted the
  // same corpse and everybody carried on hearing nothing.
  //
  // `restartTrack` is the one that actually asks the operating system for a
  // fresh microphone and swaps it into the sender. That is what a rejoin was
  // doing for them, and it is what this does now, without the rejoin.
  const recover = useCallback(async () => {
    if (recovering.current && !isStuck(recoverStart.current, Date.now())) return;
    if (!room) return;
    // You cannot publish into a room you are not connected to. Trying anyway
    // throws, renders as a device error, and races the reconnect that was
    // about to fix this by itself.
    if (!isConnected(roomState.current)) return;
    recovering.current = true;
    recoverStart.current = Date.now();
    lastTry.current = Date.now();
    const n = attempts.current;
    try {
      const wanted = load(SAVED.mic);
      const track: any = localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      let done: any = false;
      if (track?.restartTrack) {
        done = await withTimeout(track.restartTrack(audioConstraints(wanted) as any));
        // A muted publication stays muted through a restart, which would
        // leave somebody silent after a "fix" that reported success.
        if (done !== false && localParticipant.getTrackPublication(Track.Source.Microphone)?.isMuted === false) {
          /* already live */
        }
      }
      if (done === false) {
        // No track at all, or the restart timed out / was refused: fall back
        // to the full publish. Every call has a deadline — a supervisor that
        // can hang is not a supervisor.
        await withTimeout(localParticipant.setMicrophoneEnabled(false) as any, RECOVER_TIMEOUT_MS);
        await new Promise((r) => setTimeout(r, 120));
        const back = await withTimeout(
          localParticipant.setMicrophoneEnabled(true, audioConstraints(wanted) as any) as any,
          RECOVER_TIMEOUT_MS
        );
        if (back === false) throw new Error("The microphone did not come back in time.");
      }
      lastSound.current = Date.now();
      peak.current = 0;
      attempts.current = 0;
      setMediaErr("");
    } catch (e) {
      attempts.current = n + 1;
      setMediaErr(describeMediaError(e, "audioinput").what);
      // No self-scheduled retry any more. The supervisor below owns the
      // clock, and unlike this ladder it never runs out of patience —
      // giving up after three tries is what made rejoining the only cure.
    } finally {
      recovering.current = false;
      recoverStart.current = 0;
    }
  }, [room, localParticipant]);

  // ── bring a dead camera back — the same medicine, other organ ───────────
  //
  // `frozen` says the picture stopped moving rather than stopped arriving.
  // That one is nearly always the background-effect pipeline stalling on a
  // Windows machine, so the effect comes OFF first — restarting the camera
  // straight back into the same stalled processor is how a black tile becomes
  // a black tile again four seconds later.
  const recoverCam = useCallback(async (frozen = false) => {
    if (camRecovering.current && !isStuck(camRecoverStart.current, Date.now())) return;
    if (!room) return;
    if (!isConnected(roomState.current)) return;   // see recover(), same reason
    camRecovering.current = true;
    camRecoverStart.current = Date.now();
    camLastTry.current = Date.now();
    const n = camAttempts.current;
    try {
      const wanted = load(SAVED.cam);
      const track: any = localParticipant.getTrackPublication(Track.Source.Camera)?.track;

      if (frozen && track?.processor) {
        // The effect is the prime suspect and this file already has a rule
        // for suspects: being SEEN beats being seen in front of a nicer wall.
        // So it comes off for the rest of the meeting, on the FIRST freeze,
        // and the person is told — a silent degrade and a silent death look
        // identical from the other side of the call. Restarting the camera
        // back into the same stalled processor would just freeze it again in
        // twelve seconds, and the verdict for a second freeze is "pick a
        // camera", which never calls back in here.
        try { await withTimeout(track.stopProcessor()); } catch { /* raw video is what we want anyway */ }
        effectDisabled.current = true;
        effectRef.current = EFFECTS[0];
        setFx("none");
        save(SAVED.effect, "none");
        setFxNote(
          "Your background effect froze the picture on this computer, so it has been turned off for the " +
          "rest of this meeting. Your plain video is being sent — everyone can see you moving again."
        );
      }

      let done: any = false;
      if (track?.restartTrack) {
        done = await withTimeout(
          track.restartTrack(
            wanted && wanted !== "default" ? ({ deviceId: { ideal: wanted } } as any) : undefined
          )
        );
      }
      if (done === false) {
        await withTimeout(localParticipant.setCameraEnabled(false) as any, RECOVER_TIMEOUT_MS);
        await new Promise((r) => setTimeout(r, 150));
        // `ideal`, never `exact`: if the remembered camera vanished, take the
        // next one and stay visible rather than throwing OverconstrainedError.
        const back = await withTimeout(
          localParticipant.setCameraEnabled(
            true,
            wanted && wanted !== "default" ? ({ deviceId: { ideal: wanted } } as any) : undefined
          ) as any,
          RECOVER_TIMEOUT_MS
        );
        if (back === false) throw new Error("The camera did not come back in time.");
      }
      camDarkSince.current = 0;
      camFrozenSince.current = 0;
      camSig.current = "";
      camAttempts.current = 0;
      if (frozen) freezeFixes.current += 1;
      setMediaErr("");
    } catch (e) {
      camAttempts.current = n + 1;
      setMediaErr(describeMediaError(e, "videoinput").what);
      // The supervisor owns the clock — see recover() above for why this no
      // longer schedules its own last retry and then stops for ever.
    } finally {
      camRecovering.current = false;
      camRecoverStart.current = 0;
    }
  }, [room, localParticipant]);

  // ── the meter, which is the only part that needs a live track ──────────
  useEffect(() => {
    if (!mst) { setLevel(0); return; }
    if (wired.current === mst) return;
    wired.current = mst;
    lastSound.current = Date.now();
    peak.current = 0;
    attempts.current = 0;

    let dead = false;
    let analyser: AnalyserNode | null = null;
    let buf: Uint8Array | null = null;
    let ac: AudioContext | null = null;
    metering.current = false;
    everHeard.current = false;
    try {
      ac = ctx.current || new AudioContext();
      ctx.current = ac;
      if (ac.state === "suspended") ac.resume().catch(() => {});
      const src = ac.createMediaStreamSource(new MediaStream([mst]));
      analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      buf = new Uint8Array(analyser.fftSize);
      metering.current = true;
    } catch {
      // The supervisor is TOLD there is no meter, rather than being left to
      // read the resulting flat line as silence.
      metering.current = false;
    }

    const tick = () => {
      if (dead) return;
      // A suspended context measures nothing, and browsers suspend one for
      // reasons that have nothing to do with the microphone — a backgrounded
      // tab, a power event. Resuming it here rather than only at creation is
      // what turns a permanently dead meter back into a working one.
      if (ac && ac.state === "suspended") {
        metering.current = false;
        ac.resume().then(() => { metering.current = Boolean(analyser && buf); }).catch(() => {});
      }
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        const l = levelFrom(buf);
        setLevel(l);
        if (l > 0.015) {
          lastSound.current = Date.now();
          peak.current = l;
          // Proof this microphone works. From here on, quiet is listening.
          everHeard.current = true;
          // Real sound is the only proof a restart worked. Until it arrives,
          // the app has not earned another silence-triggered restart.
          quietFixes.current = 0;
        } else {
          peak.current = Math.max(0, peak.current * 0.97);
        }
      }
      raf.current = window.setTimeout(tick, 400) as unknown as number;
    };
    tick();

    const onEnded = () => { attempts.current = 0; lastTry.current = 0; recover(); };
    mst.addEventListener("ended", onEnded);
    micTrack?.on?.(TrackEvent.Ended, onEnded);

    return () => {
      dead = true;
      if (raf.current) clearTimeout(raf.current);
      mst.removeEventListener("ended", onEnded);
      micTrack?.off?.(TrackEvent.Ended, onEnded);
      wired.current = null;
    };
  }, [mst, micTrack, recover]);

  // ── the supervisor, which must run even when there is NO track ─────────
  //
  // FIELD 2026-08-24 — this is the one that made rejoining the only cure.
  // The verdict used to live inside the effect above, and that effect began
  // with `if (!mst) return`. So the single state the app could never notice
  // was the state of having no microphone at all: the moment a recovery
  // unpublished the track, or a Bluetooth headset took the device away
  // outright, the watcher unmounted itself and nothing ever looked again.
  // "No microphone is being sent" — the loudest verdict in lib/media.ts — was
  // unreachable code. People sat there un-muted and inaudible until they left
  // the meeting and came back, because coming back is what re-created the
  // watcher.
  //
  // It runs on its own clock now, for as long as somebody is in the room, and
  // it never runs out of patience: the fast ladder first because somebody is
  // mid-sentence, then every fifteen seconds for the rest of the meeting.
  useEffect(() => {
    if (!room) return;
    const tick = () => {
      const L = live.current;
      // THE GATE. While the room is not connected — or has only just come
      // back and LiveKit is still republishing — nothing this function could
      // say about a microphone would be true. The connection banner in
      // Conference.tsx is the one honest thing on screen in that state.
      if (!canJudgeDevices()) return;
      // Somebody who joined without a microphone is not broken, and must
      // never have one switched on for them.
      if (!micWanted && !everMic.current) return;

      const m = L.mst;
      const v = micVerdict({
        mutedByUser: Boolean(L.pub?.isMuted),
        // readyState 'ended' is the device going away. `muted` on a
        // MediaStreamTrack is NOT the user's mute button — it means the source
        // stopped producing, which is precisely what a Bluetooth profile
        // switch does.
        ended: m ? m.readyState === "ended" : false,
        mutedBySystem: m ? m.muted === true : false,
        quietMs: Date.now() - lastSound.current,
        peak: peak.current,
        publishing: Boolean(L.pub && L.micTrack && m),
        metering: metering.current,
        everHeard: everHeard.current,
        attempts: attempts.current,
        quietFixes: quietFixes.current,
        label: L.micSay,
      });
      setVerdict(v);

      // A `warn` is "we cannot hear anything" — worth one restart and then a
      // question. A `dead` is "nothing is leaving this machine" — worth
      // trying for ever, which is the difference between a blip and the rest
      // of the meeting. The banner can say "choose a microphone" while the
      // app quietly keeps trying; both of those are true at once.
      const wantsFix = v.action === "recover" || v.level === "dead";
      if (!wantsFix) return;
      if (!dueForRetry({
        wantOn: !L.pub?.isMuted,
        inFlight: recovering.current && !isStuck(recoverStart.current, Date.now()),
        attempts: attempts.current,
        sinceMs: Date.now() - lastTry.current,
        fast: retryDelay,
      })) return;

      // Count the silence-driven restarts separately, so one that succeeds
      // and is still silent hands over to the person instead of blipping the
      // microphone every twenty seconds until the meeting ends.
      if (v.level === "warn") quietFixes.current += 1;
      recover();
    };
    tick();
    const iv = window.setInterval(tick, 500);
    return () => window.clearInterval(iv);
  }, [room, micWanted, recover, canJudgeDevices]);

  // ── apply, remove, restore background effects ──────────────────────────
  const applyEffect = useCallback(async (effect: Effect, silent = false) => {
    // The REF, not the state: setFxBusy lands next render, so two applies
    // fired in one tick both saw `false` and both ran. That doubled every
    // setProcessor — and doubled the flash.
    if (fxBusyRef.current) return;
    fxBusyRef.current = true;
    setFxBusy(true);
    if (!silent) setFxNote("");
    const track: any = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    try {
      if (!track) {
        if (!silent) setFxNote("Turn your camera on first — effects apply to a live picture.");
        return;
      }
      const p = processorFor(effect, customBg, photoIdsRef.current.includes(effect.id));
      if (effect.custom && !customReady(effect, customBg)) {
        if (!silent) setFxNote("Add a picture to this slot first — the ＋ button below picks one from your computer.");
        return;
      }
      if (p.kind === "none") {
        if (track.processor) await track.stopProcessor();
        setFx("none"); effectRef.current = EFFECTS[0];
        save(SAVED.effect, "none"); save(SAVED.blur, "");
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
      const { quantlysBackground } = await import("@/lib/qbg");
      const proc = quantlysBackground(
        effect.id,
        p.kind === "blur"
          ? { kind: "blur", blurRadius: BLUR_PX }
          : p.kind === "chroma"
            ? { kind: "chroma", blurRadius: BLUR_PX }
            : p.kind === "video"
              ? { kind: "video", videoPath: p.videoPath }
              : { kind: "image", imagePath: p.imagePath },
      );
      // setProcessor replaces any active one AND swaps the published
      // MediaStreamTrack for a generated one. That swap is what used to
      // re-trigger the watcher below and re-apply the effect for ever —
      // one flash of raw camera per lap. The processor's NAME now carries
      // the effect id, so the watcher can ask what the live track is
      // already wearing instead of guessing from track identity.
      await track.setProcessor(proc);
      setFx(effect.id); effectRef.current = effect;
      save(SAVED.effect, effect.id); save(SAVED.blur, "");
    } catch (e: any) {
      // THE RULE: an effect that fails degrades to PLAIN VIDEO, never to no
      // video. Being seen matters more than the nicer wall.
      try { if (track?.processor) await track.stopProcessor(); } catch { /* raw video is already flowing */ }
      setFx("none"); effectRef.current = EFFECTS[0]; save(SAVED.effect, "none");
      // The reason only appears when there IS one a person could read —
      // "[object Event]" is not a reason, it is debris.
      const why = String(e?.message || "").trim();
      setFxNote(
        `That effect couldn't start on this machine${why && !/^\[object /.test(why) ? ` (${why.slice(0, 80)})` : ""}. ` +
        `It needs a recent Chrome or Edge and a moment of network to fetch its model. Your plain video is still being sent — everything else about the meeting is unaffected.`
      );
    } finally {
      fxBusyRef.current = false;
      setFxBusy(false);
    }
  }, [localParticipant, customBg]);

  // Keep the ref pointing at the newest closure without making anything
  // depend on its identity.
  useEffect(() => { applyEffectRef.current = applyEffect; }, [applyEffect]);

  // Remember-and-restore: the effect somebody chose last meeting comes back
  // on its own — qm.blur used to be saved and then never read again.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let alive = true;
    (async () => {
      const saved = load(SAVED.custom);
      if (saved.startsWith("data:image/")) setCustomBg(saved);

      // Which rooms are real here? One cheap HEAD each, cached forever after.
      // FIELD 2026-08-24: every backdrop on the shelf was a hand-drawn SVG,
      // because the photographs the slots were designed for were never
      // shipped — so everybody in every meeting sat in front of a cartoon.
      // The shelf is built from what actually exists now; drop office.jpg
      // into public/backgrounds/ and Office Cubicle comes back on its own.
      const found: string[] = [];
      await Promise.all(SLOTS.map(async (slot) => {
        try {
          const r = await fetch(slot.photo, { method: "HEAD", cache: "force-cache" });
          // A dev server that answers every path with index.html would offer
          // five backdrops made of HTML, so the content type is checked too.
          if (r.ok && /^image\//i.test(r.headers.get("content-type") || "image/")) found.push(slot.id);
        } catch { /* absent is the normal answer, not an error */ }
      }));
      const foundLoops: string[] = [];
      await Promise.all(LOOPS.map(async (slot) => {
        try {
          const r = await fetch(slot.loop, { method: "HEAD", cache: "force-cache" });
          const ct = r.headers.get("content-type") || "";
          if (r.ok && (/^video\//i.test(ct) || ct === "" || /octet-stream/i.test(ct))) foundLoops.push(slot.id);
        } catch { /* absent is fine */ }
      }));
      if (!alive) return;
      setPhotoIds(found);
      setLoopIds(foundLoops);

      // DEFAULT_EFFECT_ID (blur) is what somebody who has never chosen gets.
      // Missing key → default. Explicit "none" (or legacy "") → plain video.
      // A drawn room whose photograph this deployment never shipped falls
      // through restoreEffect to plain video rather than the cartoon.
      let savedFx: string | null = null;
      try { savedFx = window.localStorage.getItem(SAVED.effect); } catch { savedFx = null; }
      const wantedFx = restoreEffect(
        savedFx === null ? DEFAULT_EFFECT_ID : (savedFx || "none"),
        load(SAVED.blur),
        found,
        foundLoops,
      );
      if (wantedFx.kind !== "none") { effectRef.current = wantedFx; setFx(wantedFx.id); }
    })();
    return () => { alive = false; };
  }, []);

  // ── watch the published camera track, continuously ─────────────────────
  useEffect(() => {
    camAttempts.current = 0;
    camDarkSince.current = 0;

    // Re-apply the chosen effect when the camera track is REPLACED — recovery
    // and "choose a camera" hand LiveKit a fresh track, and a fresh track has
    // no processor on it. Without this, every reconnect silently strips the
    // background somebody chose.
    //
    // FIELD 2026-08-20 ("the blur keeps flashing"): the old test here was
    // `!camLkTrack.processor`, which is true for a beat DURING setProcessor —
    // and setProcessor swaps the track, which re-runs this effect, which
    // re-applies, for ever. Each lap published a frame of unblurred camera.
    // The question is not "has this track a processor" but "is this track
    // already wearing the effect I want", and the processor's name answers
    // it. shouldApplyEffect is pure and guarded, because a loop that only
    // reproduces on real hardware is a loop that ships.
    if (
      cmst && camLkTrack && !effectDisabled.current &&
      effectUsable(effectRef.current, photoIdsRef.current, loopIdsRef.current) &&
      shouldApplyEffect({
        wantedId: effectRef.current.id,
        liveId: effectIdOfProcessor(camLkTrack.processor?.name),
        hasTrack: true,
        busy: fxBusyRef.current,
      })
    ) {
      applyEffectRef.current?.(effectRef.current, true);
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

    // One read, two questions: how bright is the picture (a closed shutter),
    // and is it the SAME picture as last time (a stopped pipeline). A frozen
    // tile is the thing the room describes as "his video isn\'t live", and no
    // API anywhere reports it — only the pixels do.
    const readFrame = (): { luma: number; sig: string } | null => {
      const v = sampleVid.current, c = sampleCvs.current;
      if (!cmst || !v || !c || v.readyState < 2) return null;
      try {
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(v, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        return { luma: lumaFrom(px), sig: frameSignature(px) };
      } catch { return null; }
    };

    const tick = () => {
      if (!canJudgeDevices()) return;   // see the microphone supervisor above
      const frame = readFrame();
      const luma = frame ? frame.luma : null;
      const now = Date.now();
      if (luma !== null && luma <= CAM_BLACK) {
        if (!camDarkSince.current) camDarkSince.current = now;
      } else if (luma !== null) {
        camDarkSince.current = 0;
      }
      if (frame) {
        if (frame.sig && frame.sig === camSig.current) {
          if (!camFrozenSince.current) camFrozenSince.current = now;
        } else {
          camFrozenSince.current = 0;
          camSig.current = frame.sig;
        }
      }
      const wanted = camWanted || everCam.current;
      const v = camVerdict({
        offByUser: !wanted || camPub?.isMuted === true,
        publishing: Boolean(camPub && camLkTrack),
        ended: cmst?.readyState === "ended",
        mutedBySystem: cmst?.muted === true,
        luma,
        darkMs: camDarkSince.current ? now - camDarkSince.current : 0,
        frozenMs: camFrozenSince.current ? now - camFrozenSince.current : 0,
        attempts: camAttempts.current,
        freezeFixes: freezeFixes.current,
        label: camSay,
      });
      setCamV(v);

      // Same rule as the microphone: a `warn` earns one fix, a `dead` earns
      // an unlimited number of patient ones. The camera used to stop asking
      // after three failures in seven seconds, which on a Windows machine
      // that is still letting go of the device is barely an attempt at all.
      const wantsFix = v.action === "recover" || v.level === "dead";
      if (!wantsFix) return;
      if (!dueForRetry({
        wantOn: wanted && camPub?.isMuted !== true,
        inFlight: camRecovering.current && !isStuck(camRecoverStart.current, Date.now()),
        attempts: camAttempts.current,
        sinceMs: Date.now() - camLastTry.current,
        fast: camRetryDelay,
      })) return;
      // A `warn` while the picture has been identical for a while IS the
      // freeze case — and that one takes the background effect off first.
      recoverCam(v.level === "warn" && camFrozenSince.current > 0);
    };
    tick();
    const iv = window.setInterval(tick, 2000);

    const onEnded = () => { camAttempts.current = 0; camLastTry.current = 0; recoverCam(); };
    cmst?.addEventListener("ended", onEnded);
    camLkTrack?.on?.(TrackEvent.Ended, onEnded);

    return () => {
      window.clearInterval(iv);
      cmst?.removeEventListener("ended", onEnded);
      camLkTrack?.off?.(TrackEvent.Ended, onEnded);
    };
    // applyEffect is deliberately NOT a dependency: it changes identity every
    // time fxBusy flips, and fxBusy flips inside applyEffect — so listing it
    // rebuilt this watcher in the middle of its own work. The ref carries the
    // latest one without making the watcher re-run.
  }, [cmst, camPub, camLkTrack, camSay, camWanted, recoverCam, canJudgeDevices]);

  // ── the settings panel behaves like a panel ────────────────────────────
  // Escape and a click outside close it; choosing a backdrop does NOT, because
  // choosing a backdrop is a comparison and a panel that shuts on every pick
  // makes comparing impossible. The rule is in lib/effects.ts so all three
  // handlers share one answer instead of holding three opinions.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelShouldClose({ reason: "escape" })) setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(n) && !(n as HTMLElement)?.closest?.(".qmg-btn")) {
        if (panelShouldClose({ reason: "outside" })) setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  // How long the connection has been poor — an effect is the most expensive
  // thing in the room, and one bad reading must not nag somebody mid-sentence.
  useEffect(() => {
    const poor = /poor|lost|unstable|struggl/i.test(quality || "");
    if (poor && !poorSince.current) poorSince.current = Date.now();
    if (!poor) poorSince.current = 0;
  }, [quality]);

  // ── the room's own alarms, which were being thrown away ────────────────
  useEffect(() => {
    if (!room) return;
    const onFail = (e: any) => {
      const err = e?.error || e;
      // Same rule: a failure that arrives while the room is down is a
      // connection failure wearing a device error's clothes.
      if (!isConnected(roomState.current)) return;
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
    // FIELD 2026-08-24. `ideal` constraints correctly fall back to the laptop
    // microphone when a headset drops — that is what keeps somebody in the
    // meeting. But when the headset RECONNECTS a few seconds later, nothing
    // moved back to it, so the person carried on talking into a headset that
    // was no longer the device being published. Rejoining fixed it because a
    // rejoin re-reads the device list. This does that without the rejoin, and
    // only ever moves BACK to the device they picked themselves.
    const onConn = (st: any) => {
      const v = String(st || room.state || "");
      roomState.current = v;
      if (isConnected(v)) {
        // Back. Do NOT trust devices yet — LiveKit republishes tracks
        // asynchronously, and a watchdog firing into that window blames the
        // microphone for a gap the reconnect is already closing.
        if (!connectedSince.current) connectedSince.current = Date.now();
      } else {
        connectedSince.current = 0;
        // Nothing said about a device is true right now, so nothing is said.
        setVerdict({ level: "ok", title: "", detail: "", action: "none" });
        setCamV({ level: "ok", title: "", detail: "", action: "none" });
        setMediaErr("");
      }
    };
    onConn(room.state);
    room.on(RoomEvent.ConnectionStateChanged, onConn);

    const onDevices = async () => {
      refreshDevices();
      if (!isConnected(roomState.current)) return;   // switching devices on a dead room does nothing
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const back = async (kind: "audioinput" | "videoinput", key: string, source: Track.Source) => {
          const savedId = load(key);
          const t: any = localParticipant?.getTrackPublication(source)?.track;
          const activeId = t?.mediaStreamTrack?.getSettings?.().deviceId;
          const present = all.filter((d) => d.kind === kind).map((d) => d.deviceId);
          if (!shouldReattach({ savedId, activeId, present })) return;
          await withTimeout(room.switchActiveDevice(kind, savedId) as any);
          if (kind === "audioinput") { lastSound.current = Date.now(); quietFixes.current = 0; attempts.current = 0; }
          else { camAttempts.current = 0; camFrozenSince.current = 0; camSig.current = ""; }
        };
        await back("audioinput", SAVED.mic, Track.Source.Microphone);
        await back("videoinput", SAVED.cam, Track.Source.Camera);
      } catch { /* the meeting is more important than the device list */ }
    };
    const onQuality = (q: ConnectionQuality, p: any) => {
      if (p?.identity && p.identity !== localParticipant?.identity) return;
      setQuality(connectionAdvice(String(q)));
    };
    room.on(RoomEvent.MediaDevicesError, onFail);
    room.on(RoomEvent.MediaDevicesChanged, onDevices);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onConn);
      room.off(RoomEvent.MediaDevicesError, onFail);
      room.off(RoomEvent.MediaDevicesChanged, onDevices);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
    };
  }, [room, localParticipant, refreshDevices, camWanted, micWanted]);

  /** A picture from this person's own computer. Read to a data: URL because a
   *  canvas that paints a remote image is a tainted canvas — and a background
   *  is meant to be private, so it has no business fetching anything. */
  function pickPicture(file: File | null | undefined) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || "");
      const v = acceptCustom(url);
      if (!v.ok) { setFxNote(v.why); return; }
      setCustomBg(url);
      save(SAVED.custom, url);
      setFxNote("");
      const slot = EFFECTS.find((e) => e.id === CUSTOM_ID);
      if (slot) { effectRef.current = slot; applyEffect(slot); }
    };
    r.onerror = () => setFxNote("That file couldn't be read. Try a JPEG or PNG.");
    r.readAsDataURL(file);
  }

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

  const costNote = effectCostNote({
    quality,
    effectOn: fx !== "none",
    poorForMs: poorSince.current ? Date.now() - poorSince.current : 0,
  });
  // None, Blur and their own picture always; a room only when its photograph
  // is actually here. With none shipped, that is three honest choices instead
  // of seven, five of which were cartoons.
  const shelf = shelfEffects(photoIds, loopIds);
  // DISMISSED MEANS DISMISSED. This used to bring the banner back thirty
  // seconds later, which is how one wrong verdict became a quarter of an hour
  // of pop-ups. A `dead` state — nothing is being sent at all — may return
  // after a long pause, because that one really does need answering; a `warn`
  // stays gone for the meeting.
  const DISMISS_DEAD_MS = 300000;
  const show = verdict.level !== "ok" &&
    (verdict.level === "dead" ? dismissed < Date.now() - DISMISS_DEAD_MS : dismissed === 0);
  const showCam = camV.level !== "ok" &&
    (camV.level === "dead" ? camDismissed < Date.now() - DISMISS_DEAD_MS : camDismissed === 0);
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
        aria-label="Settings — microphone, camera, speaker and background"
      >
        <span className="qmg-mini" aria-hidden>
          {bars(level, 5).map((lit, i) => (
            <span key={i} className={`qmg-mbar${lit ? " qmg-mlit" : ""}`} />
          ))}
        </span>
        Settings
      </button>

      {open ? (
        <div className="qmg-panel" ref={panelRef}>
          <div className="qmg-head">
            <b>Settings</b>
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
            {shelf.map((e) => (
              <button
                key={e.id}
                className={`qmg-swatch${fx === e.id ? " qmg-son" : ""}`}
                onClick={() => (e.custom && !customReady(e, customBg)
                  ? fileRef.current?.click()
                  : applyEffect(e))}
                disabled={fxBusy}
                title={e.custom && !customReady(e, customBg) ? "Add a picture of your own" : e.label}
                aria-pressed={fx === e.id}
              >
                {e.kind === "image" || e.kind === "video" ? (
                  // The swatch shows what you will ACTUALLY get, which is the
                  // point of a swatch — and since the shelf now only offers
                  // rooms whose photograph exists, that is the photograph.
                  // Loops use their poster still for the thumbnail.
                  <img
                    src={e.kind === "video" ? (e.photo || e.src || "") : effectSrc(e, customBg, photoIds.includes(e.id))}
                    alt=""
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).src = e.src || e.photo || ""; }}
                  />
                ) : (
                  <span className={e.kind === "blur" ? "qmg-swblur" : e.kind === "chroma" ? "qmg-swchroma" : "qmg-swnone"}>
                    {e.kind === "blur" ? "◐" : e.kind === "chroma" ? "▣" : "∅"}
                  </span>
                )}
                {e.badge ? <b className={"qmg-badge" + (e.badge === "Beta" ? " qmg-badge-beta" : "")}>{e.badge}</b> : null}
                <i>{e.kind === "video" ? `Loop · ${e.label}` : e.label}</i>
              </button>
            ))}
          </div>
          <p className="qmg-note">Green screen needs a green cloth behind you — it keys clean edges without the AI matte. Blur and replace still need Chrome or Edge.</p>

          <div className="qmg-fxrow">
            <button className="qmg-addbg" onClick={() => fileRef.current?.click()} disabled={fxBusy}>
              ＋ Use my own picture
            </button>
            {customBg ? (
              <button
                className="qmg-addbg qmg-addbg2"
                onClick={() => {
                  setCustomBg(""); save(SAVED.custom, "");
                  if (fx === CUSTOM_ID) applyEffect(EFFECTS[0]);
                }}
              >
                Remove it
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => { pickPicture(e.target.files?.[0]); e.currentTarget.value = ""; }}
            />
          </div>

          {fxBusy ? <p className="qmg-note">Starting the effect — the first time takes a moment while the model loads…</p> : null}
          {fxNote ? <p className="qmg-note">{fxNote}</p> : null}
          {costNote ? <p className="qmg-note qmg-costnote">
            {costNote}{" "}
            <button className="qmg-inline" onClick={() => applyEffect(EFFECTS[0])}>Turn my background off</button>
          </p> : null}
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
/* The label sits ON a photograph, and a photograph can be any brightness —
   a Sunlit Loft is nearly white exactly where the name goes. So the scrim is
   opaque enough to win on its own, and the text carries a shadow as well. */
.qmg-swatch i { position:absolute; left:0; right:0; bottom:0; font-style:normal;
  font-size:10px; letter-spacing:.06em; color:#ffffff; text-align:center; padding:3px 0 4px;
  text-shadow:0 1px 3px rgba(0,0,0,.95);
  background:linear-gradient(rgba(4,6,10,0), rgba(4,6,10,.72) 45%, rgba(4,6,10,.94)); }
.qmg-swatch:hover { border-color:#3b4356; }
.qmg-swatch:disabled { opacity:.6; cursor:default; }
.qmg-son { border-color:#00a99d; box-shadow:0 0 0 1px #00a99d inset; }
.qmg-swnone, .qmg-swblur, .qmg-swchroma { font-size:17px; color:#8b93a5; }
.qmg-swblur { filter:blur(1px); }
.qmg-swchroma { color:#3ddc84; }
.qmg-badge { position:absolute; top:4px; right:4px; z-index:1; font-size:8px; font-weight:700;
  letter-spacing:.04em; text-transform:uppercase; color:#0b0e14; background:#7fe0d6;
  border-radius:4px; padding:1px 4px; line-height:1.4; box-shadow:0 1px 2px rgba(0,0,0,.45); }
.qmg-badge-beta { background:#f0d9a6; }
.qmg-swatch[aria-pressed="true"] .qmg-badge { background:#00a99d; color:#fff; }
.qmg-swatch[aria-pressed="true"] .qmg-badge-beta { background:#c9a227; color:#fff; }
/* Eight slots read better in four columns — a backdrop swatch has to show a
   ROOM, and three-across at panel width makes each one a postage stamp. */
.qmg-fx { grid-template-columns:repeat(4, 1fr); }
.qmg-fxrow { display:flex; gap:8px; flex-wrap:wrap; margin-top:9px; }
.qmg-addbg { font:inherit; font-size:12.5px; cursor:pointer; color:#cfd6e4;
  background:#141922; border:1px dashed #39424f; border-radius:8px; padding:7px 12px; }
.qmg-addbg:hover:not(:disabled) { background:#1b2129; border-color:#4a5666; }
.qmg-addbg:disabled { opacity:.55; cursor:default; }
.qmg-addbg2 { border-style:solid; }
.qmg-costnote { color:#ffd9a0; }
.qmg-inline { font:inherit; font-size:inherit; color:#7fe0d6; background:none;
  border:0; padding:0; cursor:pointer; text-decoration:underline; }
`;
