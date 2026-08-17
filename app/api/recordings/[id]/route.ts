// One recording, by id — a signed link the person who owns it can open.
//
// FIELD 2026-08-17: this file arrived in the repo with its HEAD CUT OFF. It
// began at `export async function GET(...)` with no imports at all, so
// `NextRequest` and `NextResponse` were undefined and the very first line was
// a syntax error. Conclave's own build step spotted it and worked around it by
// EXCLUDING the file from the upload — which is why the direct deploys kept
// succeeding while the same commit failed the moment anything built the repo
// honestly. A file that is skipped is not a file that is fixed.
//
// Rewritten complete, and deliberately small: verify who is asking, confirm
// the recording is theirs, hand back a short-lived signed URL.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }

  // Their own token, verified — never an id from the URL alone.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const sb = admin();
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  const { data: rec } = await sb
    .from("recordings")
    .select("id, meeting_id, room_name, storage_prefix, created_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!rec) return Response.json({ error: "No such recording." }, { status: 404 });

  // Ownership: the meeting it belongs to has to be yours.
  const { data: meeting } = await sb
    .from("meetings")
    .select("created_by")
    .eq("id", (rec as any).meeting_id)
    .maybeSingle();
  if (!meeting || (meeting as any).created_by !== user.id) {
    return Response.json({ error: "That recording isn't yours." }, { status: 403 });
  }

  const prefix = String((rec as any).storage_prefix || "");
  if (!prefix) {
    return Response.json({ error: "That recording has no file behind it." }, { status: 404 });
  }
  const { data: listed } = await sb.storage.from("recordings").list(prefix, { limit: 20 });
  const video = (listed || []).find((f: any) => /\.(mp4|webm)$/i.test(f.name));
  if (!video) {
    return Response.json({ error: "That recording has no file behind it." }, { status: 404 });
  }
  const { data: signed, error } = await sb.storage
    .from("recordings")
    .createSignedUrl(`${prefix}/${video.name}`, 3600);
  if (error || !signed) {
    return Response.json({ error: "Couldn't open that recording." }, { status: 502 });
  }
  return Response.json({ id: params.id, room: (rec as any).room_name, url: signed.signedUrl });
}
