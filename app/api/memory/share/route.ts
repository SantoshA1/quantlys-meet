// Shareable Memory package — create / revoke / resolve. Mirrors /api/prd/share.

import { createClient } from "@supabase/supabase-js";
import { memoryPath } from "@/lib/memory";
import {
  acceptMemoryShareMap, isMemoryShareId, publicMemoryFromStored,
  memoryShareMapPath, memoryShareUrl,
} from "@/lib/memory-share";
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
  } catch { /* ok */ }
}

export async function GET(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const id = String(new URL(req.url).searchParams.get("id") || "").trim().toLowerCase();
  if (!isMemoryShareId(id)) {
    return Response.json({ error: "That share link is not valid." }, { status: 400 });
  }
  const sb = admin();
  const map = acceptMemoryShareMap(await readJson(sb, memoryShareMapPath(id)));
  if (!map || map.shareId !== id) {
    return Response.json({ error: "That share link is gone or was turned off." }, { status: 404 });
  }
  const stored = await readJson(sb, memoryPath(map.userId, map.project));
  if (!stored || String(stored.shareId || "").toLowerCase() !== id) {
    return Response.json({ error: "That share link is gone or was turned off." }, { status: 404 });
  }
  const pub = publicMemoryFromStored(stored, map.project);
  if (!pub) {
    return Response.json({ error: "The Memory package is not ready to share yet." }, { status: 404 });
  }
  return Response.json({ ...pub, shareId: id });
}

async function authedUser(req: Request) {
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  return { sb, user: who?.data?.user || null };
}

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

  const path = memoryPath(user.id, project);
  const stored = await readJson(sb, path);
  if (!stored) {
    return Response.json({
      error: "Build the Memory package first — there is nothing to share yet.",
      sharing: false,
    }, { status: 404 });
  }

  const origin = originOf(req);
  const existingId = String(stored.shareId || "").trim().toLowerCase();

  if (action === "status") {
    const sharing = isMemoryShareId(existingId);
    return Response.json({
      sharing,
      shareId: sharing ? existingId : "",
      url: sharing ? memoryShareUrl(origin, existingId) : "",
      project,
    });
  }

  if (action === "revoke") {
    if (isMemoryShareId(existingId)) await removePath(sb, memoryShareMapPath(existingId));
    const next = { ...stored };
    delete next.shareId;
    delete next.sharedAt;
    await writeJson(sb, path, next);
    return Response.json({ sharing: false, shareId: "", url: "", project });
  }

  let shareId = isMemoryShareId(existingId) ? existingId : "";
  if (shareId) {
    const map = acceptMemoryShareMap(await readJson(sb, memoryShareMapPath(shareId)));
    if (!map || map.userId !== user.id || map.project !== project) shareId = "";
  }
  if (!shareId) shareId = randomHex(24).toLowerCase();

  const at = new Date().toISOString();
  const mapOk = await writeJson(sb, memoryShareMapPath(shareId), {
    shareId, userId: user.id, project, at, kind: "memory",
  });
  if (!mapOk) {
    return Response.json({ error: "Couldn't create the share link. Try again." }, { status: 503 });
  }
  const next = { ...stored, shareId, sharedAt: at };
  await writeJson(sb, path, next);

  return Response.json({
    sharing: true,
    shareId,
    url: memoryShareUrl(origin, shareId),
    project,
  });
}
