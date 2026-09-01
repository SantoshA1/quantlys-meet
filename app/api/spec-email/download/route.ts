import { createClient } from "@supabase/supabase-js";
import { specTokenOk } from "@/lib/spec-email-send";
import { specFilename, normalizeEmail } from "@/lib/spec-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const meetingId = String(url.searchParams.get("meeting") || "").trim();
  const email = normalizeEmail(url.searchParams.get("email") || "");
  const t = String(url.searchParams.get("t") || "").trim();
  if (!meetingId || !email || !specTokenOk(meetingId, email, "dl", t)) {
    return new Response("That download link is not valid.", { status: 403 });
  }
  const sb = admin();
  const { data: meeting } = await sb
    .from("meetings")
    .select("id, title, room_name, created_by")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return new Response("Gone.", { status: 404 });

  const { data: row } = await sb
    .from("spec_email_requests")
    .select("status")
    .eq("meeting_id", meetingId)
    .eq("email", email)
    .maybeSingle();
  const hostCopy = String((await sb.from("meetings").select("spec_email_host_address").eq("id", meetingId).maybeSingle()).data?.spec_email_host_address || "").toLowerCase();
  const allowed = (row && (row as any).status === "approved") || hostCopy === email;
  if (!allowed) return new Response("That download link is not valid.", { status: 403 });

  const filename = specFilename(String((meeting as any).title || "spec"));
  const path = `${(meeting as any).created_by}/${(meeting as any).room_name}/${filename}`;
  const got = await sb.storage.from("recordings").download(path);
  if (got.error || !got.data) return new Response("The spec is not ready.", { status: 404 });
  const buf = Buffer.from(await got.data.arrayBuffer());
  return new Response(buf, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
