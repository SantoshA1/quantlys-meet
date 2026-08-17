// Send the invitation.
//
// FIELD 2026-08-17, from the person using it: "i see schedule option but no
// way to add user email id's". He was right. Scheduling wrote a row, copied a
// link to his clipboard and dropped an .ics in Downloads — and then stopped.
// Every guest still had to be told by hand, in some other app. A meeting tool
// whose invite step is "now go use email" has not scheduled anything.
//
// This route is the missing half: it takes the addresses, sends a real
// calendar invitation (METHOD:REQUEST, so mail clients show Yes / No / Maybe),
// and — the part that matters most — says out loud when it could NOT send.
// The one failure this app keeps being bitten by is the silent one.

import { createClient } from "@supabase/supabase-js";
import {
  parseEmails,
  icsInvite,
  inviteHtml,
  inviteText,
  inviteSubject,
} from "@/lib/invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_GUESTS = 40;

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

/** The address mail actually leaves from — and the reason a send gets refused,
 *  in the words of the person who has to fix it. */
function fromAddress(): { from: string; domain: string } {
  const from = process.env.RESEND_FROM || "Quantlys Meeting <onboarding@resend.dev>";
  const m = /<([^>]+)>/.exec(from);
  const address = (m ? m[1] : from).trim();
  return { from, domain: address.includes("@") ? address.split("@")[1].toLowerCase() : "" };
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

  // Addresses are parsed BEFORE anything else touches the database, so a typo
  // costs a re-type and not a half-sent invitation.
  const { ok: guests, bad } = parseEmails(String(body?.emails || ""));
  const cancel = Boolean(body?.cancel);
  if (!guests.length) {
    return Response.json(
      {
        error: bad.length
          ? `None of those look like email addresses: ${bad.slice(0, 5).join(", ")}`
          : "Add at least one email address.",
        bad,
      },
      { status: 400 }
    );
  }
  if (guests.length > MAX_GUESTS) {
    return Response.json(
      { error: `That's ${guests.length} people. This sends up to ${MAX_GUESTS} at a time — paste the rest as a second batch.` },
      { status: 400 }
    );
  }

  // It has to be your meeting. Checked against the row, never trusted from the
  // request — otherwise anyone signed in could send mail in someone else's name.
  const { data: meeting, error: mErr } = await sb
    .from("meetings")
    .select("id, room_name, title, created_by, scheduled_at, started_at, active")
    .eq("room_name", room)
    .maybeSingle();
  if (mErr) return Response.json({ error: `Couldn't look that meeting up: ${mErr.message}` }, { status: 502 });
  if (!meeting) return Response.json({ error: "No such meeting." }, { status: 404 });
  if ((meeting as any).created_by !== user.id) {
    return Response.json({ error: "That meeting isn't yours to invite people to." }, { status: 403 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return Response.json(
      {
        error:
          "RESEND_API_KEY isn't set in Vercel, so nothing can be emailed. The meeting is scheduled and its link works — copy it and send it yourself for now. Set the key in Vercel → Settings → Environment Variables, redeploy, and press Invite again.",
        scheduled: true,
        sent: 0,
        guests,
      },
      { status: 503 }
    );
  }

  const title = String((meeting as any).title || "Quantlys Meeting");
  const startISO =
    String(body?.startISO || "") ||
    (meeting as any).scheduled_at ||
    (meeting as any).started_at ||
    new Date().toISOString();
  const minutes = Math.min(600, Math.max(5, Number(body?.minutes) || 60));
  const note = String(body?.note || "").slice(0, 600);
  const link = `${appUrl(req)}/room/${room}`;

  // A re-send has to SUPERSEDE the first one, not sit beside it as a second
  // event. Same UID, higher SEQUENCE — that is the whole contract with every
  // calendar app. The column is best-effort: if the SQL step hasn't been run,
  // the invite still goes, it just can't count its own revisions.
  let sequence = 0;
  try {
    const { data: seqRow } = await sb
      .from("meetings")
      .select("invite_seq")
      .eq("id", (meeting as any).id)
      .maybeSingle();
    sequence = Number((seqRow as any)?.invite_seq ?? 0) + 1;
  } catch {
    /* no column yet — sequence stays 0 */
  }

  const ics = icsInvite({
    title,
    startISO,
    minutes,
    link,
    organizer: user.email || "",
    attendees: guests,
    uid: `${room}@quantlys-meeting.com`,
    sequence,
    note,
    cancelled: cancel,
  });

  const { from, domain } = fromAddress();
  let sent = 0;
  let failure = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: guests,
        reply_to: user.email || undefined,
        subject: inviteSubject(title, startISO, cancel),
        html: inviteHtml({ title, startISO, link, organizer: user.email || "", note, cancelled: cancel }),
        text: inviteText({ title, startISO, link, organizer: user.email || "", note, cancelled: cancel }),
        attachments: [
          {
            filename: "invite.ics",
            content: Buffer.from(ics, "utf8").toString("base64"),
            content_type: `text/calendar; method=${cancel ? "CANCEL" : "REQUEST"}; charset=utf-8`,
          },
        ],
      }),
    });
    if (r.ok) {
      sent = guests.length;
    } else {
      const detail = await r.text().catch(() => "");
      // The overwhelmingly common one, and it is invisible until the moment of
      // sending: the From domain was never verified at Resend.
      failure =
        r.status === 403 && domain && domain !== "resend.dev"
          ? `Resend refused the send because "${domain}" isn't a verified domain on your Resend account. Verify it at resend.com → Domains, or set RESEND_FROM to onboarding@resend.dev while you test.`
          : `Resend answered ${r.status}. ${detail.slice(0, 240)}`;
    }
  } catch (e: any) {
    failure = `Couldn't reach Resend: ${e?.message || String(e)}`;
  }

  // Remember who was asked — best-effort, and never at the cost of the invite.
  // Without it a re-send means retyping every address from memory.
  if (sent && !cancel) {
    try {
      const { data: prev } = await sb
        .from("meetings")
        .select("invited")
        .eq("id", (meeting as any).id)
        .maybeSingle();
      const merged = Array.from(
        new Set([...(((prev as any)?.invited as string[]) || []), ...guests].map((e) => e.toLowerCase()))
      );
      await sb
        .from("meetings")
        .update({ invited: merged, invite_seq: sequence, invited_at: new Date().toISOString() })
        .eq("id", (meeting as any).id);
    } catch {
      /* the invite went; remembering it is a convenience */
    }
  }

  if (failure) {
    return Response.json({ error: failure, sent: 0, guests, bad, link }, { status: 502 });
  }
  return Response.json({
    ok: true,
    sent,
    guests,
    bad,                    // typed-but-unsendable addresses come BACK, not dropped
    link,
    cancelled: cancel,
    from,
  });
}
