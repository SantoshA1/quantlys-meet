// The weekly digest: every commitment a project made this week, plus the ones
// still open from before, in one email on Monday morning.
//
// Why this and not "another summary": a summary tells you what a meeting was
// about, which you already know because you were in it. A digest tells you
// what is still owed — across every meeting, carried forward until somebody
// actually does it. That second thing is the reason people keep a tool open on
// a Monday, and it is the thing a per-meeting summary can never do.
//
// Three ways in, one code path:
//   · Vercel Cron (Monday 15:00 UTC)  → every host who has open items
//   · "Send me this week's digest"    → just the person asking, right now
//   · ?preview=1                      → the HTML, unsent, so you can look

import { createClient } from "@supabase/supabase-js";
import type { Item } from "@/lib/digest";
import { build, lastWeek, html as digestHtml, text as digestText, rangeLabel } from "@/lib/digest";
import { chooseModel } from "@/lib/model";

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

function appUrl(req: Request): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    new URL(req.url).origin
  );
}

/** One warm, honest sentence about the week. Optional: without a model the
 *  digest still ships, it just opens with the plain count instead of a line
 *  that reads like a person wrote it. */
async function intro(items: Item[], carried: number): Promise<string> {
  // "still open from this week" was wrong the first time it sent: the items
  // were from today, not from the week the header named. Say what is true of
  // the LIST, not of a date range the reader can't see.
  const plain =
    carried > 0
      ? `${items.length} still open — ${carried} of them carried over from earlier weeks.`
      : `${items.length} thing${items.length === 1 ? "" : "s"} still open.`;
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || !items.length) return plain;
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  // FIELD 2026-08-18: this used to hardcode "anthropic/claude-3.5-sonnet".
  // The vendor retired it, the key stayed valid, the setup check stayed
  // green, and every model-backed feature returned a 404 nobody could read.
  // Ask the provider what it actually has, then take the best of ours.
  const chosen = await chooseModel({ openrouter, key, wanted: process.env.NOTES_MODEL });
  const model = chosen.id;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content:
              "Below are the open action items across a team's meetings. Write ONE " +
              "short paragraph (2-3 sentences, under 60 words) that names the two or " +
              "three threads actually running through them and what would move them. " +
              "Write it to the person who owns this work, in plain language. Do not " +
              "list the items back, do not congratulate anyone, do not invent " +
              "anything that isn't below. Return the paragraph only.\n\n" +
              items.slice(0, 60).map((i) => `- ${i.text}`).join("\n"),
          },
        ],
      }),
    });
    if (!r.ok) return plain;
    const j: any = await r.json();
    const out = String(j?.choices?.[0]?.message?.content || "").trim();
    return out.slice(0, 600) || plain;
  } catch {
    return plain;
  }
}

async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.RESEND_FROM || "Quantlys Meeting <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  return r.ok;
}

/** Signed links so a timestamp in the email jumps into the recording. One per
 *  meeting, seven days — the same life as the digest itself. */
async function linksFor(sb: any, items: Item[]): Promise<Record<string, string>> {
  const byRoom = new Map<string, string>();
  for (const i of items) if (i.video_path && !byRoom.has(i.room_name)) byRoom.set(i.room_name, i.video_path);
  const out: Record<string, string> = {};
  for (const [room, path] of byRoom) {
    try {
      const { data } = await sb.storage.from("recordings").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) out[room] = data.signedUrl;
    } catch {
      /* a missing link costs a timestamp, not the digest */
    }
  }
  return out;
}

async function digestFor(
  sb: any,
  userId: string,
  email: string,
  now: Date,
  project: string | null,
  req: Request,
  dryRun: boolean
) {
  let q = sb
    .from("action_items")
    .select("id, project, room_name, meeting_title, text, owner, ts_seconds, status, met_at, video_path")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("met_at", { ascending: false })
    .limit(400);
  if (project) q = q.eq("project", project);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message, sent: false, open: 0 };

  const items = (data || []) as Item[];
  const { from, to } = lastWeek(now);
  const d = build(items, from, to);
  if (!d.openCount) return { ok: true, sent: false, open: 0, reason: "nothing open" };

  const line = await intro(items, d.carried.reduce((t, g) => t + g.meetings.reduce((x, m) => x + m.items.length, 0), 0));
  const links = await linksFor(sb, items);
  const url = appUrl(req);
  const body = digestHtml(d, { intro: line, links, appUrl: url });
  const plain = digestText(d, line);
  const subject = `${project || (d.projects.length === 1 ? d.projects[0] : "Action items")} · ${rangeLabel(from, to)} · ${d.openCount} open`;

  if (dryRun) return { ok: true, sent: false, open: d.openCount, subject, html: body };
  const sent = await send(email, subject, body, plain);
  return { ok: true, sent, open: d.openCount, subject, to: sent ? email : null };
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";
  const project = url.searchParams.get("project");
  const sb = admin();

  // A signed-in host asking for their own digest, now.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (user) {
    const out = await digestFor(sb, user.id, user.email || "", new Date(), project, req, preview);
    if (preview && (out as any).html) {
      return new Response((out as any).html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.json(out);
  }

  // Otherwise this must be the scheduled run. Vercel Cron sends a bearer of
  // CRON_SECRET; without one set, refuse rather than expose a send-to-everyone
  // button on the open internet.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Not for you." }, { status: 401 });
  }

  const now = new Date();
  const { data: owners } = await sb
    .from("action_items")
    .select("user_id")
    .eq("status", "open")
    .limit(5000);
  const ids = [...new Set((owners || []).map((o: any) => o.user_id))];

  const results: any[] = [];
  for (const id of ids) {
    try {
      const { data: u } = await sb.auth.admin.getUserById(id);
      const email = u?.user?.email || "";
      if (!email) {
        results.push({ id, sent: false, reason: "no email on the account" });
        continue;
      }
      results.push({ id, ...(await digestFor(sb, id, email, now, null, req, false)) });
    } catch (e: any) {
      results.push({ id, sent: false, error: e?.message || String(e) });
    }
  }
  return Response.json({ ok: true, people: ids.length, sent: results.filter((r) => r.sent).length, results });
}

// Vercel Cron issues a GET. Same code path, no second implementation to drift.
export async function GET(req: Request) {
  return POST(req);
}
