/**
 * MAYA GUARD — the waiting room.
 *
 * Maya asks: "I clicked the link on time. Does anyone in there know I'm
 * standing out here, or am I looking at a page that will never change?"
 *
 * FIELD 2026-08-18: what the app had was a LOCK — once the host closed the
 * door the link stopped working and a person who was invited, on time, with
 * the link in their hand, got an error message from a machine with no way to
 * appeal to the human twenty feet away.
 *
 * Run: node lib/waiting.test.mjs
 */
import {
  sortKnocks, dedupeKnocks, hostSummary, waitingMessage, pollDelay, position,
  isStale, STALE_MS,
} from "./waiting.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const k = (id, name, mins, status = "pending") => ({
  id, display_name: name, status,
  requested_at: new Date(Date.UTC(2026, 7, 18, 10, mins, 0)).toISOString(),
  room_name: "r",
});

// ── fairness ─────────────────────────────────────────────────────────────
const queue = [k("c", "Vithal", 9), k("a", "Kiran", 2), k("b", "Sarath", 5)];
ok(sortKnocks(queue).map((x) => x.display_name).join(",") === "Kiran,Sarath,Vithal",
  "the person who has waited longest is first — sorting newest-first quietly punishes whoever turned up on time");
ok(sortKnocks([...queue, k("d", "Old", 1, "admitted")]).length === 3,
  "somebody already admitted is not still standing in the queue");
ok(sortKnocks([]).length === 0 && sortKnocks(null).length === 0, "an empty queue never throws");

// ── one row per person ───────────────────────────────────────────────────
const flappy = [k("a1", "Kiran", 2), k("a2", "Kiran", 6), k("a3", "Kiran", 8), k("b", "Sarath", 5)];
ok(dedupeKnocks(flappy).length === 2,
  "a guest whose phone reconnected three times is ONE person in the host's list — 'Kiran, Kiran, Kiran' makes a host guess how many people are actually there, and guess wrong");
ok(dedupeKnocks(flappy)[0].id === "a1",
  "…and they keep their original place, rather than being sent to the back for having bad wifi");

ok(hostSummary(dedupeKnocks(flappy)) === "2 people waiting", "the host's button counts people, not rows");
ok(hostSummary([k("a", "Kiran", 2)]) === "Kiran is waiting",
  "…and one person gets their name, because that is what decides whether you press the button");
ok(hostSummary([]) === "", "and nobody waiting says nothing at all");

// ── what the person outside is told ──────────────────────────────────────
ok(/host has been told/i.test(waitingMessage("pending", { hostPresent: true })),
  "somebody waiting is told a human knows they are there — being SEEN is the whole thing");
ok(/Nobody's in the meeting yet/i.test(waitingMessage("pending", { hostPresent: false })),
  "…and when there is no host in the room yet, it says THAT instead of 'waiting for the host', which lets a person stare at a wall for ten minutes");
ok(/automatically|by itself/i.test(waitingMessage("pending", { hostPresent: false })),
  "…and promises the page will let them in by itself, so they don't sit refreshing");
ok(/1 person ahead|are 2 people ahead/.test(waitingMessage("pending", { hostPresent: true, position: 3 })),
  "a queue position turns an indefinite wait into a finite one");
ok(/presenting/i.test(waitingMessage("pending", { hostPresent: true, waitedMs: 120000 })),
  "a long wait offers the likeliest innocent explanation instead of leaving them to assume they were snubbed");
ok(/didn't let you in/i.test(waitingMessage("denied")) && /message them/i.test(waitingMessage("denied")),
  "a refusal is plain, and says what to do about it — a dead end here is where somebody gives up on the product");
ok(/connecting you now/i.test(waitingMessage("admitted")), "being let in says so immediately");
ok(waitingMessage("error").length > 20, "and a failure to knock at all is its own message, not silence");

// ── polling ──────────────────────────────────────────────────────────────
ok(pollDelay(0) <= 2000, "at first we check often, because the host is watching them not appear");
ok(pollDelay(5 * 60_000) > pollDelay(0), "after a long wait we back off rather than hammering");
ok(pollDelay(10 * 60_000) <= 10_000, "…but never so far that being let in takes half a minute to notice");

// ── the queue does not accumulate ghosts ─────────────────────────────────
const now = Date.UTC(2026, 7, 18, 10, 30, 0);
ok(isStale(k("x", "Gone", 2), now), "a tab somebody closed half an hour ago is not a person waiting");
ok(!isStale(k("x", "Here", 28), now), "…but stepping away for two minutes to find headphones does not lose your place");
ok(!isStale({ id: "x", requested_at: "nonsense" }, now),
  "and an unreadable timestamp is never treated as evidence somebody left");

ok(position(flappy, "a1") === 1 && position(flappy, "b") === 2, "position counts deduped people");
ok(position(flappy, "nope") === 0, "and somebody not in the queue has no position rather than a wrong one");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
