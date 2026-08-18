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
import { dedupeKnocks, hostSummary, isStale, type Knock } from "@/lib/waiting";

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
    .select("id, created_by, locked, waiting_room")
    .eq("room_name", room)
    .maybeSingle();

  const isHost = Boolean(user && meeting && meeting.created_by === user.id);
  const locked = Boolean(meeting?.locked);

  // Anyone may ask about themselves. Only the host is ever told "yes".
  if (action === "status") {
    return Response.json({
      host: isHost,
      locked,
      waitingRoom: Boolean((meeting as any)?.waiting_room),
      tracked: Boolean(meeting),
    });
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

  // ── the waiting room ───────────────────────────────────────────────────
  //
  // The lock above turns the link off. This one keeps a door and puts a person
  // behind it. Both exist because they answer different questions: "no more
  // people" and "only the right people".
  if (action === "waiting_on" || action === "waiting_off") {
    const next = action === "waiting_on";
    const { error } = await sb
      .from("meetings")
      .update({ waiting_room: next })
      .eq("id", meeting!.id);
    if (error) {
      return Response.json(
        { error: "Couldn't change the waiting room — has the `waiting_room` column been added? Run the schema step in Supabase." },
        { status: 500 }
      );
    }
    return Response.json({ host: true, waitingRoom: next });
  }

  if (action === "waiting" || action === "admit" || action === "deny" || action === "admit_all") {
    const knockId = String(body.knockId || "").trim();

    if (action === "admit" || action === "deny") {
      if (!knockId) return Response.json({ error: "Which person?" }, { status: 400 });
      // Scoped to THIS room. A knock id from another meeting must not be
      // admittable by this host just because they hold the id.
      const { error } = await sb
        .from("pending_admissions")
        .update({ status: action === "admit" ? "admitted" : "denied", decided_at: new Date().toISOString() })
        .eq("id", knockId)
        .eq("room_name", room);
      if (error) return Response.json({ error: "Couldn't record that." }, { status: 500 });
    }

    if (action === "admit_all") {
      const { error } = await sb
        .from("pending_admissions")
        .update({ status: "admitted", decided_at: new Date().toISOString() })
        .eq("room_name", room)
        .eq("status", "pending");
      if (error) return Response.json({ error: "Couldn't let everyone in." }, { status: 500 });
    }

    // Conclave round 39: bounded, and the bound is reported. A host shown 200
    // of 260 people would leave sixty of them standing outside for ever and
    // never know there was anybody there.
    const { data: rows, count: total } = await sb
      .from("pending_admissions")
      .select("id, room_name, display_name, requested_at, status", { count: "exact" })
      .eq("room_name", room)
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(200);

    const now = Date.now();
    const live = ((rows as Knock[]) || []).filter((k) => !isStale(k, now));
    const waiting = dedupeKnocks(live);
    return Response.json({
      host: true,
      waitingRoom: Boolean((meeting as any)?.waiting_room),
      waiting,
      total: total ?? waiting.length,
      summary: hostSummary(waiting),
    });
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
