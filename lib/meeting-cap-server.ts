// Server half of the hosted session limit (see lib/meeting-cap.ts).
//
// The session clock is the LiveKit room's creation time, read from LiveKit
// with the API secret. Nothing the browser says moves it: a refresh or a
// rejoin lands in the same live room, so the same clock.

import { RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";
import { capWindow, meetingCapMinutes, type CapWindow } from "@/lib/meeting-cap";
import { sendSpecIfDue } from "@/lib/spec-email-send";

function livekitHost(): string {
  return process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_WS_URL || "";
}

function roomService(): RoomServiceClient | null {
  const host = livekitHost();
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!host || !key || !secret) return null;
  return new RoomServiceClient(host, key, secret);
}

/** ms since epoch the live room was created, or null when no room is live. Throws if LiveKit can't be asked. */
export async function liveRoomStartedAt(room: string): Promise<number | null> {
  const svc = roomService();
  if (!svc) throw new Error("LiveKit is not configured");
  const rooms = await svc.listRooms([room]);
  const r: any = (rooms || []).find((x: any) => x?.name === room);
  if (!r) return null;
  const ms = Number(r.creationTimeMs || 0) || Number(r.creationTime || 0) * 1000;
  return ms > 0 ? ms : null;
}

export type CapStatus = CapWindow & {
  /** A LiveKit room for this meeting is live right now. */
  live: boolean;
  /** LiveKit could not be asked; the limit could not be checked this time. */
  unknown?: boolean;
};

/** The session limit for a room, read from LiveKit. Never throws. */
export async function capStatusFor(room: string, now = Date.now()): Promise<CapStatus> {
  const cap = meetingCapMinutes();
  if (!cap) return { ...capWindow(null, now, 0), live: false };
  try {
    const startedAt = await liveRoomStartedAt(room);
    return { ...capWindow(startedAt, now, cap), live: startedAt != null };
  } catch (e: any) {
    // Fail OPEN on a LiveKit hiccup: refusing every join because the limit
    // couldn't be read would turn a monitoring blip into an outage. The
    // client still gets an end time the next time it asks.
    console.warn("[meeting-cap] could not read the room's start time:", e?.message || e);
    return { ...capWindow(null, now, cap), live: false, unknown: true };
  }
}

/**
 * End a session that reached the limit: drop the LiveKit room (everyone is
 * disconnected), mark the meeting row ended, and send the spec email if
 * one is due — the same steps as the host's End, plus active=false so a
 * guest cannot rejoin the ended session. The host's next join reopens the
 * meeting as a new session (app/api/room/token).
 */
export async function endCappedSession(room: string, origin: string): Promise<{ roomDeleted: boolean; marked: boolean }> {
  let roomDeleted = false;
  let marked = false;
  const svc = roomService();
  if (svc) {
    try { await svc.deleteRoom(room); roomDeleted = true; } catch { /* already gone */ }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { data: m } = await sb.from("meetings").select("id").eq("room_name", room).maybeSingle();
      if (m?.id) {
        const { error } = await sb
          .from("meetings")
          .update({ ended_at: new Date().toISOString(), active: false })
          .eq("id", m.id);
        marked = !error;
        try {
          await sendSpecIfDue(sb, m.id, origin);
        } catch (e: any) {
          console.warn("[meeting-cap] spec email on limit end failed", e?.message || e);
        }
      }
    } catch (e: any) {
      console.warn("[meeting-cap] could not mark the meeting ended", e?.message || e);
    }
  }
  return { roomDeleted, marked };
}
