// Whose meeting is this, and which recordings belong to it?
//
// FIELD 2026-08-26, from real data rather than a screenshot. The host console
// said "None of your recordings carry a project tag yet" while the dropdown
// right beside it offered a project called Quantlys. Both were reading real
// data. They disagreed because they were reading DIFFERENT data:
//
//   · the dropdown reads meetings.project — the tag somebody typed;
//   · the PRD reads the project field inside each summary FILE.
//
// Two separate faults fell out of that, and the second is the one that
// matters for a team:
//
//  1. THE TAG WAS YOUNGER THAN THE RECORDINGS. Summaries only started
//     carrying `project` on 2026-08-25 12:48 UTC. Every recording made before
//     that has no tag in its file, for ever, and no amount of re-tagging the
//     meeting fixes a file that was already written. The room name is in the
//     summary AND in its storage path, so the tag can simply be looked up
//     instead — an old recording becomes usable with no backfill at all.
//
//  2. RECORDINGS BELONG TO WHOEVER PRESSED RECORD. Storage paths are
//     `<userId>/<room>/…`, and the PRD only ever listed the signed-in
//     person's own prefix. In the field there were FIVE summaries across FOUR
//     different owners for the same handful of meetings — so a host building
//     a PRD saw only the meetings they personally recorded and silently
//     missed every one a colleague recorded. The same shape bites the weekly
//     digest, whose action items are keyed by user_id for the same reason.
//
// THE RULE: a meeting belongs to its HOST. What the host may read is decided
// by who created the meeting, not by who happened to hit the button.
//
// ZERO-IMPORT, so the ownership rules can be argued with in a test.

export type MeetingRow = {
  room_name?: string;
  title?: string | null;
  project?: string | null;
  created_by?: string | null;
  started_at?: string | null;
};

const norm = (s: any) => String(s || "").trim().toLowerCase();
const clean = (s: any) => String(s || "").trim();

/** The rooms a person is allowed to build a PRD from: the ones they host.
 *  Never every room in the database — a shared Supabase project is still a
 *  building with locked doors. */
export function myRooms(meetings: MeetingRow[], userId: string): string[] {
  const me = clean(userId);
  if (!me) return [];
  return (meetings || [])
    .filter((m) => clean(m?.created_by) === me && clean(m?.room_name))
    .map((m) => clean(m.room_name));
}

/** …and of those, the ones on a given project. */
export function roomsForProject(meetings: MeetingRow[], userId: string, project: string): string[] {
  const want = norm(project);
  if (!want) return [];
  const me = clean(userId);
  return (meetings || [])
    .filter((m) => clean(m?.created_by) === me && norm(m?.project) === want && clean(m?.room_name))
    .map((m) => clean(m.room_name));
}

/** THE FALLBACK THAT RESCUES EVERY OLD RECORDING. A summary written before
 *  2026-08-25 has no project inside it — but it knows its room, and the
 *  meetings table knows that room's project. */
export function projectOfRoom(meetings: MeetingRow[], room: string): string {
  const r = norm(room);
  if (!r) return "";
  const hit = (meetings || []).find((m) => norm(m?.room_name) === r);
  return clean(hit?.project);
}

/** The project a recording belongs to: what the file says, or — when the file
 *  predates the tag — what the meeting says. The file wins when it has an
 *  answer, because somebody could have retagged the meeting since. */
export function resolveProject(
  fromFile: string | null | undefined,
  room: string,
  meetings: MeetingRow[]
): { project: string; source: "file" | "meeting" | "none" } {
  const f = clean(fromFile);
  if (f) return { project: f, source: "file" };
  const m = projectOfRoom(meetings, room);
  if (m) return { project: m, source: "meeting" };
  return { project: "", source: "none" };
}

/** A storage path is `<ownerId>/<room>/<stem>.summary.json`. Reading the room
 *  out of the path is what lets a recording made by a COLLEAGUE be matched to
 *  a meeting the host owns. */
export function roomFromPath(path: string): string {
  const parts = String(path || "").split("/");
  return parts.length >= 3 ? clean(parts[1]) : "";
}

export function ownerFromPath(path: string): string {
  const parts = String(path || "").split("/");
  return parts.length >= 2 ? clean(parts[0]) : "";
}

/** Is this recording readable by this person? Only if it belongs to a room
 *  they host. Whoever pressed Record is irrelevant — and must be, or half a
 *  team's meetings are invisible to the person who called them. */
export function mayReadRecording(path: string, hostedRooms: string[], userId: string): boolean {
  const owner = ownerFromPath(path);
  if (owner && owner === clean(userId)) return true;      // your own, always
  const room = roomFromPath(path);
  return Boolean(room) && (hostedRooms || []).some((r) => norm(r) === norm(room));
}

// ── saying the truth about an empty result ────────────────────────────────
//
// FIELD 2026-08-26: "Email me this week digest also did not work. Says nothing
// is open, so there is nothing to send." It was true — all four action items
// in the whole database were ticked off — but "nothing is open" reads like a
// failure when it is actually the good outcome, and it reads identically to
// the case where nothing was ever captured at all. Three different situations
// were sharing one sentence.

export type EmptyReason = "none-at-all" | "all-done" | "have-some";

/** CAUGHT WHILE WRITING THE GUARDS: the first version of this had a fourth
 *  state, "you have open items but none from this week". It cannot happen,
 *  because the digest deliberately CARRIES FORWARD everything still open —
 *  that is the whole reason it exists rather than being another per-meeting
 *  summary. Inventing a state the product does not have would have shipped a
 *  message nobody could ever see. */
export function digestState(s: { total: number; open: number }): EmptyReason {
  const total = Number(s.total) || 0;
  const open = Number(s.open) || 0;
  if (open > 0) return "have-some";
  return total === 0 ? "none-at-all" : "all-done";
}

export function digestMessage(state: EmptyReason, counts: { total: number; open: number }): string {
  switch (state) {
    case "all-done":
      return `Nothing to send — all ${counts.total} action item${counts.total === 1 ? "" : "s"} from your meetings are ticked off. That is the digest working, not failing.`;
    case "none-at-all":
      return "No action items have been captured yet. They come from recorded meetings where somebody commits to something — record a meeting with captions on and they appear here.";
    default:
      return "";
  }
}
