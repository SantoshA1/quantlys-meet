// Shared Memory episode loading for chapters + clips + scoped Build.
// Uses Supabase; pure order/clip logic stays in memory-chapters.ts.

import { acceptSessionMode } from "@/lib/memory";
import {
  memoryChaptersPath, acceptChapterOrder, episodesFromSummaries,
  preferMemoryEpisodes, type MemoryEpisode,
} from "@/lib/memory-chapters";
import { durationSecondsFromSummary } from "@/lib/recording-flush";
import {
  myRooms, roomsForProject, resolveProject, roomFromPath, mayReadRecording, type MeetingRow,
} from "@/lib/scope";

const MAX_OWNERS = 40;
const norm = (s: any) => String(s || "").trim().toLowerCase();

async function listAll(sb: any, prefix: string, cap: number) {
  const out: any[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const r = await sb.storage.from("recordings").list(prefix, { limit: 100, offset });
    if (r.error) return out;
    const page = r.data ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/** Collect project recordings → episode rows (Memory preferred). */
export async function loadProjectEpisodes(
  sb: any,
  user: { id: string },
  project: string
): Promise<{ episodes: MemoryEpisode[]; usedFallback: boolean }> {
  let meetings: MeetingRow[] = [];
  try {
    const q = await sb
      .from("meetings")
      .select("room_name, title, project, created_by, started_at")
      .eq("created_by", user.id)
      .limit(500);
    meetings = (q.data as MeetingRow[]) || [];
  } catch { /* project column may not exist yet */ }

  const hosted = myRooms(meetings, user.id);
  const wanted = roomsForProject(meetings, user.id, project);

  const roots = await listAll(sb, "", 500);
  const others = roots.filter((f: any) => !f?.id && f?.name && f.name !== user.id).map((f: any) => f.name);
  const owners = [user.id, ...others.slice(0, MAX_OWNERS)];

  const paths: string[] = [];
  for (const owner of owners) {
    const rooms = await listAll(sb, owner, 1000);
    for (const r of rooms) {
      if (r?.id) continue;
      if (owner !== user.id && !wanted.some((w) => w === r.name)) continue;
      const files = await listAll(sb, `${owner}/${r.name}`, 1000);
      for (const x of files) {
        if (/\.summary\.json$/i.test(x?.name || "")) {
          const p = `${owner}/${r.name}/${x.name}`;
          if (mayReadRecording(p, hosted, user.id)) paths.push(p);
        }
      }
    }
  }

  const rows: Parameters<typeof episodesFromSummaries>[0] = [];
  for (const p of paths) {
    try {
      const { data } = await sb.storage.from("recordings").download(p);
      if (!data) continue;
      const j: any = JSON.parse(await data.text());
      const resolved = resolveProject(j?.project, roomFromPath(p) || String(j?.room || ""), meetings);
      if (norm(resolved.project) !== norm(project)) continue;
      const stem = p.replace(/\.summary\.json$/i, "");
      rows.push({
        path: p,
        title: String(j?.meetingTitle || j?.title || j?.room || "").trim(),
        room: String(j?.room || roomFromPath(p) || "").trim(),
        at: String(j?.at || j?.createdAt || "").trim() || p.split("/").pop()?.slice(0, 10) || "",
        sessionMode: acceptSessionMode(j?.sessionMode),
        audioPath: typeof j?.audioPath === "string" && j.audioPath ? String(j.audioPath) : null,
        videoPath: typeof j?.videoPath === "string" && j.videoPath ? String(j.videoPath) : `${stem}.webm`,
        videoHeight: Number(j?.video?.height) > 0 ? Number(j.video.height) : null,
        durationSec: durationSecondsFromSummary(j),
      });
    } catch { /* one bad sidecar must not cost the project */ }
  }

  let savedOrder: string[] = [];
  try {
    const { data } = await sb.storage.from("recordings").download(memoryChaptersPath(user.id, project));
    if (data) {
      const doc = JSON.parse(await data.text());
      savedOrder = acceptChapterOrder(doc?.order);
    }
  } catch { /* no saved order yet */ }

  const all = episodesFromSummaries(rows, savedOrder);
  const pref = preferMemoryEpisodes(all);
  return { episodes: pref.episodes, usedFallback: pref.usedFallback };
}
