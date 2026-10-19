// What pressing Leave should do, decided in one place.
//
// FIELD 2026-10-17: a host left three Memory sessions and found out the next
// day that none of them had been recorded. Leave must never be the moment a
// recording is lost, and never the moment somebody learns too late that there
// wasn't one.

export type LeaveIntent =
  | "wait"                 // a save is uploading — the button is disabled
  | "confirm-recording"    // recording: ask, then stop + upload, then leave
  | "confirm-unrecorded"   // host leaving a Memory session nothing was kept from
  | "leave";

export function leaveIntent(s: {
  recording: boolean;
  busy: boolean;
  isHost: boolean;
  sessionMode: string;
  recordedThisPage: boolean;
}): LeaveIntent {
  if (s.busy) return "wait";
  if (s.recording) return "confirm-recording";
  if (s.isHost && s.sessionMode === "memory" && !s.recordedThisPage) return "confirm-unrecorded";
  return "leave";
}

/** sessionStorage key the host page reads to say "This session wasn't recorded". */
export const UNRECORDED_KEY = "qm.unrecorded";

export type UnrecordedNote = { room: string; title: string; at: number };

/** Parse what the room left behind. Stale (>10 min) or malformed → null. */
export function readUnrecorded(raw: string | null, now = Date.now()): UnrecordedNote | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const at = Number(o?.at);
    if (!o?.room || !Number.isFinite(at) || now - at > 10 * 60_000 || at > now + 60_000) return null;
    return { room: String(o.room).slice(0, 80), title: String(o.title || "").slice(0, 200), at };
  } catch {
    return null;
  }
}

export function unrecordedText(n: UnrecordedNote): string {
  return `This session wasn't recorded. Nothing from ${n.title ? `“${n.title}”` : n.room} was saved — no recording, transcript or story. Next time, check the red Recording badge is up before you start.`;
}
