import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { EgressClient } from "livekit-server-sdk";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { egressId, meetingId } = await req.json();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  );
  const { data: auth } = await supabase.auth.getUser();
  const { data: meeting } = await supabase
    .from("meetings").select("created_by").eq("id", meetingId).single();
  if (!auth.user || meeting?.created_by !== auth.user.id) {
    return NextResponse.json({ error: "only the meeting creator can stop" }, { status: 403 });
  }

  const egress = new EgressClient(
    process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!
  );
  await egress.stopEgress(egressId);
  await supabase.from("recordings").update({ status: "processing" }).eq("egress_id", egressId);
  return NextResponse.json({ ok: true });
}
