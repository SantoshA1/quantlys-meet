// The supervisor's rules: when to try again, when to hand the device back to
// the one the person actually chose, and how never to wedge.
//
// FIELD 2026-08-24, from a live meeting and a hosted one: "user using windows
// desktop missing live video, and people using bluetooth headsets cannot be
// heard unless users rejoin back."
//
// The app already had a watchdog per organ. Three things in the WIRING made
// rejoining the only cure, and none of them were visible in the pure logic:
//
//   1. IT GAVE UP. The retry ladder is 400ms, 1.5s, 4s — and then nothing,
//      for the rest of the meeting. A Bluetooth headset that is mid-profile-
//      switch refuses three times in six seconds as a matter of course, and
//      after the third refusal the microphone was never asked for again.
//      Rejoining worked because rejoining asks again. So: after the fast
//      ladder is spent, keep asking PATIENTLY, forever, as long as the person
//      still wants the device on. Zoom does this. Giving up is the bug.
//
//   2. IT COULD WEDGE. Recovery is guarded by an in-flight flag cleared in a
//      `finally`. `setMicrophoneEnabled` on Windows can sit for ever on a
//      device that is half-gone — the promise never settles, the `finally`
//      never runs, the flag stays true and every future recovery is dropped
//      silently. A supervisor that can hang is not a supervisor. Everything
//      it calls gets a deadline.
//
//   3. IT NEVER CAME BACK. When a headset drops for a second, `ideal`
//      constraints correctly fall back to the laptop microphone — that is the
//      right call, it keeps you in the meeting. But when the headset
//      RECONNECTS ten seconds later, nothing moved back to it. The person is
//      talking into a headset that is no longer the one being published, and
//      the only thing that fixes it is a rejoin, because a rejoin re-reads the
//      device list.
//
// Zero-import, so every rule here is decided without a browser and pinned by
// lib/recovery.test.mjs.

/** A recovery call that has not come back by now is treated as failed. It may
 *  still succeed later and that is fine — the point is that the supervisor
 *  gets its turn back. Long enough for a real getUserMedia on a cold
 *  Bluetooth stack (which is slow), short enough to be inside one sentence. */
export const RECOVER_TIMEOUT_MS = 6000;

/** The standing retry, once the fast ladder is spent. Rare enough not to
 *  thrash a machine already having a bad day; often enough that a headset
 *  which comes back at 10:04 is live again by 10:04. */
export const PATIENT_MS = 15000;

/** The fast ladder first — somebody is mid-sentence — then patience, for as
 *  long as the person wants the device on. Never returns 0: not giving up is
 *  the whole point of this file. */
export function nextDelay(attempts: number, fast: (n: number) => number): number {
  const f = Number(fast(attempts)) || 0;
  return f > 0 ? f : PATIENT_MS;
}

/** Is it time to try again? */
export function dueForRetry(s: {
  /** does the person still want this device on? a muted mic is not a fault */
  wantOn: boolean;
  /** is a recovery already running */
  inFlight: boolean;
  attempts: number;
  /** ms since the last attempt STARTED */
  sinceMs: number;
  fast: (n: number) => number;
}): boolean {
  if (!s.wantOn) return false;
  if (s.inFlight) return false;
  return s.sinceMs >= nextDelay(s.attempts, s.fast);
}

/** Has an in-flight recovery been running long enough that we should stop
 *  believing in it? This is what stops one hung call from silencing somebody
 *  for the rest of the meeting. */
export function isStuck(startedAt: number, now: number, timeout = RECOVER_TIMEOUT_MS): boolean {
  if (!startedAt) return false;
  return now - startedAt >= timeout;
}

/** The device somebody CHOSE has come back and we are not on it.
 *
 *  Deliberately conservative: "default" is not a choice, an empty saved id is
 *  not a choice, and a device that is not in the current list is not offered.
 *  Moving somebody's microphone without being asked is its own bug — this
 *  only ever moves it BACK to the one they picked. */
export function shouldReattach(s: {
  /** the deviceId the person picked, from the device check or the panel */
  savedId?: string;
  /** the deviceId the live track is actually running on */
  activeId?: string;
  /** deviceIds enumerated right now */
  present?: string[];
}): boolean {
  const saved = String(s.savedId || "").trim();
  if (!saved || saved === "default") return false;
  if (saved === String(s.activeId || "").trim()) return false;
  return (s.present || []).some((d) => String(d || "") === saved);
}

/** Wrap anything that talks to a device in a deadline. Resolves `false` on
 *  timeout rather than throwing, because a supervisor that throws at itself
 *  is a supervisor that stops. */
export function withTimeout<T>(p: Promise<T>, ms = RECOVER_TIMEOUT_MS): Promise<T | false> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    Promise.resolve(p).then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(false); } }
    );
  });
}
