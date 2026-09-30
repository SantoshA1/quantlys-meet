// Shareable project PRD — create / revoke / resolve.
//
// POST (signed-in host): enable | revoke | status for a project they own.
// GET  (public):         resolve an opaque share id to the public PRD body.
//
// The assessment stays under the owner's prefix. shares/{id}.json is only
// the pointer. Revoke deletes the pointer; the PRD file is untouched.

import { createClient } from "@supabase/supabase-js";
import { prdPath } from "@/lib/prd";
import {
  acceptShareMap, isShareId, publicPrdFromStored, shareMapPath, shareUrl,
} from "@/lib/prd-share";
import { randomHex } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function originOf(req: Request): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    new URL(req.url).origin
  ).replace(/\/$/, "");
}

async function readJson(sb: any, path: string): Promise<any | null> {
  try {
    const { data } = await sb.storage.from("recordings").download(path);
    if (!data) return null;
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function writeJson(sb: any, path: string, body: any): Promise<boolean> {
  try {
    const { error } = await sb.storage.from("recordings").upload(
      path,
      new Blob([JSON.stringify(body)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
    return !error;
  } catch {
    return false;
  }
}

async function removePath(sb: any, path: string): Promise<void> {
  try {
    await sb.storage.from("recordings").remove([path]);
  } catch {
    /* revoke must still succeed if the map was already gone */
  }
}

/** Public resolve — no auth. */
export async function GET(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const id = String(new URL(req.url).searchParams.get("id") || "").trim().toLowerCase();
  if (!isShareId(id)) {
    return Response.json({ error: "That share link is not valid." }, { status: 400 });
  }
  const sb = admin();
  const map = acceptShareMap(await readJson(sb, shareMapPath(id)));
  if (!map || map.shareId !== id) {
    return Response.json({ error: "That share link is gone or was turned off." }, { status: 404 });
  }
  const stored = await readJson(sb, prdPath(map.userId, map.project));
  // Stale map: PRD rebuilt without this shareId, or host revoked only the flag.
  if (!stored || String(stored.shareId || "").toLowerCase() !== id) {
    return Response.json({ error: "That share link is gone or was turned off." }, { status: 404 });
  }
  const pub = publicPrdFromStored(stored, map.project);
  if (!pub) {
    return Response.json({ error: "The PRD is not ready to share yet." }, { status: 404 });
  }
  return Response.json({ ...pub, shareId: id });
}

async function authedUser(req: Request) {
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  return { sb, user: who?.data?.user || null };
}

/** Host: enable / revoke / status. */
export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const { sb, user } = await authedUser(req);
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }
  const project = String(body?.project || "").trim();
  const action = String(body?.action || "status").trim().toLowerCase();
  if (!project) return Response.json({ error: "Which project?" }, { status: 400 });
  if (!["enable", "revoke", "status"].includes(action)) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  const path = prdPath(user.id, project);
  const stored = await readJson(sb, path);
  if (!stored) {
    return Response.json({
      error: "Build the PRD first — there is nothing to share yet.",
      sharing: false,
    }, { status: 404 });
  }

  const origin = originOf(req);
  const existingId = String(stored.shareId || "").trim().toLowerCase();

  if (action === "status") {
    const sharing = isShareId(existingId);
    return Response.json({
      sharing,
      shareId: sharing ? existingId : "",
      url: sharing ? shareUrl(origin, existingId) : "",
      project,
    });
  }

  if (action === "revoke") {
    if (isShareId(existingId)) await removePath(sb, shareMapPath(existingId));
    const next = { ...stored };
    delete next.shareId;
    delete next.sharedAt;
    await writeJson(sb, path, next);
    return Response.json({ sharing: false, shareId: "", url: "", project });
  }

  // enable — reuse an existing id when still mapped, else mint a new one.
  let shareId = isShareId(existingId) ? existingId : "";
  if (shareId) {
    const map = acceptShareMap(await readJson(sb, shareMapPath(shareId)));
    if (!map || map.userId !== user.id || map.project !== project) shareId = "";
  }
  if (!shareId) shareId = randomHex(24).toLowerCase();

  const at = new Date().toISOString();
  const mapOk = await writeJson(sb, shareMapPath(shareId), {
    shareId, userId: user.id, project, at,
  });
  if (!mapOk) {
    return Response.json({ error: "Couldn't create the share link. Try again." }, { status: 503 });
  }
  const next = { ...stored, shareId, sharedAt: at };
  await writeJson(sb, path, next);

  return Response.json({
    sharing: true,
    shareId,
    url: shareUrl(origin, shareId),
    project,
  });
}
