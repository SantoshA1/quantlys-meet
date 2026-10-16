// Per-meeting glossary for caption boosting (names + jargon → Deepgram).
// Stored as a small JSON file in the host's existing prd/ storage folder, so
// no schema change. GET: anyone holding this room's LiveKit token (the
// caption client needs it). POST: only the meeting's host (Supabase session).

import { createClient } from "@supabase/supabase-js";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { requireRoomToken } from "@/lib/room-auth";
import { sanitizeGlossary, glossaryPath } from "@/lib/keyterms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function hostOf(sb: any, room: string): Promise<string | null> {
  const { data } = await sb.from("meetings").select("created_by").eq("room_name", room).maybeSingle();
  return data?.created_by || null;
}

async function readTerms(sb: any, hostId: string, room: string): Promise<string[]> {
  try {
    const { data } = await sb.storage.from("recordings").download(glossaryPath(hostId, room));
    if (!data) return [];
    const j = JSON.parse(await data.text());
    return sanitizeGlossary(j?.terms || []);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const limited = await rateLimit(req, "glossary-read", LIMITS.read);
  if (limited) return limited;
  const room = String(new URL(req.url).searchParams.get("room") || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });
  const denied = await requireRoomToken(req, room);
  if (denied) return denied;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return Response.json({ terms: [] });
  const sb = admin();
  const host = await hostOf(sb, room);
  if (!host) return Response.json({ terms: [] });
  return Response.json({ terms: await readTerms(sb, host, room) });
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, "glossary-write", LIMITS.email);
  if (limited) return limited;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const room = String(body?.room || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const user = jwt ? (await sb.auth.getUser(jwt))?.data?.user : null;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const host = await hostOf(sb, room);
  if (!host || host !== user.id) {
    return Response.json({ error: "Only the person who created this meeting can edit its glossary." }, { status: 403 });
  }
  if (body?.terms === undefined) return Response.json({ terms: await readTerms(sb, host, room) });
  const terms = sanitizeGlossary(body.terms);
  const { error } = await sb.storage.from("recordings").upload(
    glossaryPath(host, room),
    new Blob([JSON.stringify({ terms, updated_at: new Date().toISOString() })], { type: "application/json" }),
    { upsert: true, contentType: "application/json" }
  );
  if (error) return Response.json({ error: "Couldn't save the glossary." }, { status: 500 });
  return Response.json({ terms });
}
