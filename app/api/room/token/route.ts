// Token minting for the full room. Self-contained on purpose: it reads the
// LiveKit values straight from the environment and does not depend on any
// other route, so the existing room keeps working exactly as it does today.

import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// A locked meeting is the small, honest version of a waiting room: once the
// people who should be here are here, the host closes the door and the link
// stops working for anyone else. No queue to watch, nothing to approve, and
// nobody standing outside wondering whether they were seen.
async function doorState(room: string): Promise<{ locked: boolean; waitingRoom: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const open = { locked: false, waitingRoom: false };
  if (!url || !key) return open;          // no database to ask → never lock anyone out
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await sb
      .from("meetings")
      .select("id, locked, waiting_room, active")
      .eq("room_name", room)
      .maybeSingle();
    // A leftover "ended" row (old host END, cron, Kids) is not meeting death.
    // OPEN mints a token and brings the row back to life. Fail open: a missed
    // update must not refuse the token.
    if (data && (data as any).active === false && (data as any).id) {
      try {
        await sb.from("meetings").update({ active: true }).eq("id", (data as any).id);
      } catch {
        /* leftover ended row staying ended is not a reason to refuse the token */
      }
    }
    return {
      locked: Boolean((data as any)?.locked),
      waitingRoom: Boolean((data as any)?.waiting_room),
    };
  } catch {
    return open;                          // the door fails OPEN, never shut
  }
}

async function isLockedLegacy(room: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;      // no database to ask → never lock anyone out
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await sb
      .from("meetings")
      .select("locked")
      .eq("room_name", room)
      .maybeSingle();
    return Boolean(data?.locked);
  } catch {
    return false;                      // the door fails OPEN, never shut
  }
}

function livekitUrl(): string {
  return (
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    process.env.LIVEKIT_URL ||
    process.env.LIVEKIT_WS_URL ||
    ""
  );
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const room = String(body.room || "").trim();
  const name = String(body.name || "").trim() || "Guest";
  if (!room) {
    return Response.json({ error: "A room name is required." }, { status: 400 });
  }

  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = livekitUrl();
  if (!key || !secret || !url) {
    return Response.json(
      { error: "This app's LiveKit settings are missing — connect LiveKit and relaunch." },
      { status: 503 }
    );
  }

  const door = await doorState(room);
  if (door.locked) {
    return Response.json(
      { error: "This meeting is locked — the host has closed it to new people. Ask them to unlock it." },
      { status: 423 }
    );
  }

  // A waiting room does not refuse anybody. It hands them to a human.
  if (door.waitingRoom) {
    return Response.json({ waiting: true, room, name }, { status: 202 });
  }

  const identity = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const at = new AccessToken(key, secret, { identity, name, ttl: "4h" });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return Response.json({ token: await at.toJwt(), url });
}
