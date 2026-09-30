import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createServerClient } from "@supabase/ssr";
import { GUEST_JOIN_CLOSED, guestJoinAllowed } from "@/lib/guest-join";
export const runtime = "nodejs";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;

async function getUser(req: NextRequest) {
  const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  return (await s.auth.getUser()).data.user;
}

export async function POST(req: NextRequest) {
  const { room, name } = await req.json();
  if (!room) return NextResponse.json({ error: "room required" }, { status: 400 });

  const displayName = String(name || "Guest").slice(0, 60);
  const user = await getUser(req);

  // Is the caller the host of this room?
  let isHost = false;
  if (user) {
    const domain = user.email?.split("@")[1];
    if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN)
      return NextResponse.json({ error: `Hosting is limited to @${ALLOWED_DOMAIN}` }, { status: 403 });
    const svc = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } });
    const { data: m } = await svc.from("meetings").select("created_by").eq("room_name", room).maybeSingle();
    isHost = !!m && m.created_by === user.id;
  }

  // Global kill switch before per-room approval. Unsigned guests stop here
  // when ALLOW_GUEST_JOIN is false; signed-in non-hosts continue.
  if (!isHost && !user && !guestJoinAllowed()) {
    return NextResponse.json({ error: GUEST_JOIN_CLOSED }, { status: 403 });
  }

  // Host always enters. Guests enter directly UNLESS this room requires approval.
  if (!isHost) {
    const svc = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } });
    const { data: m } = await svc.from("meetings")
      .select("id, requires_approval").eq("room_name", room).maybeSingle();

    if (m?.requires_approval) {
      const { data: row } = await svc.from("pending_admissions")
        .insert({ room_name: room, display_name: displayName }).select("id").single();
      return NextResponse.json({ pending: true, admissionId: row!.id }, { status: 202 });
    }
  }

  const identity = user
    ? user.id
    : `guest-${crypto.randomUUID()}`;

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!,
    { identity, name: displayName, ttl: "3h" });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return NextResponse.json({ token: await at.toJwt(), isHost });
}
