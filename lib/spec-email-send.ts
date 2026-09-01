// The one-shot send: End (or a recording that finished after End) looks
// for a markdown PRD, mails approved people, and stamps sentAt so it
// cannot fire twice for the same session.

import { createHmac } from "node:crypto";
import { sendMail } from "@/lib/mailer";
import {
  recipientsForSend, shouldSend, specSubject, specEmailHtml, specEmailText,
  sessionPrdMarkdown, specFilename, normalizeEmail, type SpecRequest,
} from "@/lib/spec-email";

function secret(): string {
  return (
    process.env.SPEC_EMAIL_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

export function specToken(meetingId: string, email: string, purpose: "dl" | "unsub"): string {
  const s = secret();
  const body = `${purpose}:${meetingId}:${normalizeEmail(email)}`;
  if (!s) return Buffer.from(body).toString("base64url");
  return createHmac("sha256", s).update(body).digest("hex").slice(0, 32);
}

export function specTokenOk(meetingId: string, email: string, purpose: "dl" | "unsub", token: string): boolean {
  const want = specToken(meetingId, email, purpose);
  return Boolean(token) && token === want;
}

export function appUrl(req?: Request): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (req ? new URL(req.url).origin : "")
  );
}

async function latestSummary(sb: any, ownerId: string, room: string): Promise<any | null> {
  const prefix = `${ownerId}/${room}`;
  const listed = await sb.storage.from("recordings").list(prefix, { limit: 100 });
  const files = (listed.data || [])
    .filter((f: any) => String(f?.name || "").endsWith(".summary.json"))
    .sort((a: any, b: any) => String(b?.name || "").localeCompare(String(a?.name || "")));
  if (!files.length) return null;
  const path = `${prefix}/${files[0].name}`;
  const got = await sb.storage.from("recordings").download(path);
  if (got.error || !got.data) return null;
  try {
    return JSON.parse(await got.data.text());
  } catch {
    return null;
  }
}

export async function findSessionPrd(
  sb: any,
  meeting: { created_by: string; room_name: string; title?: string | null }
): Promise<{ markdown: string; filename: string } | null> {
  const notes = await latestSummary(sb, meeting.created_by, meeting.room_name);
  if (!notes) return null;
  const md = sessionPrdMarkdown(notes, String(meeting.title || meeting.room_name));
  if (!md) return null;
  return { markdown: md, filename: specFilename(String(meeting.title || "spec")) };
}

export async function sendSpecIfDue(
  sb: any,
  meetingId: string,
  origin: string
): Promise<{ sent: boolean; reason?: string; to?: string[] }> {
  let meeting: any = null;
  const full = await sb
    .from("meetings")
    .select("id, room_name, title, created_by, ended_at, spec_email_on, spec_email_host_copy, spec_email_host_address, spec_email_sent_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (!full.error) meeting = full.data;
  else {
    const basic = await sb.from("meetings").select("id, room_name, title, created_by, ended_at").eq("id", meetingId).maybeSingle();
    meeting = basic.data;
  }
  if (!meeting) return { sent: false, reason: "no_meeting" };

  const { data: rows } = await sb
    .from("spec_email_requests")
    .select("id, email, display_name, status, requested_at")
    .eq("meeting_id", meetingId);

  const requests: SpecRequest[] = ((rows || []) as any[]).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.display_name || "",
    status: r.status,
    requestedAt: r.requested_at,
  }));

  const settings = {
    on: Boolean(meeting.spec_email_on),
    hostCopy: meeting.spec_email_host_copy !== false,
    hostEmail: String(meeting.spec_email_host_address || ""),
    sentAt: meeting.spec_email_sent_at || null,
    endedAt: meeting.ended_at || null,
    requests,
  };
  const to = recipientsForSend(settings);
  const prd = await findSessionPrd(sb, meeting);
  if (!shouldSend({
    on: settings.on,
    hasPrd: Boolean(prd),
    alreadySent: Boolean(settings.sentAt),
    recipientCount: to.length,
  })) {
    return { sent: false, reason: !settings.on ? "off" : settings.sentAt ? "already" : !prd ? "no_prd" : "no_recipients" };
  }

  const hostUser = await sb.auth.admin.getUserById(meeting.created_by).catch(() => null);
  const hostLabel = hostUser?.data?.user?.email || settings.hostEmail || "the host";
  const filename = prd!.filename;
  const specPath = `${meeting.created_by}/${meeting.room_name}/${filename}`;
  try {
    await sb.storage.from("recordings").upload(
      specPath,
      new Blob([prd!.markdown], { type: "text/markdown; charset=utf-8" }),
      { upsert: true, contentType: "text/markdown; charset=utf-8" }
    );
  } catch { /* download route can still stream from the markdown we have */ }

  const stamped = new Date().toISOString();
  // Stamp first so a retry cannot double-send even if Resend is slow.
  await sb.from("meetings").update({ spec_email_sent_at: stamped }).eq("id", meetingId);

  let any = false;
  for (const email of to) {
    const downloadUrl = `${origin}/api/spec-email/download?meeting=${encodeURIComponent(meetingId)}&email=${encodeURIComponent(email)}&t=${specToken(meetingId, email, "dl")}`;
    const unsubUrl = `${origin}/api/spec-email/unsubscribe?meeting=${encodeURIComponent(meetingId)}&email=${encodeURIComponent(email)}&t=${specToken(meetingId, email, "unsub")}`;
    const r = await sendMail({
      to: email,
      subject: specSubject(String(meeting.title || meeting.room_name)),
      html: specEmailHtml({
        meetingTitle: String(meeting.title || meeting.room_name),
        hostLabel,
        downloadUrl,
        unsubUrl,
      }),
      text: specEmailText({
        meetingTitle: String(meeting.title || meeting.room_name),
        hostLabel,
        downloadUrl,
        unsubUrl,
      }),
    });
    if (r.ok) any = true;
  }
  return { sent: any, to };
}
