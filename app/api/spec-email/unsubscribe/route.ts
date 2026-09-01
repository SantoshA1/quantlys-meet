import { createClient } from "@supabase/supabase-js";
import { specTokenOk } from "@/lib/spec-email-send";
import { normalizeEmail } from "@/lib/spec-email";

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
  if (!meetingId || !email || !specTokenOk(meetingId, email, "unsub", t)) {
    return new Response("That unsubscribe link is not valid.", { status: 403 });
  }
  const sb = admin();
  await sb
    .from("spec_email_requests")
    .update({ status: "unsubscribed", decided_at: new Date().toISOString() })
    .eq("meeting_id", meetingId)
    .eq("email", email);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>
     <body style="font-family:-apple-system,sans-serif;background:#0b0d13;color:#e9edf5;padding:40px">
     <p>You will not get another spec email for this meeting.</p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
