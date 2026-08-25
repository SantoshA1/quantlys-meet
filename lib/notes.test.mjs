/**
 * MAYA GUARD — the meeting notes.
 *
 * Maya asks: "I missed the meeting. Can I read this in two minutes and know
 * what was discussed, what got decided, and what I now owe — without playing
 * the recording?"
 *
 * FIELD 2026-08-17: "AI intelligence is needed for users to adopt." What the
 * app produced was one paragraph and a flat list, which answers none of the
 * three questions above. These guards protect the SHAPE — and, more
 * importantly, protect against the failure that makes notes worse than
 * useless: a model that fills a gap by inventing something.
 *
 * Run: node lib/notes.test.mjs
 */
import {
  notesPrompt, parseNotes, notesHtml, notesText, notesSubject,
  rich, plain, hasShape, EMPTY,
  askPrompt, parseAnswer, timedTranscript, at,
} from "./notes.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const BASE = { ...EMPTY, overview: "old summary", actions: ["old action"], transcript: "t" };

const GOOD = JSON.stringify({
  title: "Conclave Cleanup And Payments",
  overview: "The team reviewed pricing and distribution, then spent most of the hour on the blocked payment integration.",
  topics: [
    { title: "Product positioning and pricing", points: [
      "Raghu framed the business around **value, price, and distribution**.",
      "He said pricing is already underway and distribution is the remaining focus.",
    ]},
    { title: "Payment integration", points: [
      "**Paddle** has been slow to respond and offers no phone support.",
      "If it is unresolved in **one or two days** they may move to **Stripe**.",
    ]},
  ],
  decisions: ["The team will not commit further code until repo ownership is clear."],
  actions: ["**Kiran** to finish the payment integration and the expense cleanup."],
  followups: ["Regroup tomorrow after the cleanup."],
});

const n = parseNotes(GOOD, BASE);

// ── the shape, which is the whole feature ─────────────────────────────────
ok(n.title === "Conclave Cleanup And Payments",
  "the meeting gets a real title — 'Team Meeting' is not findable six weeks later");
ok(n.topics.length === 2, "the conversation is broken into what it was actually about");
ok(n.topics[0].points.length === 2, "…each with the points that were made under it");
ok(n.decisions.length === 1 && n.actions.length === 1 && n.followups.length === 1,
  "decisions, actions and follow-ups are three different questions and stay three lists");
ok(hasShape(n), "and the renderer can tell structured notes from a fallback");

// ── the failure that matters more than any of it ──────────────────────────
ok(/Never invent/.test(notesPrompt("x")),
  "the prompt forbids inventing — a decision nobody made is worse than no notes, "
  + "because somebody will act on it");
ok(/empty array is a correct answer/.test(notesPrompt("x")),
  "…and says plainly that returning nothing is allowed");
ok(/Never guess a name/.test(notesPrompt("x")),
  "and it must not promote 'Speaker 2' into a person who was never named");
ok(notesPrompt("x").includes("TRANSCRIPT:"), "the transcript is labelled, not just appended");
ok(notesPrompt("y".repeat(200000)).length < 130000,
  "an enormous transcript is trimmed rather than sent whole and rejected");
ok(notesPrompt("x", "Weekly sync").includes("Weekly sync"),
  "the host's own title is offered as a hint");

// ── degrading, which is what actually happens in the field ────────────────
ok(parseNotes("I'm sorry, I can't do that", BASE).overview === "old summary",
  "prose instead of JSON keeps the notes we already had — never a blank page");
ok(parseNotes("", BASE).actions[0] === "old action", "an empty answer changes nothing");
ok(parseNotes("{ this is not json", BASE).overview === "old summary",
  "half an object is not a reason to lose the notes");
// The two cases above never reach JSON.parse — one has no brace, the other no
// closing brace, so both return early. This one gets all the way in and fails
// there, which is the path that actually runs when a model emits a trailing
// comma or a smart quote.
ok(parseNotes('{"title": "Nope",}', BASE).overview === "old summary",
  "malformed JSON that PARSES its way to a throw still keeps the old notes");
ok(parseNotes('{"title": "Nope",}', BASE).title === "",
  "…and does not half-apply it");
ok(parseNotes('```json\n{"title":"Fenced"}\n```', BASE).title === "Fenced",
  "a model that fences its JSON anyway is understood, not discarded");
ok(parseNotes('{"topics":"not an array"}', BASE).topics.length === 0,
  "a wrong-typed field is dropped, not rendered as a crash");
ok(parseNotes('{"topics":[{"title":"Empty"}]}', BASE).topics.length === 0,
  "a topic with no points is not a topic — an empty heading looks like a bug");
ok(parseNotes('{"actions":["  ", "", "Real one"]}', BASE).actions.length === 1,
  "blank strings never become bullet points");
ok(parseNotes(JSON.stringify({ topics: Array.from({length: 40}, (_, i) => ({title:`T${i}`, points:["p"]})) }), BASE).topics.length <= 12,
  "a runaway answer is capped — nobody reads forty sections");

// ── rendering ─────────────────────────────────────────────────────────────
const html = notesHtml(n, { room: "qm-a", watchUrl: "https://x/v.mp4", appUrl: "https://quantlys-meeting.com" });
ok(html.includes("Conclave Cleanup And Payments"), "the title leads");
ok(html.includes("What was discussed") && html.includes("Decisions and direction"),
  "the sections are labelled — that is what makes it skimmable");
ok(html.includes("1) Product positioning"), "topics are numbered the way a person would number them");
ok(html.includes("<strong>Paddle</strong>"), "the things that matter are bold");
ok(!/display\s*:\s*flex/.test(html.replace(/<!--[\s\S]*?-->/g, "")),
  "no flexbox — mail clients strip it and the notes collapse into one column");
ok(html.includes('role="presentation"'), "layout is tables, which every mail client agrees on");
ok(html.includes("Watch the recording"), "and there is one obvious way back to the video");

// A transcript is untrusted text. Somebody saying the word "script" in a
// meeting must not put markup in everyone's inbox.
const nasty = parseNotes(JSON.stringify({
  title: "<script>alert(1)</script>",
  topics: [{ title: "x", points: ["<img src=x onerror=alert(1)>"] }],
}), BASE);
const nastyHtml = notesHtml(nasty);
ok(!nastyHtml.includes("<script>") && nastyHtml.includes("&lt;script&gt;"),
  "a transcript that contains HTML is escaped, not executed");
// The right assertion is "no raw tag survives", not "the word onerror is
// absent" — inside escaped text those characters are inert, and a guard that
// greps for scary substrings fails on harmless output and passes on some
// dangerous output. Check for an actual element.
ok(!/<img/i.test(nastyHtml) && nastyHtml.includes("&lt;img"),
  "…including inside a bullet point: the tag arrives as text, never as an element");
ok(rich("**a** <b>x</b>") === "<strong>a</strong> &lt;b&gt;x&lt;/b&gt;",
  "escaping happens BEFORE the bold markers are read — the other order is an injection");

// Empty notes must read as empty, not as broken.
const bare = notesHtml({ ...EMPTY, title: "Quick sync" });
ok(bare.includes("Nothing was committed to out loud."),
  "a meeting where nobody promised anything says so");
ok(!bare.includes("What was discussed"),
  "…and shows no empty section headings, which is what makes a page look broken");

const txt = notesText(n);
ok(txt.includes("DECISIONS AND DIRECTION") && txt.includes("ACTION ITEMS"),
  "the plain-text version keeps the same sections");
ok(!txt.includes("**"), "and the bold markers are stripped, not printed as asterisks");
ok(txt.includes("1) Product positioning"), "topics stay numbered in plain text too");

ok(notesSubject(n, "qm-a").startsWith("Conclave Cleanup And Payments"),
  "the subject line names the meeting");
ok(notesSubject(n, "qm-a").includes("1 action item"), "…and how much is owed");
ok(notesSubject(EMPTY, "qm-a").includes("qm-a"),
  "with no title it still says something true rather than 'Untitled'");
ok(plain("**x** y") === "x y", "plain() strips markers without eating the words");

// ── speakers with names (the 2026-08-17 note) ─────────────────────────────
// Every set of notes said "Speaker 2". The app KNEW the names — everybody
// types one on the way in — and threw them away before the model saw them.
const withPeople = notesPrompt("x", "", ["Santosh", "Kiran", "Raghu"]);
ok(withPeople.includes("Santosh, Kiran, Raghu"),
  "the people in the room reach the model — a commitment made by a number is one nobody can chase");
ok(/KEEP the speaker\s+number/.test(withPeople),
  "…but an unclear speaker STAYS a number: a confident wrong name puts words in somebody's mouth");
ok(!notesPrompt("x").includes("The people in the room"),
  "with no roster the instruction is absent, not an empty sentence");

// ── ask the meeting a question ────────────────────────────────────────────
const AP = askPrompt("What did we decide about billing?", "[52s] Raghu: move to Stripe");
ok(AP.includes("QUESTION: What did we decide about billing?"), "the question is put plainly");
ok(AP.includes("ONLY the transcript"), "and the model is confined to the transcript");
ok(/set grounded to false/.test(AP),
  "…with an explicit way to say 'that did not come up' — the answer that makes this trustworthy");
ok(/do NOT soften a no into a maybe/.test(AP), "and it may not hedge its way out of saying so");
ok(askPrompt("q", "y".repeat(200000)).length < 130000, "a long transcript is trimmed, not rejected");

const good = parseAnswer('{"answer":"They leaned Stripe.","cites":[{"at":52,"who":"Raghu","quote":"move to Stripe"}],"grounded":true}');
ok(good.answer === "They leaned Stripe." && good.cites[0].at === 52,
  "an answer carries the second it came from");
ok(good.grounded === true, "…and counts as grounded");

// THE guard. A model that says "yes, definitely" while citing nothing is the
// failure that makes people stop trusting the feature — so grounded is not
// taken on its word.
const bluff = parseAnswer('{"answer":"Yes definitely.","cites":[],"grounded":true}');
ok(bluff.grounded === false,
  "claiming to have found something while pointing at nothing is NOT grounded");
ok(bluff.answer === "Yes definitely.",
  "…the answer is still shown, just not dressed up as evidence");

ok(parseAnswer("I can't answer that").grounded === false, "prose instead of JSON degrades cleanly");
ok(parseAnswer("").cites.length === 0, "and an empty answer never throws");
ok(parseAnswer('{"answer":"x","cites":[{"at":-5,"who":"","quote":"q"}]}').cites[0].at === 0,
  "a negative timestamp is clamped — you cannot scrub to minus ten seconds");
ok(parseAnswer('{"answer":"x","cites":[{"at":1,"quote":""}]}').cites.length === 0,
  "a citation with no quote is not a citation");
ok(parseAnswer(JSON.stringify({answer:"x",cites:Array.from({length:20},()=>({at:1,who:"a",quote:"q"}))})).cites.length <= 4,
  "and twenty citations is a wall, not evidence");

// FIELD 2026-08-25. The previous version of this row asserted that speaker 0
// plus a roster of ["Raghu","Kiran"] produced "Raghu" — which pinned the bug
// rather than the behaviour. Deepgram's "speaker 0" is whichever voice it
// happened to cluster first; the roster is whoever joined first. Those are
// unrelated, so that line put one person's name on another person's words —
// and this function feeds "ask this meeting a question", which answers with a
// named citation.
const tt = timedTranscript(
  [{ start: 52.4, speaker: 0, who: "Raghu", transcript: "We should move to Stripe if Paddle stalls" },
   { start: 61, speaker: 1, who: "Kiran", transcript: "ok" }],
  ["Raghu", "Kiran"]);
ok(tt.includes("[52s] Raghu:"), "every line carries its second and the name matched to that voice");

const guessed = timedTranscript(
  [{ start: 52.4, speaker: 0, transcript: "We should move to Stripe if Paddle stalls" }],
  ["Raghu", "Kiran"]);
ok(guessed.includes("[52s] Speaker 1:"),
  "NEGATIVE CONTROL: with no matched name it says Speaker 1 rather than picking a roster entry by index. A number is honest; the wrong person's name is a quote nobody said");
ok(!guessed.includes("Raghu") && !guessed.includes("Kiran"),
  "…and it names nobody at all when it cannot tell — this is the one failure worse than an anonymous line");

const only = timedTranscript(
  [{ start: 10, speaker: 0, transcript: "I'll do the billing cutover myself this week" }],
  ["Kiran"]);
ok(only.includes("Kiran:"),
  "a meeting with exactly one person in it has exactly one possible voice, so that one IS resolved");
ok(!tt.includes("[61s]"), "…and a two-word grunt is not a citable moment");
ok(timedTranscript([{ start: 5, speaker: 3, transcript: "a much longer line here" }]).includes("Speaker 4"),
  "with no names it falls back to the speaker number, not to blank");

ok(at(1698) === "28:18" && at(4501) === "1:15:01" && at(0) === "00:00",
  "the timestamp reads the way the recording shows it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
