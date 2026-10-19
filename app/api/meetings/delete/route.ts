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
import { RoomServiceClient } from "livekit-server-sdk";
import { meetingStoragePaths, prefixInScope, listTree, removePaths, stillThere } from "@/lib/recording-storage";

/** How many people are in the LiveKit room right now. null = could not ask
 *  (no LiveKit config, or the SFU did not answer). */
async function peopleInside(room: string): Promise<number | null> {
  const host = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_WS_URL || "";
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!host || !key || !secret) return null;
  try {
    const svc = new RoomServiceClient(host.replace(/^ws/, "http"), key, secret);
    const ps = await svc.listParticipants(room);
    return ps.length;
  } catch {
    return 0;   // no such room on the SFU = nobody is in it
  }
}

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
  // them. FIELD 2026-10-12: this used to test `meetings.active`, but End no
  // longer flips `active` (the row stays reusable; see session-end.test), so
  // EVERY meeting looked "still running" and Delete always answered 409 —
  // the row never left the list. Ask LiveKit who is actually inside instead.
  if (!body?.force) {
    const inside = await peopleInside(room);
    if (inside && inside > 0) {
      return Response.json(
        {
          error: `${inside} ${inside === 1 ? "person is" : "people are"} still in that meeting. Press End first — deleting it would drop them mid-sentence.`,
          running: true,
        },
        { status: 409 }
      );
    }
  }

  const report: Record<string, unknown> = { room, title: (meeting as any).title };
  const hostId = user.id;

  // 1. The FILES, before the rows that name them. Do it the other way round
  //    and a failure halfway leaves video in storage that nothing points at,
  //    which nobody will ever find again to delete.
  //
  // FIELD 2026-10-19: this only read `recordings` table rows (LiveKit Egress
  // bookkeeping). The in-browser recorder — every real meeting — never writes
  // one, so Delete removed the row, said "deleted", and left the video, the
  // audio copy and the transcript in `<hostId>/<room>/`. Now the host's own
  // folder for this room is the source of truth, and success is only reported
  // once a re-list shows it empty.
  const mine = await meetingStoragePaths(sb, hostId, room);
  if (mine.error) {
    return Response.json(
      { error: `Nothing was deleted: couldn't list this meeting's files (${mine.error}). Try again in a moment.`, ...report },
      { status: 502 }
    );
  }
  const paths = [...mine.paths];

  // Legacy Egress rows, if this deployment ever made any. Only prefixes inside
  // this host's folder (or an Egress-style `<room>/...`) are touched; a row
  // pointing anywhere else stops the delete rather than being guessed at.
  const { data: recs, error: rErr } = await sb
    .from("recordings")
    .select("id, storage_prefix")
    .eq("room_name", room);
  if (rErr) {
    return Response.json({ error: `Nothing was deleted: couldn't read this meeting's recordings (${rErr.message}).`, ...report }, { status: 502 });
  }
  for (const r of recs || []) {
    const prefix = String((r as any).storage_prefix || "").replace(/^\/+|\/+$/g, "");
    if (!prefix) continue;
    if (!prefixInScope(prefix, hostId, room)) {
      return Response.json(
        { error: "Nothing was deleted: a recording of this meeting is stored outside your folder, so it can't be removed safely from here.", ...report },
        { status: 409 }
      );
    }
    const tree = await listTree(sb, prefix);
    if (tree.error) {
      return Response.json({ error: `Nothing was deleted: couldn't list ${prefix} (${tree.error}).`, ...report }, { status: 502 });
    }
    for (const f of tree.files) if (!paths.includes(f.path)) paths.push(f.path);
  }
  report.recordings = (recs || []).length;

  const gone = await removePaths(sb, paths);
  report.files_removed = gone.removed;
  const check = gone.error ? { left: paths } : await stillThere(sb, paths);
  const left = check.left || [];
  if (gone.error || (check as any).error || left.length) {
    // If any file refused to go, stop. Better a meeting that is still listed
    // than a person told their recording was deleted when it wasn't.
    return Response.json(
      {
        error:
          `The meeting is still here on purpose: ${left.length || "some"} recording file(s) couldn't be removed from storage, ` +
          "and deleting the row would have left them behind with nothing pointing at them. Try again in a moment.",
        ...report,
        files_left: left.length,
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

  {
    const { error } = await sb.from("recordings").delete().eq("room_name", room);
    if (error) report.recordings_error = error.message;
  }

  const { data: rows, error: dErr } = await sb
    .from("meetings")
    .delete()
    .eq("id", (meeting as any).id)
    .eq("created_by", user.id)
    .select("id");
  if (dErr) {
    return Response.json({ error: `Couldn't delete it: ${dErr.message}`, ...report }, { status: 502 });
  }
  if (!(rows || []).length) {
    return Response.json({ error: "It's already gone.", ...report }, { status: 404 });
  }

  return Response.json({ ok: true, deleted: true, ...report });
}
