/**
 * MAYA GUARD — the weekly digest.
 *
 * Maya asks: "It's Monday. Did the thing I promised three weeks ago and never
 * did come back to me, or did it quietly age out of the list?"
 *
 * The carry-forward is the whole feature. A digest that only shows THIS week
 * is a diary; a digest that keeps showing you what you haven't done is a tool.
 * Everything below protects that, plus the grouping rules that decide whether
 * a busy week reads as a list or as a wall.
 *
 * Run: node lib/digest.test.mjs
 *
 * It imports the .ts directly — Node strips the types itself (22.18+/23+), so
 * there is no build step and no compiled copy to drift out of sync.
 */
import { build, group, clock, lastWeek, html, text, PROJECT_FALLBACK,
  pickActionItems, looksLikeATask } from "./digest.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const FROM = "2026-08-10T00:00:00.000Z";   // Mon
const TO   = "2026-08-16T23:59:59.999Z";   // Sun

let n = 0;
const it = (o) => ({
  id: `i${++n}`, project: "CRM Freeze", room_name: "qm-a", meeting_title: "CRM Freeze And Release Alignment",
  text: "Send Santosh the summary of deadline dates", owner: "Speaker 2", ts_seconds: 1698,
  status: "open", met_at: "2026-08-13T17:00:00.000Z", ...o,
});

// ── the carry-forward, which is the reason this exists ─────────────────────
const d = build([
  it({}),
  it({ id: "old1", text: "Publish the launch-readiness dates", met_at: "2026-07-29T17:00:00.000Z", room_name: "qm-old" }),
  it({ id: "done1", text: "Already handled", status: "done", met_at: "2026-08-12T17:00:00.000Z" }),
], FROM, TO);

ok(d.thisWeek.length === 1, "this week's items are grouped");
ok(d.carried.length === 1, "an item from THREE WEEKS AGO still comes back — it does not age out");
ok(d.carried[0].meetings[0].items[0].text.includes("launch-readiness"), "and it is the right one");
ok(d.openCount === 2, "the count is of OPEN items only");
ok(!JSON.stringify(d).includes("Already handled"), "something ticked off never appears again");

// ── grouping: project → meeting → items ────────────────────────────────────
const many = build([
  it({ project: "CRM Freeze", room_name: "qm-a", met_at: "2026-08-13T17:00:00.000Z" }),
  it({ project: "CRM Freeze", room_name: "qm-a", ts_seconds: 60, met_at: "2026-08-13T17:00:00.000Z" }),
  it({ project: "CRM Freeze", room_name: "qm-b", meeting_title: "Freeze Planning", met_at: "2026-08-14T17:00:00.000Z" }),
  it({ project: "Northern Light", room_name: "qm-c", meeting_title: "PMR Demo", met_at: "2026-08-11T17:00:00.000Z" }),
], FROM, TO);
ok(many.thisWeek[0].project === "CRM Freeze",
  "the project with the most open work sorts first — that's what you scroll to");
ok(many.thisWeek[0].meetings[0].title === "Freeze Planning",
  "inside a project, the newest meeting is first");
ok(many.thisWeek[0].meetings[1].items[0].ts_seconds === 60,
  "inside a meeting, items run in the order they were said");
ok(many.meetingCount === 3, "conversations are counted by ROOM, not by title");

// Two meetings that happen to share a name must not be merged.
const sameName = group([
  it({ room_name: "qm-a", meeting_title: "Standup", met_at: "2026-08-11T17:00:00.000Z" }),
  it({ room_name: "qm-b", meeting_title: "Standup", met_at: "2026-08-12T17:00:00.000Z" }),
]);
ok(sameName[0].meetings.length === 2,
  "two meetings called the same thing stay two meetings");

// A project nobody named still has somewhere to go.
const unnamed = group([it({ project: null }), it({ project: "   " })]);
ok(unnamed.length === 1 && unnamed[0].project === PROJECT_FALLBACK,
  "items with no project land in one bucket, not one bucket each");

// ── the clock a person reads ───────────────────────────────────────────────
ok(clock(1622) === "27:02", "27:02, like the recording shows it");
ok(clock(4501) === "1:15:01", "past an hour it grows an hour field");
ok(clock(0) === "00:00", "zero is a real timestamp, not a missing one");
ok(clock(null) === "" && clock(undefined) === "", "a missing timestamp renders as nothing, not NaN");

// ── the week boundary, tested instead of trusted ───────────────────────────
const w = lastWeek(new Date("2026-08-17T15:00:00.000Z"));  // a Monday
ok(w.from.startsWith("2026-08-10"), "Monday's digest covers the week that just ENDED, not the one starting");
ok(w.to.startsWith("2026-08-16"), "…through the Sunday before it");
const w2 = lastWeek(new Date("2026-08-16T23:00:00.000Z")); // a Sunday
ok(w2.from.startsWith("2026-08-03"), "run on a Sunday it still means the last complete week");

// ── the email itself ───────────────────────────────────────────────────────
const body = html(d, { intro: "Two things are still open.", links: { "qm-a": "https://x/v.mp4" }, appUrl: "https://quantlys-meeting.com" });
ok(body.includes("Still open from before"), "the carried section is LABELLED — an unlabelled list reads as this week's");
ok(body.includes("28:18"), "each item shows where in the recording it was said");
ok(body.includes("https://x/v.mp4#t=1698"), "and that timestamp is a link into the recording at that moment");
ok(body.includes("Aug 10 – Aug 16"), "the header names the week it covers");
ok(body.includes("/host"), "and it says where to tick things off");
ok(!body.includes("<script"), "nothing from a transcript is rendered as markup");
const nasty = html(build([it({ text: "<script>alert(1)</script> ship it" })], FROM, TO), { intro: "" });
ok(nasty.includes("&lt;script&gt;"), "a transcript that contains HTML is escaped, not executed");

const plain = text(d, "Two things are still open.");
ok(plain.includes("STILL OPEN FROM BEFORE"), "the plain-text version keeps the same sections");
ok(plain.includes("28:18"), "and the same timestamps");

// ── an empty week says so, rather than sending a blank ─────────────────────
const quiet = build([], FROM, TO);
ok(quiet.openCount === 0 && html(quiet, { intro: "" }).includes("Nothing new was committed"),
  "a quiet week is stated, not implied by an empty page");

// ── which commitments become rows (the 2026-08-17 field failure) ──────────
// The first real meeting produced 15 rows and not one was a task. These are
// verbatim from that recording.
const REAL_MARKS = [
  { text: "I I'll be I'll be out", owner: "Speaker 1", at: 52 },
  { text: "and that are properly set up securely.", owner: "Speaker 1", at: 178 },
  { text: "Yeah. But I'll I'll I'll outline", owner: "Speaker 1", at: 284 },
  { text: "all these to you. I'll send I'll send this back and we'll make some improvements to the billing server", owner: "Speaker 1", at: 286 },
  { text: "Okay. And I can have that update to you just to make sure the security questions are enabled", owner: "Speaker 1", at: 91 },
];

// With a model, its items are the rows and they inherit the timestamp.
const withModel = pickActionItems(
  ["Send the outline of the billing server improvements back to the team",
   "Confirm the security questions are enabled before the next review"],
  REAL_MARKS);
ok(withModel.length === 2, "the model's items are the rows, not the utterances");
ok(withModel[0].text.startsWith("Send the outline"), "and they read as tasks");
ok(withModel[0].at === 286, "each one inherits the timestamp of the moment it was said");
ok(withModel[1].at === 91, "…matched by meaning, not by order");
ok(withModel[0].owner === "Speaker 1", "and who said it");
ok(!withModel.some(x => x.text.includes("I'll I'll")), "no stenography survives into a row");

// A model item nothing in the transcript supports gets NO timestamp rather
// than a wrong one — a bad timestamp sends you to the wrong minute.
// One incidental word in common ("security") is NOT the same moment — a weak
// match must be refused, or the link jumps to the wrong minute of the call.
const noMatch = pickActionItems(["Renew the office parking permit and the security badges"], REAL_MARKS);
ok(noMatch[0].at === null,
  "one shared word is not a match — a weak link is worse than no link");
const trulyNone = pickActionItems(["Book the offsite venue"], REAL_MARKS);
ok(trulyNone[0].at === null, "and an item with nothing in common carries no timestamp either");

// Two items must not claim the same moment.
const twoClose = pickActionItems(
  ["Send the outline of the billing improvements", "Send this back with billing server notes"],
  REAL_MARKS);
ok(twoClose[0].at !== twoClose[1].at || twoClose[1].at === null,
  "two items never share one utterance");

// Without a model, only substantial utterances survive.
const noModel = pickActionItems([], REAL_MARKS);
ok(!noModel.some(x => x.text === "I I'll be I'll be out"), "a stutter is not an action item");
ok(!noModel.some(x => x.text.startsWith("and that are")), "a mid-clause fragment is not an action item");
ok(noModel.length >= 1, "…but a real commitment still gets through when there is no model");

ok(looksLikeATask("Send Santosh the summary of front-end deadline dates") === true,
  "a real task passes");
ok(looksLikeATask("I'll be out") === false, "four words is not a task");
ok(looksLikeATask("Yeah. Okay. Like, you know, I mean, well") === false, "filler is not a task");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
