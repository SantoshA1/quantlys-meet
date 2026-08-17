/**
 * MAYA GUARD — inviting people to a meeting.
 *
 * Maya asks: "I typed three email addresses and pressed Invite. Did three
 * people get a calendar invitation they can accept — or did I just make a
 * link that only I know about?"
 *
 * FIELD 2026-08-17: the schedule flow had no address field at all. The whole
 * of this file exists because of one sentence from the person using it: "i see
 * schedule option but no way to add user email id's."
 *
 * Run: node lib/invite.test.mjs
 * It imports the .ts directly — Node strips the types itself, so there is no
 * build step and no compiled copy to drift out of sync.
 */
import {
  parseEmails, fold, icsInvite, inviteHtml, inviteText, inviteSubject, whenLabel,
  senderLabel, rrule, describeRepeat, localParts,
} from "./invite.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// RFC 5545 unfolding: a CRLF followed by exactly one space is not there.
const unfold = (s) => s.replace(/\r\n[ \t]/g, "");

// ── who's coming: whatever the clipboard hands you ─────────────────────────
ok(parseEmails("a@x.com, b@y.com").ok.length === 2, "commas separate addresses");
ok(parseEmails("a@x.com; b@y.com").ok.length === 2, "so do semicolons — that's what Outlook copies");
ok(parseEmails("a@x.com\nb@y.com\r\nc@z.com").ok.length === 3, "and newlines, which is what a spreadsheet column gives you");
ok(parseEmails("a@x.com b@y.com").ok.length === 2, "and plain spaces");

const named = parseEmails('Santosh Adari <sa@x.com>, "Jo Kim" <jo@y.com>');
ok(named.ok.length === 2 && named.ok[0] === "sa@x.com",
  "a pasted “Name <address>” gives up the address, not a rejection");
ok(named.bad.length === 0, "…and nothing about that form is treated as a mistake");

ok(parseEmails("mailto:a@x.com").ok[0] === "a@x.com", "a mailto: link is an address");
ok(parseEmails("a@x.com, b@y.com.").ok[1] === "b@y.com", "a full stop at the end of a sentence isn't part of the address");

const dupes = parseEmails("A@X.com, a@x.com, a@x.COM");
ok(dupes.ok.length === 1, "the same person typed three ways is invited once, not three times");

// The one that matters: a typo must come BACK.
const typo = parseEmails("good@x.com, bad-address, alsobad@, @nope.com");
ok(typo.ok.length === 1, "the good address still goes");
ok(typo.bad.length === 3, "…and every one that can't be sent to is handed back");
ok(typo.bad.includes("bad-address"),
  "a mistyped address is REPORTED — silently dropping it is how one person misses the meeting");
ok(parseEmails("").ok.length === 0 && parseEmails("   ").ok.length === 0,
  "empty input is empty, not a crash");

// ── the calendar file: the part that breaks in a client you don't own ──────
const SPEC = {
  title: "CRM Freeze, Release Alignment; weekly",
  startISO: "2026-08-24T15:00:00.000Z",
  minutes: 45,
  link: "https://quantlys-meeting.com/room/qm-8f3ac21b9d04",
  organizer: "sa.nextgenai@gmail.com",
  attendees: ["a@x.com", "b@y.com"],
  uid: "qm-8f3ac21b9d04@quantlys-meeting.com",
  sequence: 2,
  now: "2026-08-17T19:00:00.000Z",
};
const ics = icsInvite(SPEC);

ok(ics.includes("METHOD:REQUEST"),
  "REQUEST — so the mail client offers Yes / No / Maybe instead of a file nobody opens");
ok((ics.match(/^ATTENDEE/gm) || []).length === 2, "one ATTENDEE line per person invited");
ok(/ORGANIZER;CN=[^:]*:mailto:sa\.nextgenai@gmail\.com/.test(ics), "and the host is the organiser");
ok(ics.includes("UID:qm-8f3ac21b9d04@quantlys-meeting.com"),
  "the UID is the room — so a re-send REPLACES the event instead of adding a second one");
ok(ics.includes("SEQUENCE:2"), "…and the sequence rises, which is what makes the replacement stick");
ok(ics.includes("DTSTART:20260824T150000Z") && ics.includes("DTEND:20260824T154500Z"),
  "45 minutes means it ends 45 minutes later, in UTC, unambiguously");
// Read it the way a calendar app does — unfolded. An ATTENDEE line is ~92
// octets, so RSVP=TRUE lands mid-fold; checking the raw text would fail here
// while the file is perfectly correct.
ok((unfold(ics).match(/RSVP=TRUE/g) || []).length === 2, "every guest can actually reply");
ok(ics.includes("BEGIN:VALARM") && ics.includes("TRIGGER:-PT10M"), "and it nudges them ten minutes before");

// Escaping. A title with a comma in it is not two fields.
ok(unfold(ics).includes("SUMMARY:CRM Freeze\\, Release Alignment\\; weekly"),
  "a comma or semicolon in the title is escaped, not read as a new field");

// Folding. THE failure: Outlook truncates a long line, so the join URL in the
// invitation is dead while the invitation itself looks perfect.
const long = "DESCRIPTION:" + "x".repeat(300);
const folded = fold(long);
ok(folded.includes("\r\n "), "a line over 75 octets is folded");
ok(folded.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75),
  "every physical line is inside the 75-octet limit — Outlook enforces it");
ok(unfold(folded) === long, "and unfolding gives back exactly what went in");
ok(fold("SUMMARY:short") === "SUMMARY:short", "a short line is left alone");

// A name with an accent must not be cut in half.
const accented = fold("SUMMARY:" + "é".repeat(80));
ok(accented.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75),
  "folding an accented line still respects octets, not characters");
ok(unfold(accented) === "SUMMARY:" + "é".repeat(80),
  "…and no character is split down the middle — a corrupt .ics opens as nothing at all");

ok(unfold(ics).includes(SPEC.link),
  "the join link survives folding whole — a truncated URL is an invitation to nowhere");

// The guard above passes whether or not the FILE was folded, because unfolding
// an unfolded string is a no-op. So check the file itself: this is the one
// that catches somebody quietly dropping .map(fold) from icsInvite.
ok(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75),
  "no line in the finished .ics is over 75 octets — the ATTENDEE and DESCRIPTION lines are longer than that unfolded");
ok(ics.split("\n").every((l) => l === "" || l.endsWith("\r")), "CRLF throughout, as the spec requires");
ok(ics.trimEnd().endsWith("END:VCALENDAR"), "and the file is closed properly");

// Cancelling is the same path, not a second implementation to drift.
const off = icsInvite({ ...SPEC, cancelled: true, sequence: 3 });
ok(off.includes("METHOD:CANCEL") && off.includes("STATUS:CANCELLED"),
  "cancelling takes it OFF the calendar rather than leaving a ghost");
ok(off.includes("SEQUENCE:3"), "…and it supersedes the invitation it cancels");

// ── the email a person reads ───────────────────────────────────────────────
const html = inviteHtml({
  title: "CRM Freeze",
  startISO: SPEC.startISO,
  link: SPEC.link,
  organizer: "sa.nextgenai@gmail.com",
});
ok(!/display\s*:\s*flex/.test(html.replace(/<!--[\s\S]*?-->/g, "")),
  "no flexbox — mail clients strip it, and the layout collapses into one line");
ok(html.includes('role="presentation"'), "layout is tables, which every mail client agrees on");
ok(html.includes(SPEC.link), "the join link is in the body too, for the client that hides attachments");
ok(html.includes("Join the meeting"), "there is one obvious thing to press");
ok(/recorded/i.test(html),
  "the invitation says the meeting may be recorded — being told AT the door is not consent given BEFORE it");

const nasty = inviteHtml({
  title: '<script>alert(1)</script>',
  startISO: SPEC.startISO, link: SPEC.link, organizer: "a@b.com",
});
ok(nasty.includes("&lt;script&gt;") && !nasty.includes("<script>"),
  "a meeting title is escaped — a host cannot put markup in someone else's inbox");

const cancelHtml = inviteHtml({
  title: "CRM Freeze", startISO: SPEC.startISO, link: SPEC.link,
  organizer: "a@b.com", cancelled: true,
});
ok(!cancelHtml.includes("Join the meeting"),
  "a cancellation has no Join button — there is nothing to join");
ok(/cancelled/i.test(cancelHtml), "and it says so plainly");

const txt = inviteText({ title: "CRM Freeze", startISO: SPEC.startISO, link: SPEC.link, organizer: "a@b.com" });
ok(txt.includes(SPEC.link), "the plain-text version carries the link as well");
ok(/recorded/i.test(txt), "…and the same recording notice");

ok(inviteSubject("CRM Freeze", SPEC.startISO).startsWith("Invitation: CRM Freeze"),
  "the subject line reads like an invitation in a full inbox");
ok(inviteSubject("CRM Freeze", SPEC.startISO).includes("Aug 24"), "…and names the day");
ok(inviteSubject("CRM Freeze", SPEC.startISO, true).startsWith("Cancelled:"), "a cancellation is obvious at a glance");

ok(whenLabel("not a date") === "", "a broken date renders as nothing, never as “Invalid Date”");
ok(whenLabel(SPEC.startISO).includes("24 Aug 2026"), "and a real one reads like a date a person would say");

// ── the time a person reads (the 2026-08-17 field note) ───────────────────
// The first invitation anyone received said "20:04 UTC" for a meeting set at
// 4:04 in the afternoon. Correct, and it asks the reader to do arithmetic —
// which is how somebody works out the wrong hour and misses it.
const ny = whenLabel(SPEC.startISO, "America/New_York");
ok(/11:00\s*AM/.test(ny), `the body prints the host's own clock, not UTC: ${ny}`);
ok(/EDT|EST|GMT-/.test(ny), `and names the zone, so nobody has to guess: ${ny}`);
ok(whenLabel(SPEC.startISO, "Asia/Kolkata").includes("8:30"),
  "a half-hour offset is handled, not rounded away");
ok(whenLabel(SPEC.startISO, "Not/AZone").includes("UTC"),
  "an unknown zone falls back to UTC — never to a guess, and never to nothing");
ok(!whenLabel(SPEC.startISO, "America/New_York").includes("Invalid"),
  "…and never to Invalid Date");

// The CALENDAR FILE stays UTC whatever the body says — that is the form every
// calendar app converts without argument.
ok(icsInvite({ ...SPEC }).includes("DTSTART:20260824T150000Z"),
  "the .ics is still UTC — the display zone must never leak into the event");

const tzHtml = inviteHtml({
  title: "CRM Freeze", startISO: SPEC.startISO, link: SPEC.link,
  organizer: "a@b.com", tz: "America/New_York",
});
ok(/11:00\s*AM/.test(tzHtml), "the email body shows it");
ok(tzHtml.includes("host's time zone"),
  "and says WHOSE clock that is — an unlabelled local time is the same trap in a new coat");
ok(inviteText({ title: "x", startISO: SPEC.startISO, link: SPEC.link, organizer: "a@b.com", tz: "America/New_York" }).includes("11:00"),
  "the plain-text version agrees with the HTML — two versions that disagree is a support ticket");

// A day boundary is the case that actually bites: 00:30 UTC on the 24th is
// still the EVENING OF THE 23rd in New York, and the subject line must say so.
ok(inviteSubject("Standup", "2026-08-24T00:30:00.000Z", false, "America/New_York").includes("Aug 23"),
  "the subject names the day in the host's zone, not the UTC day");
ok(inviteSubject("Standup", "2026-08-24T00:30:00.000Z").includes("Aug 24"),
  "…and without a zone it still says something true (UTC)");
ok(inviteSubject("Standup", "2026-08-24T00:30:00.000Z", false, "Not/AZone").includes("Aug 24"),
  "a bad zone never costs the subject its date");

// ── who it looks like it came from ────────────────────────────────────────
const FROM = "Quantlys Meeting <meetings@agilityserv.com>";
ok(senderLabel("santosh.adari@agilityserv.com", FROM).startsWith("Santosh Adari (via Quantlys Meeting)"),
  "the host's name leads — an invitation from a robot gets read like one");
ok(senderLabel("admin@agilityserv.com", FROM).includes("<meetings@agilityserv.com>"),
  "…but it still LEAVES from the verified address — sending as the host is a forgery that fails SPF");
ok(senderLabel("", FROM).includes("Quantlys Meeting"),
  "with no host address it falls back to the product name, not to an empty label");
ok(!senderLabel('we"ird<name>@x.com', FROM).includes('"'),
  "a quote in a display name would split the header and refuse the send — stripped");
ok(!/[<>]/.test(senderLabel('a<b>c@x.com', FROM).split("<")[0]),
  "…and so would an angle bracket");

// ── recurring: one event, a whole series ──────────────────────────────────
//
// FIELD 2026-08-17: "there is no way to set a recurring meeting". Every
// standup and every weekly had to be created by hand, one at a time.

// THE trap, and the reason this function takes a time zone at all. 8pm on a
// Monday in New York is 00:00 on TUESDAY in UTC. Read the weekday off the UTC
// date and the standup lands on Tuesdays forever.
const MON_EVE_NY = "2026-08-25T00:00:00.000Z";
ok(rrule({ freq: "WEEKLY" }, MON_EVE_NY, "America/New_York") === "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "a Monday-evening meeting recurs on MONDAYS — the weekday comes from the host's clock");
ok(rrule({ freq: "WEEKLY" }, MON_EVE_NY) === "RRULE:FREQ=WEEKLY;BYDAY=TU",
  "…and reading it off UTC gives Tuesday, which is exactly the bug the zone prevents");
ok(localParts(MON_EVE_NY, "America/New_York").day === 1, "localParts sees Monday");
ok(localParts(MON_EVE_NY).day === 2, "…and UTC sees Tuesday");

const TUE = "2026-08-18T15:00:00.000Z";
ok(rrule({ freq: "WEEKDAYS" }, TUE) === "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "'every weekday' is five days, not FREQ=DAILY — a daily standup on Sunday is a bug");
ok(rrule({ freq: "WEEKLY", interval: 2 }, TUE).includes("INTERVAL=2"), "every other week");
ok(!rrule({ freq: "WEEKLY", interval: 1 }, TUE).includes("INTERVAL"),
  "…and INTERVAL=1 is left out, because it is the default and noise in a file people debug");
ok(rrule({ freq: "MONTHLY" }, TUE, "America/New_York") === "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3",
  "monthly means 'the third Tuesday', not 'the 18th' — that is what keeps it off a weekend");
ok(rrule({ freq: "MONTHLY" }, "2026-08-31T15:00:00.000Z").includes("BYSETPOS=-1"),
  "the fifth week of a month is 'the last one', which every month has");
ok(rrule({ freq: "DAILY", count: 10 }, TUE).endsWith("COUNT=10"), "ends after N times");
ok(rrule({ freq: "DAILY", until: "2026-12-31T00:00:00Z" }, TUE).includes("UNTIL=20261231T000000Z"),
  "or on a date, in UTC with a Z as the spec requires");

// COUNT and UNTIL together is invalid RFC 5545. Outlook rejects the whole
// file, so the series silently never appears — the worst kind of failure.
const both = rrule({ freq: "DAILY", count: 5, until: "2026-12-31T00:00:00Z" }, TUE);
ok(both.includes("COUNT=5") && !both.includes("UNTIL="),
  "COUNT and UNTIL never appear together — a file with both is rejected outright");
ok(rrule(undefined, TUE) === "" && rrule({ freq: "" }, TUE) === "",
  "a one-off meeting carries no RRULE at all");
ok(!rrule({ freq: "DAILY", count: 99999 }, TUE).includes("99999"),
  "a runaway count is capped rather than booking a meeting until the heat death");

// It has to reach the calendar file.
const series = icsInvite({ ...SPEC, repeat: { freq: "WEEKLY" }, tz: "America/New_York" });
ok(unfold(series).includes("RRULE:FREQ=WEEKLY"), "the rule is IN the .ics, not just in the database");
ok(series.indexOf("RRULE") > series.indexOf("DTSTART"),
  "…and after DTSTART, which is what it is relative to");
ok(!icsInvite({ ...SPEC }).includes("RRULE"), "a one-off invitation has none (negative control)");

// A host cannot proof-read FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3.
ok(describeRepeat({ freq: "WEEKLY" }, MON_EVE_NY, "America/New_York") === "Every Monday",
  "the rule is shown in words before it is sent");
ok(describeRepeat({ freq: "MONTHLY" }, TUE, "America/New_York") === "Monthly on the third Tuesday",
  "…including the awkward one");
ok(describeRepeat({ freq: "WEEKLY", interval: 2, count: 6 }, TUE, "America/New_York")
  === "Every 2 weeks on Tuesday, 6 times", "with the interval and the end");
ok(describeRepeat(undefined, TUE) === "Doesn't repeat", "and a one-off says so");
ok(describeRepeat({ freq: "WEEKLY" }, MON_EVE_NY, "America/New_York").includes("Monday")
  && rrule({ freq: "WEEKLY" }, MON_EVE_NY, "America/New_York").includes("MO"),
  "the words and the rule agree — two descriptions that disagree is worse than either alone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
