// Server-side mail. Resend is already how invites, notes and the digest go
// out. This wrapper is the one place a missing key is allowed to no-op:
// callers still persist the thing they were going to send, and a log line
// says why nothing left the building.
//
// RESEND_API_KEY  — required to actually send
// RESEND_FROM     — optional; defaults to the Resend onboarding address

export type Mail = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export type MailResult = {
  ok: boolean;
  skipped: boolean;
  error?: string;
  status?: number;
};

export function mailFrom(): string {
  return process.env.RESEND_FROM || "Quantlys Meeting <onboarding@resend.dev>";
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  if (!key) {
    console.warn(
      "[mailer] RESEND_API_KEY is unset — not sending.",
      { to, subject: mail.subject }
    );
    return { ok: false, skipped: true, error: "RESEND_API_KEY is unset" };
  }
  if (!to.length) return { ok: false, skipped: true, error: "No recipients" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mail.from || mailFrom(),
        to,
        reply_to: mail.replyTo || undefined,
        subject: mail.subject,
        html: mail.html,
        text: mail.text || undefined,
      }),
    });
    if (r.ok) return { ok: true, skipped: false, status: r.status };
    const detail = await r.text().catch(() => "");
    console.warn("[mailer] Resend refused the send", r.status, detail.slice(0, 240));
    return { ok: false, skipped: false, status: r.status, error: detail.slice(0, 240) };
  } catch (e: any) {
    console.warn("[mailer] could not reach the mail service", e?.message || e);
    return { ok: false, skipped: false, error: String(e?.message || e) };
  }
}
