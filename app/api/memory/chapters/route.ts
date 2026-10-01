// List / reorder Memory episodes (chapters) for a project.
//
// Each Memory-tagged recording is one episode of the book/show. Order is
// stored beside the Memory package as `{slug}.chapters.json`.

import { createClient } from "@supabase/supabase-js";
import {
  memoryChaptersPath, acceptChapterOrder, episodesFromSummaries,
} from "@/lib/memory-chapters";
import { loadProjectEpisodes } from "@/lib/memory-load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function authUser(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: Response.json({ error: "Server storage is not configured." }, { status: 503 }) };
  }
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return { error: Response.json({ error: "Please sign in." }, { status: 401 }) };
  return { sb, user };
}

export async function GET(req: Request) {
  const auth = await authUser(req);
  if ("error" in auth && auth.error) return auth.error;
  const { sb, user } = auth as any;

  const project = String(new URL(req.url).searchParams.get("project") || "").trim();
  if (!project) return Response.json({ error: "Which project?" }, { status: 400 });

  const { episodes, usedFallback } = await loadProjectEpisodes(sb, user, project);
  return Response.json({
    project,
    episodes,
    usedFallback,
    note: usedFallback
      ? "No session was tagged Memory yet — listing this project's recordings as chapters. Toggle Memory next time for a cleaner cut."
      : episodes.length
        ? "Chapters are Memory-mode recordings in this project. Reorder is saved for Build and clip export."
        : "No recordings for that project yet. Host a Memory-mode session, tag the project, record with captions, then End.",
  });
}

export async function POST(req: Request) {
  const auth = await authUser(req);
  if ("error" in auth && auth.error) return auth.error;
  const { sb, user } = auth as any;

  let body: any = {};
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }
  const project = String(body?.project || "").trim();
  if (!project) return Response.json({ error: "Which project?" }, { status: 400 });
  const order = acceptChapterOrder(body?.order);

  const { episodes, usedFallback } = await loadProjectEpisodes(sb, user, project);
  const allowed = new Set(episodes.map((e) => e.id));
  const cleaned = order.filter((id) => allowed.has(id));
  for (const e of episodes) {
    if (!cleaned.includes(e.id)) cleaned.push(e.id);
  }

  const doc = {
    project,
    order: cleaned,
    at: new Date().toISOString(),
  };
  try {
    await sb.storage.from("recordings").upload(
      memoryChaptersPath(user.id, project),
      new Blob([JSON.stringify(doc)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
  } catch (e: any) {
    return Response.json({ error: e?.message || "Could not save chapter order." }, { status: 502 });
  }

  const next = episodesFromSummaries(
    episodes.map((e) => ({
      path: e.path,
      title: e.title,
      room: e.room,
      at: e.at,
      sessionMode: e.sessionMode,
      audioPath: e.audioPath,
      videoPath: e.videoPath,
      durationSec: e.durationSec,
    })),
    cleaned
  );

  return Response.json({
    project,
    episodes: next,
    usedFallback,
    saved: true,
  });
}
