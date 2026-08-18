// The waiting room.
//
// What the app had was a lock: once the host closed the door, the link simply
// stopped working and anyone who arrived late got an error message. That is
// the cheap version, and its cost is that a person who was invited, who has
// the link, who is on time by their own clock, is told to go away by a
// machine with no way to appeal to the human twenty feet away.
//
// A real waiting room is the opposite bargain: the door is never open to
// strangers AND nobody who belongs is ever turned away, because a person
// decides. The whole design problem is making the wait honest — the two
// things a person standing outside needs to know are that they were SEEN and
// roughly how long this is going to take.
//
// Pure functions. The fairness rule and the "did anyone even notice me"
// message are the parts that go quietly wrong, so they are the parts tested.

export type KnockStatus = "pending" | "admitted" | "denied";

export type Knock = {
  id: string;
  room_name: string;
  display_name: string;
  requested_at: string;
  status: KnockStatus | string;
};

/** A tab somebody closed an hour ago must not sit in the host's list looking
 *  like a person. Long enough that stepping away to find headphones does not
 *  lose your place. */
export const STALE_MS = 5 * 60 * 1000;

export function isStale(k: Knock, now: number): boolean {
  const t = Date.parse(k?.requested_at || "");
  if (isNaN(t)) return false;   // an unreadable date is not evidence of absence
  return now - t > STALE_MS;
}

/** Oldest first — the only fair order, and the one the host expects when they
 *  press Admit without reading. Sorting newest-first quietly punishes the
 *  person who was on time, which is exactly backwards. */
export function sortKnocks(rows: Knock[]): Knock[] {
  return (rows || [])
    .filter((k) => k && k.id && String(k.status || "pending") === "pending")
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.requested_at || "") || 0;
      const tb = Date.parse(b.requested_at || "") || 0;
      return ta - tb || String(a.id).localeCompare(String(b.id));
    });
}

/** One row per person. A guest who refreshes, or whose phone reconnects on the
 *  train, must not appear in the host's list four times — a host looking at
 *  "Kiran, Kiran, Kiran" cannot tell whether three people are waiting or one
 *  person is having a bad connection, and will guess wrong. */
export function dedupeKnocks(rows: Knock[]): Knock[] {
  const seen = new Map<string, Knock>();
  for (const k of sortKnocks(rows)) {
    const key = String(k.display_name || "").trim().toLowerCase() || k.id;
    const prev = seen.get(key);
    // Keep the EARLIEST, so a reconnecting guest keeps their place in the queue
    // rather than being sent to the back for having bad wifi.
    if (!prev) seen.set(key, k);
  }
  return Array.from(seen.values());
}

/** What the host sees on the button. */
export function hostSummary(waiting: Knock[]): string {
  const n = (waiting || []).length;
  if (!n) return "";
  if (n === 1) return `${waiting[0].display_name || "Someone"} is waiting`;
  return `${n} people waiting`;
}

/** What the person outside sees. The two facts that matter are whether a human
 *  has seen them and whether anyone is even in there — "Waiting for the host"
 *  when there is no host in the room is a message that lets somebody sit and
 *  stare at a wall for ten minutes. */
export function waitingMessage(
  state: KnockStatus | "connecting" | "error",
  opts: { hostPresent?: boolean; position?: number; waitedMs?: number } = {}
): string {
  if (state === "admitted") return "You're in — connecting you now.";
  if (state === "denied") {
    return "The host didn't let you in this time. If that's a mistake, message them and use the link again.";
  }
  if (state === "connecting") return "Knocking…";
  if (state === "error") {
    return "We couldn't reach the meeting to let anyone know you're here. Check your connection and try again.";
  }
  const waited = Math.floor((opts.waitedMs || 0) / 1000);
  if (opts.hostPresent === false) {
    return waited > 45
      ? "Nobody has started this meeting yet. You'll be let in automatically the moment the host arrives — you can leave this tab open."
      : "Nobody's in the meeting yet. This page will let you in by itself when the host arrives.";
  }
  if (opts.position && opts.position > 1) {
    return `The host has been told you're here. There ${opts.position - 1 === 1 ? "is 1 person" : `are ${opts.position - 1} people`} ahead of you.`;
  }
  if (waited > 90) {
    return "The host has been told you're here — they may be presenting. You'll come straight in when they let you.";
  }
  return "The host has been told you're here. You'll come straight in when they let you.";
}

/** A guest waiting a long time must not hammer the server, but must also not
 *  find out thirty seconds late that they were let in — the host is watching
 *  them not appear. Quick at first, then settle. */
export function pollDelay(waitedMs: number): number {
  if (waitedMs < 30_000) return 2000;
  if (waitedMs < 3 * 60_000) return 4000;
  return 8000;
}

/** Where in the queue a person is, 1-based. 0 means "not in it". */
export function position(waiting: Knock[], id: string): number {
  const i = dedupeKnocks(waiting).findIndex((k) => k.id === id);
  return i < 0 ? 0 : i + 1;
}
