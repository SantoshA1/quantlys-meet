// The hosted session limit, as seen from inside the room.
//
// GET  ?room=…  → how long this session has left (from LiveKit's own clock).
// POST {room}   → "time is up": the server re-checks the clock itself and, only
//                 if the limit really has been reached, ends the session for
//                 everyone (lib/meeting-cap-server.ts endCappedSession).
//
// Both need the LiveKit token the tab joined with, so only people in the
// room can ask. Nobody can end a session early through this route: the
// browser's opinion of the time is never used.

import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { requireRoomToken } from "@/lib/room-auth";
import { capEndAllowed, capEndedMessage } from "@/lib/meeting-cap";
import { capStatusFor, endCappedSession } from "@/lib/meeting-cap-server";
import { appUrl } from "@/lib/spec-email-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function shape(s: Awaited<ReturnType<typeof capStatusFor>>) {
  return {
    limited: s.limited,
    capMinutes: s.capMinutes,
    live: s.live,
    unknown: Boolean(s.unknown),
    remainingMs: Number.isFinite(s.remainingMs) ? s.remainingMs : null,
    endsAt: s.endsAt || null,
    serverNow: Date.now(),
  };
}

export async function GET(req: Request) {
  const limited = await rateLimit(req, "room-limit", LIMITS.read);
  if (limited) return limited;
  const room = String(new URL(req.url).searchParams.get("room") || "").trim();
  if (!room) return Response.json({ error: "A room name is required." }, { status: 400 });
  const denied = await requireRoomToken(req, room);
  if (denied) return denied;
  return Response.json(shape(await capStatusFor(room)));
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, "room-limit", LIMITS.read);
  if (limited) return limited;
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const room = String(body.room || "").trim();
  if (!room) return Response.json({ error: "A room name is required." }, { status: 400 });
  const denied = await requireRoomToken(req, room);
  if (denied) return denied;

  const s = await capStatusFor(room);
  if (!s.limited) {
    return Response.json({ error: "This deployment has no session limit." }, { status: 400 });
  }
  if (s.unknown) {
    return Response.json({ error: "Couldn't check the session clock. Try again." }, { status: 503 });
  }
  if (!s.live) {
    // Already ended (by another tab, or the host) — nothing left to do.
    return Response.json({ ended: true, already: true, message: capEndedMessage(s.capMinutes) });
  }
  if (!capEndAllowed(s)) {
    return Response.json({ ended: false, ...shape(s) }, { status: 409 });
  }
  const out = await endCappedSession(room, appUrl(req));
  return Response.json({ ended: true, ...out, message: capEndedMessage(s.capMinutes) });
}
