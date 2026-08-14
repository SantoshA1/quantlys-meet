import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createServerClient } from "@supabase/ssr";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { admissionId, meetingId } = await req.json();
  const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: auth } = await s.auth.getUser();
  const { data: m } = await s.from("meetings").select("created_by, room_name").eq("id", meetingId).single();
  if (!auth.user || m?.created_by !== auth.user.id)
    return NextResponse.json({ error: "only the creator can admit" }, { status: 403 });

  const svc = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } });
  const { data: pend } = await svc.from("pending_admissions").select("*").eq("id", admissionId).single();
  await svc.from("pending_admissions").update({ status: "admitted" }).eq("id", admissionId);

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!,
    { identity: `guest-${admissionId}`, name: pend!.display_name, ttl: "3h" });
  at.addGrant({ room: m!.room_name, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return NextResponse.json({ token: await at.toJwt() });
}
