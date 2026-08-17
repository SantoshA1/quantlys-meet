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

  // 1. Recordings past their stated expiry. The FILES go first — a row with no
  //    file behind it lists like a recording and 404s when you press play,
  //    which is a worse experience than either having it or not.
  try {
    const { data: expired } = await sb
      .from("recordings")
      .select("id, storage_prefix")
      .lt("expires_at", now)
      .limit(200);
    let files = 0;
    for (const r of expired || []) {
      const prefix = String((r as any).storage_prefix || "");
      if (!prefix) continue;
      const { data: listed } = await sb.storage.from("recordings").list(prefix, { limit: 100 });
      const paths = (listed || []).map((f: any) => `${prefix}/${f.name}`);
      if (paths.length) {
        const { error } = await sb.storage.from("recordings").remove(paths);
        if (!error) files += paths.length;
      }
    }
    if ((expired || []).length) {
      await sb.from("recordings").delete().in("id", (expired || []).map((r: any) => r.id));
    }
    report.expired_recordings = (expired || []).length;
    report.files_removed = files;
  } catch (e: any) {
    report.recordings_error = e?.message || String(e);
  }

  // 2. Meetings left "active" because everyone closed the tab rather than
  //    pressing End. A meeting that has been running for two days is not a
  //    meeting, and it keeps its room reachable and its code enumerable.
  try {
    const stale = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from("meetings")
      .update({ active: false, ended_at: now })
      .lt("started_at", stale)
      .eq("active", true)
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

  return Response.json({ ok: true, ...report });
}

export async function POST(req: Request) {
  return GET(req);
}
