import { NextRequest, NextResponse } from "next/server";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
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
  const limited = await rateLimit(req, "livekit-token", LIMITS.token);
  if (limited) return limited;
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
    const { data: m, error: mErr } = await svc.from("meetings")
      .select("id, active").eq("room_name", room).maybeSingle();
    // Security (audit 2026-10-12): no token for rooms without a meeting row,
    // and guests cannot join a meeting the host has ended. Fail closed here:
    // this legacy route has no self-host "no database" mode.
    if (mErr) {
      return NextResponse.json({ error: "Could not check this meeting. Try again." }, { status: 503 });
    }
    if (!m) {
      return NextResponse.json({ error: "This meeting does not exist." }, { status: 404 });
    }
    if ((m as any).active === false) {
      return NextResponse.json({ error: "This meeting has ended. Ask the host to reopen it." }, { status: 409 });
    }
    // requires_approval is optional (not every schema has the column); a
    // missing column must not hide the existence check above.
    const appr = await svc.from("meetings")
      .select("requires_approval").eq("room_name", room).maybeSingle();
    const needsApproval = !appr.error && Boolean((appr.data as any)?.requires_approval);

    if (needsApproval) {
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
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
  return NextResponse.json({ token: await at.toJwt(), isHost });
}
