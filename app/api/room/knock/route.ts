// Knocking, and waiting to be let in.
//
// The guest's half of the waiting room. The host's half lives in
// /api/host/control, which already knows how to prove who the host is.
//
// The design rule: a person standing outside needs to know two things, and
// neither of them is a spinner. They need to know a human has SEEN them, and
// they need to know whether there is anybody in there at all. "Waiting for the
// host" shown to somebody whose host has not arrived is how a person sits and
// stares at a wall for ten minutes and then joins on Google Meet instead.

import { createClient } from "@supabase/supabase-js";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { dedupeKnocks, position, isStale, type Knock } from "@/lib/waiting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function livekitHost(): string {
  return process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_WS_URL || "";
}

/** Is anyone actually in there? Worth a network call, because the difference
 *  between "the host has been told" and "nobody has started this yet" is the
 *  difference between waiting patiently and giving up. */
async function anyoneInside(room: string): Promise<boolean | undefined> {
  const host = livekitHost();
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!host || !key || !secret) return undefined;
  try {
    const svc = new RoomServiceClient(host, key, secret);
    const people = await svc.listParticipants(room);
    return (people || []).length > 0;
  } catch {
    return undefined;   // unknown is not the same as empty, and we say so
  }
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const room = String(body?.room || "").trim();
  const knockId = String(body?.knockId || "").trim();
  const name = String(body?.name || "").trim().slice(0, 60) || "Guest";
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });

  const sb = admin();

  // ---- first knock -------------------------------------------------------
  if (!knockId) {
    const { data, error } = await sb
      .from("pending_admissions")
      .insert({ room_name: room, display_name: name, status: "pending" })
      .select("id, room_name, display_name, requested_at, status")
      .single();
    if (error || !data) {
      return Response.json(
        { error: "Couldn't let the host know you're here. The waiting-room table may not be set up yet." },
        { status: 503 }
      );
    }
    return Response.json({
      state: "pending",
      knockId: (data as any).id,
      hostPresent: await anyoneInside(room),
      position: 1,
    });
  }

  // ---- polling -----------------------------------------------------------
  const { data: mine } = await sb
    .from("pending_admissions")
    .select("id, room_name, display_name, requested_at, status")
    .eq("id", knockId)
    .maybeSingle();

  if (!mine || (mine as any).room_name !== room) {
    // The row is gone (or belongs to another meeting). Knock again rather than
    // leaving somebody polling a ghost for ever.
    return Response.json({ state: "expired" });
  }

  const status = String((mine as any).status || "pending");
  if (status === "denied") return Response.json({ state: "denied" });

  if (status === "admitted") {
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL || "";
    if (!key || !secret || !url) {
      return Response.json({ error: "This app's LiveKit settings are missing." }, { status: 503 });
    }
    // The token is minted HERE, on the way out, and never handed to the host's
    // browser to pass along. A credential that travels through a third party
    // is a credential a third party has.
    const who = String((mine as any).display_name || "Guest");
    const at = new AccessToken(key, secret, {
      identity: `${who}-${String(knockId).slice(0, 8)}`,
      name: who,
      ttl: "4h",
    });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return Response.json({ state: "admitted", token: await at.toJwt(), url });
  }

  // Still waiting. Tell them where they are in the queue and whether anybody
  // is even in the room.
  const { data: all } = await sb
    .from("pending_admissions")
    .select("id, room_name, display_name, requested_at, status")
    .eq("room_name", room)
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(200);

  const now = Date.now();
  const live = ((all as Knock[]) || []).filter((k) => !isStale(k, now));
  return Response.json({
    state: "pending",
    knockId,
    position: position(live, knockId),
    waiting: dedupeKnocks(live).length,
    hostPresent: await anyoneInside(room),
  });
}
