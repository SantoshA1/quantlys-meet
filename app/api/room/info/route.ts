// What a guest standing in the lobby is allowed to know.
//
// DESIGN 2026-08-18. The lobby tells you what you are about to walk into:
// the meeting's name, when it starts, who is already inside, who invited
// you, and whether others are waiting too. Everything here is information
// the link already grants — anyone the host sent the link to would learn
// all of it thirty seconds later by joining. Nothing else leaves: no ids,
// no addresses of other guests, no tokens.

import { createClient } from "@supabase/supabase-js";
import { RoomServiceClient } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

function lkHttp(): string {
  const u = (process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL ||
             process.env.LIVEKIT_WS_URL || "").trim();
  return u ? u.replace(/^ws/, "http") : "";
}

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get("room")?.trim() || "";
  if (!room) return Response.json({ error: "A room is required." }, { status: 400 });

  const out: any = { room, title: null, scheduled_at: null, host: null, in: [], waiting: 0 };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    try {
      const { data: m } = await sb
        .from("meetings")
        .select("title, scheduled_at, created_by")
        .eq("room_name", room)
        .maybeSingle();
      if (m) {
        out.title = m.title || null;
        out.scheduled_at = m.scheduled_at || null;
        // The host's address, because "who invited me" is the first thing a
        // careful guest checks. The host sent this person the link; naming
        // the sender is not a leak, it is the thing that makes the link safe
        // to click.
        if (m.created_by) {
          try {
            const u = await sb.auth.admin.getUserById(m.created_by);
            out.host = u?.data?.user?.email || null;
          } catch { /* fine without */ }
        }
      }
      const { count } = await sb
        .from("pending_admissions")
        .select("id", { count: "exact", head: true })
        .eq("room_name", room)
        .eq("status", "pending");
      out.waiting = count || 0;
    } catch { /* the lobby renders what it has */ }
  }

  // First names of the people already inside — from the room itself, so it
  // can never disagree with reality the way a database row could.
  const lk = lkHttp();
  const lkey = process.env.LIVEKIT_API_KEY;
  const lsec = process.env.LIVEKIT_API_SECRET;
  if (lk && lkey && lsec) {
    try {
      const svc = new RoomServiceClient(lk, lkey, lsec);
      const people = await svc.listParticipants(room);
      out.in = people
        .map((p) => String(p.name || p.identity.split("-")[0] || "").split(" ")[0])
        .filter(Boolean)
        .slice(0, 6);
    } catch { /* room not live yet — an empty lobby is the honest answer */ }
  }

  return Response.json(out);
}
