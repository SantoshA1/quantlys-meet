/**
 * MAYA GUARD — the hosted 60-minute session limit.
 *
 * Maya asks: "If the hosted app says sessions stop at 60 minutes, does a
 * refresh buy another hour? Do I get warned? And when it cuts us off, do I
 * still get the PRD — or did the limit just eat the meeting?"
 *
 * Unset MEETING_MAX_MINUTES must change nothing (self-host default).
 *
 * Run: node --experimental-strip-types lib/meeting-cap.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  meetingCapMinutes, capWindow, capEndAllowed, capTokenTtlSeconds, capNoticeDue,
  capNoticeText, capEndedMessage, capGate, CAP_END_SKEW_MS,
} from "./meeting-cap.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 11, 15, 0, 0);

// ── config ────────────────────────────────────────────────────────────────
ok(meetingCapMinutes({}) === 0, "unset → unlimited (self-host default)");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "" }) === 0, "blank → unlimited");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "0" }) === 0, "0 → unlimited");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "-5" }) === 0, "negative → unlimited");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "sixty" }) === 0, "not a number → unlimited");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "60" }) === 60, "60 → 60");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: " 60 " }) === 60, "whitespace tolerated");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "1.5" }) === 1.5, "fractions allowed (testing)");
ok(meetingCapMinutes({ MEETING_MAX_MINUTES: "99999" }) === 1440, "clamped to a day");

// ── unlimited changes nothing ─────────────────────────────────────────────
{
  const w = capWindow(T0, T0 + 10 * 60 * MIN, 0);
  ok(!w.limited && !w.over && w.remainingMs === Infinity, "unlimited: ten hours in, not over");
  ok(capTokenTtlSeconds(w, 4 * 3600) === 4 * 3600, "unlimited: token keeps its normal 4h life");
  const g = capGate(w, 4 * 3600);
  ok(g.ok && g.ttlSeconds === 4 * 3600, "unlimited: gate always lets people in");
  ok(capNoticeDue(w.remainingMs, 0) === null, "unlimited: no notices ever");
}

// ── 60 minutes: notices at 50 and 55, end at 60 ───────────────────────────
{
  const at = (m) => capWindow(T0, T0 + m * MIN, 60);
  ok(capNoticeDue(at(0).remainingMs, 60) === null, "minute 0: no notice");
  ok(capNoticeDue(at(49.9).remainingMs, 60) === null, "minute 49.9: no notice yet");
  ok(capNoticeDue(at(50).remainingMs, 60) === 10, "minute 50: 10-minute notice");
  ok(capNoticeDue(at(54.9).remainingMs, 60) === 10, "minute 54.9: still the 10-minute notice");
  ok(capNoticeDue(at(55).remainingMs, 60) === 5, "minute 55: 5-minute notice");
  ok(capNoticeDue(at(59.9).remainingMs, 60) === 5, "minute 59.9: 5-minute notice");
  ok(capNoticeDue(at(60).remainingMs, 60) === 0, "minute 60: time is up");
  ok(!at(59.9).over && at(60).over && at(75).over, "over exactly at 60, and stays over");
  ok(at(10).endsAt === T0 + 60 * MIN, "ends at start + 60 minutes");
  ok(/ends in 10 minutes/.test(capNoticeText(at(50).remainingMs, 60)), "10-minute notice text");
  ok(/ends in 5 minutes/.test(capNoticeText(at(55).remainingMs, 60)), "5-minute notice text");
  ok(capEndedMessage(60) ===
    "This meeting hit the 60-minute limit on the hosted app. Start a new meeting or self-host for unlimited.",
    "end message is the agreed wording");
}

// ── short caps (testing) ──────────────────────────────────────────────────
ok(capNoticeDue(2 * MIN, 2) === 5, "a 2-minute cap shows the last notice from the start");
ok(capNoticeDue(8 * MIN, 7) === null && capNoticeDue(5 * MIN, 7) === 5, "a 7-minute cap skips the 10-minute notice");

// ── the server decides when it ends, not the browser ──────────────────────
{
  ok(!capEndAllowed(capWindow(T0, T0 + 30 * MIN, 60)), "minute 30: end refused (no early end via the API)");
  ok(!capEndAllowed(capWindow(T0, T0 + 60 * MIN - CAP_END_SKEW_MS - 1000, 60)), "6s early: refused");
  ok(capEndAllowed(capWindow(T0, T0 + 60 * MIN - 2000, 60)), "2s early: accepted (clock skew)");
  ok(capEndAllowed(capWindow(T0, T0 + 61 * MIN, 60)), "minute 61: accepted");
  ok(!capEndAllowed(capWindow(null, T0, 60)), "no live room: nothing to end");
  ok(!capEndAllowed(capWindow(T0, T0 + 61 * MIN, 0)), "unlimited: never ends");
}

// ── rejoin / refresh cannot reset the clock ───────────────────────────────
{
  // The clock is the live room's start, so a refresh at minute 30 sees 30 left.
  const refresh = capWindow(T0, T0 + 30 * MIN, 60);
  ok(refresh.remainingMs === 30 * MIN, "refresh at minute 30: 30 minutes left, not 60");
  const g30 = capGate(refresh, 4 * 3600);
  ok(g30.ok && g30.ttlSeconds === 30 * 60 + 120, "token at minute 30 lives 30 min + 2 min grace");
  const late = capGate(capWindow(T0, T0 + 61 * MIN, 60), 4 * 3600);
  ok(!late.ok && late.status === 403 && /60-minute limit/.test(late.error), "rejoin after the limit: refused with the limit message");
  const fresh = capGate(capWindow(null, T0, 60), 4 * 3600);
  ok(fresh.ok && fresh.ttlSeconds === 62 * 60, "not started yet: token for the whole hour + grace");
  ok(capTokenTtlSeconds(capWindow(T0, T0 + 59.99 * MIN, 60), 4 * 3600) >= 60, "token life never under a minute");
}

// ── wiring: server enforcement ────────────────────────────────────────────
const roomToken = code("../app/api/room/token/route.ts");
const knock = code("../app/api/room/knock/route.ts");
const legacy = code("../app/api/livekit/token/route.ts");
const limit = code("../app/api/room/limit/route.ts");
const server = code("./meeting-cap-server.ts");
const conf = code("../app/room/[room]/Conference.tsx");

for (const [n, src] of [["room/token", roomToken], ["room/knock", knock], ["livekit/token", legacy]]) {
  ok(/capStatusFor\(room\)/.test(src) && /capGate\(cap,/.test(src), `${n}: checks the session clock before minting`);
  ok(/if \(!gate\.ok\)[\s\S]{0,120}endCappedSession/.test(src), `${n}: an over-limit session is ended and refused`);
  ok(/ttl: gate\.ttlSeconds/.test(src), `${n}: token lifetime follows the time left`);
  ok(!/ttl: "\dh"/.test(src), `${n}: no fixed-length token left behind`);
}
ok(/requireRoomToken\(req, room\)/.test(limit) && (limit.match(/requireRoomToken/g) || []).length >= 3,
  "limit route: GET and POST both need the room's own token");
ok(/if \(!capEndAllowed\(s\)\)[\s\S]{0,80}status: 409/.test(limit), "limit route: refuses to end early (409)");
ok(/creationTimeMs/.test(server) && /listRooms\(\[room\]\)/.test(server), "clock = LiveKit room creation time, read server-side");
ok(/deleteRoom\(room\)/.test(server), "limit end drops the LiveKit room (everyone disconnected)");
ok(/ended_at:[^}]*active: false/.test(server), "limit end marks the row ended so guests can't rejoin it");
ok(/sendSpecIfDue/.test(server), "limit end still sends the spec email when one is due");
ok(!/\.delete\(\)/.test(server), "limit end deletes no data");
ok(/if \(!cap\) return/.test(server), "unlimited: no LiveKit call at all");

// ── wiring: the PRD still gets written ────────────────────────────────────
{
  const at = conf.indexOf("capEndRef.current = async");
  const body = conf.slice(at, at + 3000);
  const flush = body.indexOf("await flushRecording()");
  const post = body.indexOf("await askEnd()");
  const drop = body.indexOf("ctx.disconnect()");
  ok(at > 0 && flush > 0, "cap end saves the recording (→ /api/recording/finish → notes + PRD)");
  ok(flush > 0 && post > flush && drop > flush, "…BEFORE the session is ended or this tab disconnects");
  ok(/noteUnrecorded\(\)/.test(body), "…and an unrecorded Memory session is still flagged");
  ok(/Open the PRD/.test(conf) && /\/host\?handoff=1#prd/.test(conf), "host is pointed at the PRD after the limit");
  ok(/async function save\(\)[\s\S]*\/api\/recording\/finish/.test(conf), "save() still posts to /api/recording/finish");
  ok(/capNoticeDue\(capLeft, cap\.capMinutes\)/.test(conf) && /minutes" : "minute"} left/.test(conf), "room shows the 10/5-minute notices");
  ok(/\/api\/room\/limit/.test(conf) && /x-room-token/.test(conf), "room asks the server for the clock");
  ok(/RoomEvent\.Disconnected/.test(conf), "a session ended by another tab shows the limit message, not 'Disconnected'");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
