// Host controls for a live meeting: mute someone, remove someone, and lock
// the door so the link stops letting new people in.
//
// Every one of these has to happen on the SERVER. A browser cannot mute
// another person's microphone or disconnect them — if it could, any guest
// could do it to anyone. So the client asks, this route checks who is asking,
// and LiveKit is told by the server that holds the API secret.
//
// "Host" means exactly one thing here: the signed-in person whose `meetings`
// row owns this room. A room with no meetings row has no host, and this route
// says so plainly rather than guessing.

import { createClient } from "@supabase/supabase-js";
import { RoomServiceClient, TrackSource, TrackType } from "livekit-server-sdk";

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
  return (
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    process.env.LIVEKIT_WS_URL ||
    ""
  );
}

function rooms(): RoomServiceClient | null {
  const host = livekitHost();
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!host || !key || !secret) return null;
  // RoomServiceClient turns wss:// into https:// itself.
  return new RoomServiceClient(host, key, secret);
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const room = String(body.room || "").trim();
  const action = String(body.action || "status").trim();
  const identity = String(body.identity || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Nothing is broken for the guests — the host simply has no controls.
    return Response.json({ host: false, locked: false, reason: "not_configured" });
  }

  // Who is asking? Their own token, verified — never an id from a body.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const sb = admin();
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user || null;

  const { data: meeting } = await sb
    .from("meetings")
    .select("id, created_by, locked")
    .eq("room_name", room)
    .maybeSingle();

  const isHost = Boolean(user && meeting && meeting.created_by === user.id);
  const locked = Boolean(meeting?.locked);

  // Anyone may ask about themselves. Only the host is ever told "yes".
  if (action === "status") {
    return Response.json({ host: isHost, locked, tracked: Boolean(meeting) });
  }

  if (!isHost) {
    return Response.json(
      { error: "Only the person who created this meeting can do that." },
      { status: 403 }
    );
  }

  if (action === "lock" || action === "unlock") {
    const next = action === "lock";
    const { error } = await sb
      .from("meetings")
      .update({ locked: next })
      .eq("id", meeting!.id);
    if (error) {
      return Response.json(
        { error: "Couldn't change the lock — is the `locked` column added?" },
        { status: 500 }
      );
    }
    return Response.json({ host: true, locked: next });
  }

  const svc = rooms();
  if (!svc) {
    return Response.json({ error: "LiveKit isn't configured on the server." }, { status: 503 });
  }
  if (!identity) return Response.json({ error: "Which person?" }, { status: 400 });

  try {
    if (action === "remove") {
      await svc.removeParticipant(room, identity);
      return Response.json({ ok: true, action: "remove", identity });
    }

    if (action === "mute") {
      // Mute EVERY audio track they have published — a person can have more
      // than one, and muting the first one found leaves them still audible.
      const people = await svc.listParticipants(room);
      const p = people.find((x: any) => x.identity === identity);
      if (!p) return Response.json({ error: "They've already left." }, { status: 404 });
      // The enum, not a hand-written number. TrackType.AUDIO is 0 and VIDEO
      // is 1 — a literal 1 here would have muted their CAMERA and left them
      // talking, which is the opposite of what the host pressed.
      const audio = (p.tracks || []).filter(
        (t) => t.type === TrackType.AUDIO || t.source === TrackSource.MICROPHONE
      );
      if (!audio.length) {
        return Response.json({ ok: true, action: "mute", identity, already: true });
      }
      for (const t of audio) await svc.mutePublishedTrack(room, identity, t.sid, true);
      return Response.json({ ok: true, action: "mute", identity });
    }
  } catch (e: any) {
    return Response.json(
      { error: `LiveKit refused that: ${e?.message || "unknown error"}` },
      { status: 502 }
    );
  }

  return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
