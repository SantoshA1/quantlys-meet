// Inviting people to a meeting.
//
// FIELD 2026-08-17: the schedule flow had a date picker and a "Schedule it"
// button, and that was all. It produced a link and a calendar file — for the
// host to send, by hand, in some other app. Every other meeting tool on earth
// asks "who's coming?" at exactly that moment. Ours asked nothing, and nobody
// was ever told a meeting existed. Scheduling that invites no one is a
// reminder, not a meeting.
//
// Pure functions here, on purpose. Address parsing and the .ics are the two
// things that fail silently in a mail client you don't own, so they are the
// two things that get tested offline (lib/invite.test.mjs). Nothing in this
// file touches the network, the database, or the clock except by argument.

export type Person = { email: string };

export type InviteSpec = {
  title: string;
  startISO: string;
  minutes: number;
  link: string;
  organizer: string;          // the host's address
  attendees: string[];
  uid: string;                // stable per meeting, so a re-send REPLACES
  sequence?: number;          // bumped on each re-send, per RFC 5545
  note?: string;
  cancelled?: boolean;
  now?: string;               // injectable so the file is testable byte-for-byte
};

// ── who's coming ───────────────────────────────────────────────────────────
//
// People paste addresses out of anything: a calendar, a spreadsheet, a Slack
// message, an Outlook "To" line. So take commas, semicolons, newlines, tabs
// and spaces as separators, and understand `Name <addr>`, because that is what
// comes off a clipboard. Anything left that isn't an address is HANDED BACK,
// not dropped — an invite that silently skips a typo is how one person misses
// the meeting and nobody finds out until it starts.

const ADDR = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

export function parseEmails(raw: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  const chunks = String(raw || "")
    .split(/[,;\n\r\t]+|\s{2,}/)
    .flatMap((c) => (c.includes("<") ? [c] : c.split(/\s+/)))
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    // `Santosh Adari <sa@x.com>` → `sa@x.com`
    const angled = chunk.match(/<([^>]+)>/);
    const candidate = (angled ? angled[1] : chunk).replace(/^mailto:/i, "").trim().replace(/[.,;]+$/, "");
    if (!candidate) continue;
    if (!ADDR.test(candidate)) {
      bad.push(chunk);
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;   // inviting the same person twice sends two emails
    seen.add(key);
    ok.push(candidate);
  }
  return { ok, bad };
}

// ── the calendar file ──────────────────────────────────────────────────────

const escText = (t: string) =>
  String(t ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const stampUTC = (d: Date) =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 §3.1: no line over 75 OCTETS; continuations start with one space.
 *  Outlook is the one that actually enforces it — an unfolded DESCRIPTION with
 *  a long join URL comes through truncated, so the link in the invite is dead
 *  while the invite itself looks perfect. Fold on octets, never inside a
 *  multi-byte character, or a name with an accent in it corrupts the file. */
export function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;                       // first line 75, continuations 74 (+1 space)
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // never cut a UTF-8 sequence: back off while the next byte is a continuation
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return out.join("\r\n ");
}

export function icsInvite(spec: InviteSpec): string {
  const start = new Date(spec.startISO);
  const end = new Date(start.getTime() + Math.max(5, spec.minutes || 60) * 60000);
  const desc =
    (spec.note ? spec.note + "\n\n" : "") +
    "Join: " + spec.link + "\n" +
    "No account needed — one click, in the browser.";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Quantlys//Quantlys Meeting//EN",
    "CALSCALE:GREGORIAN",
    // REQUEST is what makes a mail client show Yes / No / Maybe instead of an
    // attachment nobody opens. PUBLISH would render as a file.
    `METHOD:${spec.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${spec.uid}`,
    `DTSTAMP:${stampUTC(spec.now ? new Date(spec.now) : new Date())}`,
    `DTSTART:${stampUTC(start)}`,
    `DTEND:${stampUTC(end)}`,
    `SEQUENCE:${Math.max(0, spec.sequence ?? 0)}`,
    `STATUS:${spec.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${escText(spec.title)}`,
    `DESCRIPTION:${escText(desc)}`,
    `LOCATION:${escText(spec.link)}`,
    `URL:${spec.link}`,
    `ORGANIZER;CN=${escText(spec.organizer)}:mailto:${spec.organizer}`,
    ...spec.attendees.map(
      (a) =>
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`
    ),
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ── the email a person actually reads ──────────────────────────────────────

const esc = (t: string) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Local-time-agnostic on purpose: the reader's own calendar app converts the
 *  .ics. What the BODY prints is UTC plus the name of the day, so a person
 *  skimming on a phone can sanity-check it without doing arithmetic. */
export function whenLabel(startISO: string): string {
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return "";
  return d.toUTCString().replace(/:\d\d GMT$/, " UTC");
}

export function inviteHtml(o: {
  title: string;
  startISO: string;
  link: string;
  organizer: string;
  note?: string;
  cancelled?: boolean;
}): string {
  const when = whenLabel(o.startISO);
  const head = o.cancelled ? "This meeting was cancelled" : "You're invited";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0d13;color:#e9edf5;padding:30px;max-width:560px;margin:0 auto">
  <div style="font-size:13px;color:#8b93a5;margin:0 0 4px">Quantlys Meeting</div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;color:#e9edf5">${esc(head)}</h1>
  <p style="font-size:15px;color:#cfd6e4;margin:0 0 20px;line-height:1.55">${esc(o.organizer)} invited you to <strong style="color:#e9edf5">${esc(o.title)}</strong>.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#141821;border:1px solid #262b36;border-radius:10px;margin:0 0 22px">
    <tr><td style="padding:16px 18px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b93a5;font-weight:700;margin:0 0 6px">When</div>
      <div style="font-size:16px;color:#e9edf5;margin:0 0 2px">${esc(when)}</div>
      <div style="font-size:12px;color:#8b93a5">Your calendar shows this in your own time zone — the invite is attached.</div>
    </td></tr>
  </table>
  ${o.note ? `<p style="font-size:15px;line-height:1.6;color:#cfd6e4;margin:0 0 22px">${esc(o.note)}</p>` : ""}
  ${
    o.cancelled
      ? `<p style="font-size:14px;color:#8b93a5;margin:0 0 22px">Nothing to do — it's already off your calendar if you accepted it.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
    <tr><td style="background:#00a99d;border-radius:8px">
      <a href="${esc(o.link)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#04120f;text-decoration:none">Join the meeting</a>
    </td></tr>
  </table>
  <p style="font-size:13px;color:#8b93a5;margin:0 0 6px;line-height:1.6">No account, no download — it opens in your browser.<br>The link works from now until the host ends it, so arriving early is fine.</p>
  <p style="font-size:12px;color:#6f7789;margin:0;word-break:break-all">${esc(o.link)}</p>`
  }
  <p style="font-size:12px;color:#6f7789;margin:28px 0 0;padding-top:16px;border-top:1px solid #262b36">
    This meeting may be recorded and turned into notes. You'll be told on the way in, before your camera or microphone is on.
  </p>
</div>`;
}

export function inviteText(o: {
  title: string;
  startISO: string;
  link: string;
  organizer: string;
  note?: string;
  cancelled?: boolean;
}): string {
  return [
    o.cancelled ? "CANCELLED" : "You're invited",
    "",
    `${o.organizer} invited you to ${o.title}.`,
    `When: ${whenLabel(o.startISO)} (your calendar will show your own time zone)`,
    o.note ? `\n${o.note}` : "",
    o.cancelled ? "" : `\nJoin: ${o.link}`,
    o.cancelled ? "" : "No account, no download — it opens in your browser.",
    "",
    "This meeting may be recorded and turned into notes. You'll be told on the way in.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** One subject line both paths agree on, so a re-send threads with the first. */
export function inviteSubject(title: string, startISO: string, cancelled = false): string {
  const d = new Date(startISO);
  const day = isNaN(d.getTime())
    ? ""
    : ` · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  return `${cancelled ? "Cancelled: " : "Invitation: "}${title}${day}`;
}
