// Memory episode media: the continuous full video (signed download link) and
// captions (.vtt / .srt) for one episode of a project.
//
// Episodes come from loadProjectEpisodes, which already applies who-may-read
// rules — an episode id that isn't in that list is refused, never fetched.

import { createClient } from "@supabase/supabase-js";
import { loadProjectEpisodes } from "@/lib/memory-load";
import { episodeVideoCandidates, slugClipLabel } from "@/lib/memory-chapters";
import { acceptCaptionFormat, captionsFile, captionMime } from "@/lib/caption-export";
import { videoQualityLabel } from "@/lib/recording-quality";

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
  const episodeId = String(body?.episodeId || "").trim();
  const kind = String(body?.kind || "").trim();
  if (!project || !episodeId) return Response.json({ error: "Which project and episode?" }, { status: 400 });
  if (kind !== "video" && kind !== "captions") {
    return Response.json({ error: "Ask for video or captions." }, { status: 400 });
  }

  const { episodes } = await loadProjectEpisodes(sb, user, project);
  const ep = episodes.find((e) => e.id === episodeId);
  if (!ep) return Response.json({ error: "That episode isn't in this project." }, { status: 404 });
  const name = slugClipLabel(ep.title || ep.room || "episode");

  if (kind === "video") {
    for (const path of episodeVideoCandidates(ep)) {
      const ext = (path.match(/\.(mp4|webm)$/i)?.[1] || "mp4").toLowerCase();
      const { data, error } = await sb.storage.from("recordings").createSignedUrl(path, 3600, {
        download: `${name}.${ext}`,
      });
      if (!error && data?.signedUrl) {
        return Response.json({
          url: data.signedUrl,
          container: ext,
          quality: videoQualityLabel(ep.videoHeight),
          filename: `${name}.${ext}`,
        });
      }
    }
    return Response.json({
      error: "No video file behind this episode — it may have been an audio-only session, or the upload didn't finish.",
    }, { status: 404 });
  }

  const format = acceptCaptionFormat(body?.format);
  let lines: any[] = [];
  try {
    const { data } = await sb.storage.from("recordings").download(ep.path);
    if (data) {
      const j: any = JSON.parse(await data.text());
      lines = Array.isArray(j?.utterances) ? j.utterances : [];
    }
  } catch { /* fall through to the empty answer */ }
  const text = captionsFile(lines, format);
  if (!lines.length || text.replace(/^WEBVTT\s*/, "").trim() === "") {
    return Response.json({
      error: "No timed caption lines for this episode — record with captions on (or let transcription finish) to get .vtt / .srt.",
    }, { status: 404 });
  }
  return new Response(text, {
    headers: {
      "Content-Type": captionMime(format),
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
