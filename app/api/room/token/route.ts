// Token minting for the full room. Self-contained on purpose: it reads the
// LiveKit values straight from the environment and does not depend on any
// other route, so the existing room keeps working exactly as it does today.

import { AccessToken } from "livekit-server-sdk";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { GUEST_JOIN_CLOSED, guestJoinAllowed } from "@/lib/guest-join";

export const dynamic = "force-dynamic";

// A locked meeting is the small, honest version of a waiting room: once the
// people who should be here are here, the host closes the door and the link
// stops working for anyone else. No queue to watch, nothing to approve, and
// nobody standing outside wondering whether they were seen.
type Door = { exists: boolean; joinable: boolean; locked: boolean; waitingRoom: boolean; isHost: boolean };

// Security (audit 2026-10-12): a token is only minted for a room that has a
// meeting row. Only the authenticated host may reopen an ended meeting
// (active=false) or reset spec_email_sent_at; guests cannot resurrect rows.
async function doorState(room: string, userId: string | null): Promise<Door> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No database configured (bare self-host): there is no meeting registry to
  // check against, so keep the old open behaviour.
  const open: Door = { exists: true, joinable: true, locked: false, waitingRoom: false, isHost: false };
  if (!url || !key) return open;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    let data: any = null;
    const full = await sb
      .from("meetings")
      .select("id, created_by, locked, waiting_room, active, ended_at, spec_email_sent_at")
      .eq("room_name", room)
      .maybeSingle();
    if (!full.error) data = full.data;
    else {
      const basic = await sb
        .from("meetings")
        .select("id, created_by, locked, waiting_room, active")
        .eq("room_name", room)
        .maybeSingle();
      if (basic.error) return open;      // DB hiccup: fail open, as before
      data = basic.data;
    }
    if (!data || !(data as any).id) {
      return { exists: false, joinable: false, locked: false, waitingRoom: false, isHost: false };
    }
    const isHost = !!userId && (data as any).created_by === userId;
    // A leftover "ended" row is not meeting death, but only the HOST brings
    // it back to life. Fail open: a missed update must not refuse the token.
    if (isHost) {
      const patch: any = {};
      if ((data as any).active === false) patch.active = true;
      // A rejoin after End is a later session: the next End may send again.
      if ((data as any).ended_at && (data as any).spec_email_sent_at) {
        patch.spec_email_sent_at = null;
      }
      if (Object.keys(patch).length) {
        try {
          await sb.from("meetings").update(patch).eq("id", (data as any).id);
        } catch {
          /* leftover ended row staying ended is not a reason to refuse the token */
        }
      }
    }
    return {
      exists: true,
      joinable: isHost || (data as any).active !== false,
      locked: Boolean((data as any)?.locked),
      waitingRoom: Boolean((data as any)?.waiting_room),
      isHost,
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


/** Signed-in caller via Bearer JWT or session cookies. Guests have neither. */
async function signedInUser(req: Request): Promise<{ id: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (bearer) {
      const sb = createClient(url, anon, { auth: { persistSession: false } });
      const who = await sb.auth.getUser(bearer);
      if (who.data?.user?.id) return { id: who.data.user.id };
    }
    const raw = req.headers.get("cookie") || "";
    const jar = new Map<string, string>();
    for (const part of raw.split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) jar.set(k, decodeURIComponent(v));
    }
    const s = createServerClient(url, anon, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: () => {},
      },
    });
    const { data } = await s.auth.getUser();
    return data.user?.id ? { id: data.user.id } : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "room-token", LIMITS.token);
  if (limited) return limited;
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

  // Global kill switch. Product default is guests ON; ALLOW_GUEST_JOIN=false
  // refuses unsigned callers. Hosts and other signed-in people still enter.
  const user = await signedInUser(req);
  if (!guestJoinAllowed()) {
    if (!user) {
      return Response.json({ error: GUEST_JOIN_CLOSED }, { status: 403 });
    }
  }

  const door = await doorState(room, user?.id ?? null);
  if (!door.exists) {
    return Response.json({ error: "This meeting does not exist. Check the link with your host." }, { status: 404 });
  }
  if (!door.joinable) {
    return Response.json(
      { error: "This meeting has ended. Ask the host to reopen it." },
      { status: 409 }
    );
  }
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
