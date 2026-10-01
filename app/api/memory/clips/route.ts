// Memory audio clip plan — full episode audio + chapter/quote time ranges.
//
// Returns signed URLs to stored audio; the host UI cuts WAV clips in-browser
// (Vercel has no ffmpeg). Documents limits when timestamps are missing.

import { createClient } from "@supabase/supabase-js";
import { memoryPath } from "@/lib/memory";
import { buildClipPlan, MEMORY_CLIP_FORMAT_NOTE, type MemoryClip } from "@/lib/memory-chapters";
import { loadProjectEpisodes } from "@/lib/memory-load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }
  const project = String(body?.project || "").trim();
  if (!project) return Response.json({ error: "Which project?" }, { status: 400 });
  const focusEpisodeId = String(body?.episodeId || body?.chapterPath || "").trim();

  const { episodes, usedFallback } = await loadProjectEpisodes(sb, user, project);
  if (!episodes.length) {
    return Response.json({
      error: "No recordings for that project yet. Host a Memory-mode session, tag the project, record with captions, then End.",
    }, { status: 404 });
  }

  let packageChapters: any[] = [];
  let packageQuotes: string[] = [];
  try {
    const { data } = await sb.storage.from("recordings").download(memoryPath(user.id, project));
    if (data) {
      const pkg: any = JSON.parse(await data.text());
      packageChapters = Array.isArray(pkg?.chapters) ? pkg.chapters : [];
      packageQuotes = Array.isArray(pkg?.quotes) ? pkg.quotes : [];
    }
  } catch { /* package optional for full-episode downloads */ }

  const utterancesByPath: Record<string, any[]> = {};
  const needUtterances = packageQuotes.length > 0;
  const focus = focusEpisodeId || (episodes.length === 1 ? episodes[0].id : "");
  if (needUtterances && focus) {
    try {
      const { data } = await sb.storage.from("recordings").download(focus);
      if (data) {
        const j: any = JSON.parse(await data.text());
        utterancesByPath[focus] = Array.isArray(j?.utterances) ? j.utterances : [];
      }
    } catch { utterancesByPath[focus] = []; }
  }

  const { clips, limits } = buildClipPlan({
    episodes,
    packageChapters,
    packageQuotes,
    utterancesByPath,
    focusEpisodeId: focus || undefined,
  });

  const signed: Record<string, string> = {};
  const audioPaths = Array.from(
    new Set(clips.map((c) => c.audioPath).filter(Boolean) as string[])
  );
  for (const p of audioPaths) {
    try {
      const { data, error } = await sb.storage.from("recordings").createSignedUrl(p, 3600, {
        download: true,
      });
      if (!error && data?.signedUrl) signed[p] = data.signedUrl;
    } catch { /* leave unsigned */ }
  }

  const enriched: Array<MemoryClip & { url?: string }> = clips.map((c) => {
    const url = c.audioPath && signed[c.audioPath] ? signed[c.audioPath] : undefined;
    if (c.ready && c.audioPath && !url) {
      return { ...c, ready: false, limit: "Could not sign the audio URL for download." };
    }
    return { ...c, url };
  });

  return Response.json({
    project,
    usedFallback,
    focusEpisodeId: focus || null,
    clips: enriched,
    limits: [
      ...limits,
      MEMORY_CLIP_FORMAT_NOTE,
      "V1: chapter/quote cuts need mm:ss cues and/or timed transcript lines; otherwise use full episode audio.",
    ],
    format: "wav-for-cuts; original-for-full-episode",
  });
}
