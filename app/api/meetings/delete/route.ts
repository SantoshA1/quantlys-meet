// Deleting a meeting, and everything that belongs to it.
//
// FIELD 2026-08-17: "i cannot delete the meetings from Your Meetings". The
// list could be added to and never subtracted from. Every test call anyone had
// ever made was still sitting there, and the only control was "End" — which
// stops a meeting rather than removing it. A list that only grows stops being
// a list of your meetings and becomes a list of everything that has ever
// happened, which is a different and much less useful thing.
//
// Deleting properly means deleting the WHOLE thing. A row removed while its
// video file stays in storage is not a deletion, it is a leak with a tidy
// front end: the recording is still there, still costing money, still
// readable by anyone holding a signed link — and the person who pressed
// Delete believes it is gone. So the files go first, then the rows that point
// at them, and the answer says exactly what was removed.

import { createClient } from "@supabase/supabase-js";

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
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }
  const room = String(body?.room || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });

  // Yours, checked against the row. Never taken from the request.
  const { data: meeting, error: mErr } = await sb
    .from("meetings")
    .select("id, room_name, title, created_by, active")
    .eq("room_name", room)
    .maybeSingle();
  if (mErr) return Response.json({ error: `Couldn't look that meeting up: ${mErr.message}` }, { status: 502 });
  if (!meeting) return Response.json({ error: "It's already gone." }, { status: 404 });
  if ((meeting as any).created_by !== user.id) {
    return Response.json({ error: "That meeting isn't yours to delete." }, { status: 403 });
  }

  // A meeting people are still IN is not a meeting you delete out from under
  // them. End it first — that's a different button, and it's reversible in
  // the way this isn't.
  if ((meeting as any).active && !body?.force) {
    return Response.json(
      { error: "That meeting is still running. Press End first — deleting one people are in would drop them mid-sentence.", running: true },
      { status: 409 }
    );
  }

  const report: Record<string, unknown> = { room, title: (meeting as any).title };

  // 1. The FILES, before the rows that name them. Do it the other way round
  //    and a failure halfway leaves video in storage that nothing points at,
  //    which nobody will ever find again to delete.
  let filesRemoved = 0;
  const orphaned: string[] = [];
  try {
    const { data: recs } = await sb
      .from("recordings")
      .select("id, storage_prefix")
      .eq("room_name", room);
    for (const r of recs || []) {
      const prefix = String((r as any).storage_prefix || "");
      if (!prefix) continue;
      // FIELD 2026-08-18 (Conclave round 39): this asked for 200 files and
      // then behaved as though 200 were all of them. A meeting with more —
      // long sessions write video, audio and a sidecar per recording — would
      // report "deleted" while leaving files in storage with no row pointing
      // at them. Nobody would ever find those again. Page until a page comes
      // back short; that is the only answer that means "all of them".
      const paths: string[] = [];
      for (let offset = 0; offset < 5000; offset += 200) {
        const { data: listed } = await sb.storage
          .from("recordings")
          .list(prefix, { limit: 200, offset });
        const page = listed || [];
        paths.push(...page.map((f: any) => `${prefix}/${f.name}`));
        if (page.length < 200) break;
      }
      if (!paths.length) continue;
      // remove() itself takes a bounded list, so the deletion is paged too.
      let failed = false;
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await sb.storage.from("recordings").remove(paths.slice(i, i + 100));
        if (error) { failed = true; break; }
        filesRemoved += Math.min(100, paths.length - i);
      }
      if (failed) orphaned.push(prefix);
    }
    report.recordings = (recs || []).length;
  } catch (e: any) {
    report.storage_error = e?.message || String(e);
  }
  report.files_removed = filesRemoved;

  // If any file refused to go, stop. Better a meeting that is still listed
  // than a person told their recording was deleted when it wasn't.
  if (orphaned.length) {
    return Response.json(
      {
        error:
          `The meeting is still here on purpose: ${orphaned.length} recording file(s) couldn't be removed from storage, ` +
          "and deleting the row would have left them behind with nothing pointing at them. Try again in a moment.",
        ...report,
      },
      { status: 502 }
    );
  }

  // 2. The rows. Action items go too — an item from a meeting that no longer
  //    exists is a commitment nobody can trace back to what was said.
  try {
    const { data: items } = await sb
      .from("action_items")
      .delete()
      .eq("room_name", room)
      .eq("user_id", user.id)
      .select("id");
    report.action_items = (items || []).length;
  } catch (e: any) {
    report.items_error = e?.message || String(e);
  }

  try {
    await sb.from("recordings").delete().eq("room_name", room);
  } catch (e: any) {
    report.recordings_error = e?.message || String(e);
  }

  const { data: gone, error: dErr } = await sb
    .from("meetings")
    .delete()
    .eq("id", (meeting as any).id)
    .eq("created_by", user.id)
    .select("id");
  if (dErr) {
    return Response.json({ error: `Couldn't delete it: ${dErr.message}`, ...report }, { status: 502 });
  }
  if (!(gone || []).length) {
    return Response.json({ error: "It's already gone.", ...report }, { status: 404 });
  }

  return Response.json({ ok: true, deleted: true, ...report });
}
