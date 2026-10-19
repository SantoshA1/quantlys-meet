// The nightly cleanup.
//
// FIELD 2026-08-17: `vercel.json` has scheduled this path since the app was
// built. The route did not exist. Every night at 04:00 UTC Vercel hit a 404,
// nothing happened, and nothing anywhere said so — a schedule pointing at
// nothing looks exactly like a schedule that works.
//
// What it does now is the promise the schema already made: `recordings` has an
// `expires_at` column that no code had ever read. A tool that keeps every
// meeting forever, silently, is one you find out about from a storage bill —
// and it's the wrong answer to "what happens to my data".

import { createClient } from "@supabase/supabase-js";
import { listTree, planRetention, removePaths, retentionDays, stillThere } from "@/lib/recording-storage";

const MAX_TAKES_PER_RUN = 500;

/** An Egress prefix is at least `<something>/<something>` — never "" or a
 *  bare owner folder, which would sweep a whole account. */
function safePrefix(p: string): boolean {
  const parts = p.split("/");
  return parts.length >= 2 && parts.every((s) => s && s !== "." && s !== "..");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, reason: "storage not configured" }, { status: 503 });
  }
  // Safe by DEFAULT. The first version let anyone run this when CRON_SECRET
  // was unset — a delete-things endpoint open to the internet, guarded by an
  // env var nobody had been told to set. A job that erases files has to fail
  // CLOSED, and say why, rather than quietly work for everybody.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET isn't set, so this job refuses to run — otherwise anyone with the URL could delete your recordings. Add CRON_SECRET in Vercel → Settings → Environment Variables (any long random string) and redeploy; Vercel sends it automatically on scheduled runs." },
      { status: 503 }
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Not for you." }, { status: 401 });
  }

  const sb = admin();
  const now = new Date().toISOString();
  const report: Record<string, unknown> = { ran_at: now };

  // 1a. Browser recordings past RECORDING_RETENTION_DAYS.
  //
  // FIELD 2026-10-19: /meetings printed "DELETES <date>" from this setting and
  // nothing ever deleted anything — the job below only read `recordings`
  // rows, which the in-browser recorder never writes. Now the job deletes the
  // same takes the page dates: video created_at + the window. Unset or 0
  // means OFF, matching the page's "No automatic deletion is configured".
  // `?dry=1` lists what is due and deletes nothing.
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  report.dry_run = dry;
  const days = retentionDays(process.env.RECORDING_RETENTION_DAYS);
  report.retention_days = days;
  try {
    const plan = await planRetention(sb, days, Date.now());
    if (plan.error) throw new Error(plan.error);
    // Bounded per night, oldest first, so one run can't run past maxDuration;
    // whatever is left is still due tomorrow.
    const due = plan.due.sort((a, b) => (a.created < b.created ? -1 : 1)).slice(0, MAX_TAKES_PER_RUN);
    report.takes_due = plan.due.length;
    if (dry) {
      report.would_delete = due.map((t) => ({ owner: t.owner, room: t.room, take: t.stem, created: t.created, files: t.paths.length, bytes: t.bytes }));
    } else {
      const paths = due.flatMap((t) => t.paths);
      const gone = await removePaths(sb, paths);
      if (gone.error) throw new Error(gone.error);
      const check = await stillThere(sb, paths);
      if (check.error) throw new Error(check.error);
      report.takes_deleted = due.length;
      report.take_files_removed = gone.removed;
      if (check.left.length) report.take_files_left = check.left.length;
    }
  } catch (e: any) {
    report.retention_error = e?.message || String(e);
  }

  // 1b. Legacy Egress rows past their stated expiry. The FILES go first — a
  //     row with no file behind it lists like a recording and 404s when you
  //     press play. A row is only removed once its files are confirmed gone.
  try {
    const { data: expired, error } = await sb
      .from("recordings")
      .select("id, storage_prefix")
      .lt("expires_at", now)
      .limit(200);
    if (error) throw error;
    report.expired_recordings = (expired || []).length;
    if (dry) {
      report.would_delete_rows = (expired || []).map((r: any) => ({ id: r.id, prefix: r.storage_prefix }));
    } else {
      let files = 0;
      const cleared: string[] = [];
      for (const r of expired || []) {
        const prefix = String((r as any).storage_prefix || "").replace(/^\/+|\/+$/g, "");
        if (prefix && !safePrefix(prefix)) continue;      // never walk the bucket root
        if (prefix) {
          const tree = await listTree(sb, prefix);
          if (tree.error) continue;
          const paths = tree.files.map((f) => f.path);
          const gone = await removePaths(sb, paths);
          if (gone.error) continue;
          const check = await stillThere(sb, paths);
          if (check.error || check.left.length) continue;
          files += gone.removed;
        }
        cleared.push((r as any).id);
      }
      if (cleared.length) {
        const { error: dErr } = await sb.from("recordings").delete().in("id", cleared);
        if (dErr) throw dErr;
      }
      report.expired_rows_deleted = cleared.length;
      report.files_removed = files;
    }
  } catch (e: any) {
    report.recordings_error = e?.message || String(e);
  }

  if (dry) return Response.json({ ok: true, ...report });

  // 2. Meetings nobody ended. Stamp ended_at so we know the last session
  //    went quiet on its own. The link still works — this is not meeting
  //    death, and we do not flip active false (that badge reads as dead).
  try {
    const stale = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from("meetings")
      .update({ ended_at: now })
      .lt("started_at", stale)
      .eq("active", true)
      .is("ended_at", null)
      .select("id");
    if (error) throw error;
    report.meetings_closed = (data || []).length;
  } catch (e: any) {
    report.meetings_error = e?.message || String(e);
  }

  // 3. Action items nobody has touched in a year. Kept generous on purpose:
  //    the whole point of the digest is that old commitments keep coming back.
  try {
    const year = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from("action_items")
      .delete()
      .lt("met_at", year)
      .eq("status", "done")
      .select("id");
    if (error) throw error;
    report.done_items_pruned = (data || []).length;
  } catch (e: any) {
    report.items_error = e?.message || String(e);
  }

  const failed = Boolean(report.retention_error || report.recordings_error);
  return Response.json({ ok: !failed, ...report }, { status: failed ? 500 : 200 });
}

export async function POST(req: Request) {
  return GET(req);
}
