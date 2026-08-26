/**
 * MAYA GUARD — whose meeting is this, and what may they read?
 *
 * Maya asks: "Sarath pressed Record. It's MY meeting. Why can't I build the
 * PRD from it?"
 *
 * FIELD 2026-08-26, from the live database rather than a screenshot:
 *   · five summary files across FOUR different owners, for the same handful
 *     of meetings — so a host saw only what they personally recorded;
 *   · the host console said "None of your recordings carry a project tag yet"
 *     while the dropdown beside it offered that very project, because one was
 *     reading the FILES and the other the MEETINGS;
 *   · every action item in the database was ticked off, and the digest said
 *     "nothing is open, so there is nothing to send" — true, and unhelpful.
 *
 * Run: node lib/scope.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  myRooms, roomsForProject, projectOfRoom, resolveProject,
  roomFromPath, ownerFromPath, mayReadRecording, digestState, digestMessage,
} from "./scope.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const MEETINGS = [
  { room_name: "qm-aaa", project: "Quantlys", created_by: "me", title: "Standup" },
  { room_name: "qm-bbb", project: null, created_by: "me", title: "Intro" },
  { room_name: "qm-ccc", project: "Quantlys", created_by: "someone", title: "Theirs" },
];

// ── 1. a meeting belongs to its host ─────────────────────────────────────
ok(myRooms(MEETINGS, "me").join() === "qm-aaa,qm-bbb", "the rooms I host, and only those");
ok(roomsForProject(MEETINGS, "me", "Quantlys").join() === "qm-aaa", "…narrowed to one project");
ok(roomsForProject(MEETINGS, "me", "quantlys").join() === "qm-aaa", "…case-insensitively, because people type project names by hand");
ok(myRooms(MEETINGS, "").length === 0 && roomsForProject(MEETINGS, "me", "").length === 0,
  "NEGATIVE CONTROL: no user and no project select NOTHING, never everything");
ok(!myRooms(MEETINGS, "me").includes("qm-ccc"), "and somebody else's meeting is never mine to read");

// ── 2. the tag that arrived after the recording ──────────────────────────
ok(projectOfRoom(MEETINGS, "qm-aaa") === "Quantlys", "a room's project comes from the meetings table");
ok(resolveProject("Quantlys", "qm-aaa", MEETINGS).source === "file",
  "when the FILE carries a tag that wins — somebody may have retagged the meeting since");
const rescued = resolveProject(null, "qm-aaa", MEETINGS);
ok(rescued.project === "Quantlys" && rescued.source === "meeting",
  "THE RESCUE: summaries only started carrying `project` on 2026-08-25 12:48 UTC. Every recording before that has no tag in its file, for ever — and none of them needs one, because the room is in the path and the meetings table knows that room's project");
ok(resolveProject(null, "qm-unknown", MEETINGS).source === "none",
  "NEGATIVE CONTROL: a room nobody has a meeting for resolves to nothing rather than to a guess");

// ── 3. reading by meeting, not by who pressed Record ─────────────────────
ok(roomFromPath("81ef68ea/qm-aaa/2026-08-01.summary.json") === "qm-aaa", "the room is in the storage path");
ok(ownerFromPath("81ef68ea/qm-aaa/x.summary.json") === "81ef68ea", "…and so is the owner");
ok(mayReadRecording("81ef68ea/qm-aaa/x.summary.json", myRooms(MEETINGS, "me"), "me") === true,
  "A COLLEAGUE'S RECORDING OF MY MEETING IS MINE TO READ. This is the whole fix: in the field there were five summaries across four owners, and a host could see only the ones they pressed Record on themselves");
ok(mayReadRecording("me/qm-zzz/x.summary.json", myRooms(MEETINGS, "me"), "me") === true,
  "…and my own recording is always mine, whatever room it was in");
ok(mayReadRecording("81ef68ea/qm-ccc/x.summary.json", myRooms(MEETINGS, "me"), "me") === false,
  "NEGATIVE CONTROL, and the one that matters: reading by MEETING must not become reading everything. Somebody else's recording of somebody else's meeting stays shut");
ok(mayReadRecording("81ef68ea/qm-private/x.summary.json", [], "me") === false, "a person who hosts nothing reads nothing");

// ── 4. three situations that were sharing one sentence ───────────────────
ok(digestState({ total: 4, open: 0 }) === "all-done", "everything ticked off is its own state");
ok(digestState({ total: 0, open: 0 }) === "none-at-all", "…and nothing ever captured is a different one, with a different answer");
ok(digestState({ total: 5, open: 2 }) === "have-some", "and any open item at all means it sends");
ok(digestState({ total: 99, open: 1 }) === "have-some",
  "…including one carried forward from weeks ago. CAUGHT WHILE WRITING THIS: my first version had a fourth state for 'open but not from this week', which cannot happen — the digest carries everything forward on purpose, and that is the whole reason it is not just another per-meeting summary");

ok(/working, not failing/.test(digestMessage("all-done", { total: 4, open: 0 })),
  "FINISHING YOUR WORK IS NOT AN ERROR. The old sentence made the good outcome read like a broken feature");
ok(/record a meeting/i.test(digestMessage("none-at-all", { total: 0, open: 0 })),
  "…while the one that IS a setup problem says what to do about it");
ok(digestMessage("have-some", { total: 5, open: 2 }) === "", "and there is nothing to say when it simply sends");

// ── 5. the wiring ────────────────────────────────────────────────────────
const prd = readFileSync(new URL("../app/api/prd/route.ts", import.meta.url), "utf8");
const dig = readFileSync(new URL("../app/api/digest/weekly/route.ts", import.meta.url), "utf8");
ok(/myRooms\(meetings, user\.id\)/.test(prd) && /mayReadRecording\(/.test(prd),
  "the PRD decides what to read from the meetings a person hosts");
ok(/resolveProject\(j\?\.project/.test(prd), "…and rescues a recording older than the tag");
ok(/owner !== user\.id && !wanted\.some/.test(prd),
  "…and only opens somebody else's folder for a room this person hosts. NEGATIVE CONTROL for the fix over-reaching into everyone's recordings");
ok(/in\("room_name", hosted/.test(dig), "the digest reads items from rooms I host, not only items I recorded");
ok(/digestMessage\(state/.test(dig), "…and says which of the three things happened");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
