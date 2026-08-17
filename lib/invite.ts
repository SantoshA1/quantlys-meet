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

/** FIELD 2026-08-17, from the first invitation anyone actually received: the
 *  body read "Tue, 18 Aug 2026 20:04 UTC" for a meeting the host had set at
 *  4:04 in the afternoon. Correct, and useless — a person skimming on a phone
 *  now has to know their own offset and do the subtraction, and the commonest
 *  outcome of asking someone to do arithmetic about a time is that they get
 *  it wrong and miss it.
 *
 *  The .ics still carries UTC, because that is the form every calendar app
 *  converts without argument. What the BODY prints is the time in the zone the
 *  meeting was ARRANGED in, named, so the reader can see at a glance whether
 *  it's their morning or their night. Falls back to UTC when the host's zone
 *  isn't known — never to a guess. */
export function whenLabel(startISO: string, tz?: string): string {
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return "";
  if (tz) {
    try {
      const shown = d.toLocaleString("en-US", {
        timeZone: tz, weekday: "short", day: "numeric", month: "short",
        year: "numeric", hour: "numeric", minute: "2-digit",
      });
      const zone =
        new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
          .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || tz;
      return `${shown} ${zone}`;
    } catch {
      /* an unknown zone name must not cost the invitation its date */
    }
  }
  return d.toUTCString().replace(/:\d\d GMT$/, " UTC");
}

export function inviteHtml(o: {
  title: string;
  startISO: string;
  link: string;
  organizer: string;
  note?: string;
  cancelled?: boolean;
  tz?: string;
}): string {
  const when = whenLabel(o.startISO, o.tz);
  const head = o.cancelled ? "This meeting was cancelled" : "You're invited";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0d13;color:#e9edf5;padding:30px;max-width:560px;margin:0 auto">
  <div style="font-size:13px;color:#8b93a5;margin:0 0 4px">Quantlys Meeting</div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;color:#e9edf5">${esc(head)}</h1>
  <p style="font-size:15px;color:#cfd6e4;margin:0 0 20px;line-height:1.55">${esc(o.organizer)} invited you to <strong style="color:#e9edf5">${esc(o.title)}</strong>.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#141821;border:1px solid #262b36;border-radius:10px;margin:0 0 22px">
    <tr><td style="padding:16px 18px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b93a5;font-weight:700;margin:0 0 6px">When</div>
      <div style="font-size:16px;color:#e9edf5;margin:0 0 2px">${esc(when)}</div>
      <div style="font-size:12px;color:#8b93a5">${o.tz ? "That's the host's time zone. Your" : "Your"} calendar shows this in your own — the invite is attached.</div>
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
  tz?: string;
}): string {
  return [
    o.cancelled ? "CANCELLED" : "You're invited",
    "",
    `${o.organizer} invited you to ${o.title}.`,
    `When: ${whenLabel(o.startISO, o.tz)} (your calendar will show your own time zone)`,
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
export function inviteSubject(title: string, startISO: string, cancelled = false, tz?: string): string {
  const d = new Date(startISO);
  let day = "";
  if (!isNaN(d.getTime())) {
    try {
      day = ` · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz || "UTC" })}`;
    } catch {
      day = ` · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
    }
  }
  return `${cancelled ? "Cancelled: " : "Invitation: "}${title}${day}`;
}


// ── who the invitation appears to be from ─────────────────────────────────
//
// FIELD 2026-08-17: the first invitation anyone received arrived as
// "Quantlys Meeting <meetings@agilityserv.com> on behalf of admin@…" — a mail
// client telling the truth in the least reassuring way available. We cannot
// send AS the host: that is a forged From, and SPF/DKIM would either fail it
// or land it in spam, which is a worse outcome than an odd-looking name.
//
// What we CAN do is put the host where a person looks. "Santosh Adari (via
// Quantlys Meeting)" is what an invitation from a service is supposed to read
// like, and it is what every calendar product does.
export function senderLabel(hostEmail: string, configuredFrom?: string): string {
  const configured = configuredFrom || "Quantlys Meeting <onboarding@resend.dev>";
  const m = /<([^>]+)>/.exec(configured);
  const address = (m ? m[1] : configured).trim();
  if (!address.includes("@")) return configured;
  const who = String(hostEmail || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!who) return `Quantlys Meeting <${address}>`;
  const name = who.replace(/\b\w/g, (c) => c.toUpperCase());
  // A quote or an angle bracket in a display name splits the header in two and
  // the send is refused — strip them rather than let one odd address break
  // every invitation that person sends.
  return `${name.replace(/["<>,;]/g, "")} (via Quantlys Meeting) <${address}>`;
}
