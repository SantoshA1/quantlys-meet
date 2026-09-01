/**
 * MAYA GUARD — session end is not meeting death.
 *
 * End drops the live room and saves the recording; the same link still works.
 * Captions no longer refuse a session-ended meeting. Delete is permanent.
 *
 * Run: node lib/session-end.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const captions = code("../app/api/captions/token/route.ts");
const control = code("../app/api/host/control/route.ts");
const conference = code("../app/room/[room]/Conference.tsx");
const host = code("../app/host/page.tsx");
const cron = code("../app/api/cron/cleanup/route.ts");

ok(!/That meeting has ended/.test(captions),
  "captions token does not refuse a session-ended meeting");
ok(!/status:\s*409/.test(captions),
  "…and does not 409 on active === false");

ok(/action === "end"/.test(control) && /ended_at/.test(control),
  "host control end sets ended_at");
ok(!/update\(\{\s*active:\s*false/.test(control),
  "…and does not set active: false on the end update");
ok(!/Which person\?[\s\S]{0,200}action === "end"/.test(control),
  "identity 400 must not sit in front of end — Conference calls control(end) with no identity");
const endAt = control.indexOf('action === "end"');
const idAt = control.indexOf('if (!identity)');
ok(endAt !== -1 && idAt !== -1 && endAt < idAt,
  "end is handled before the identity requirement");

ok(!/marked ended/i.test(conference) && !/cut off/i.test(conference),
  "in-room End copy does not say the meeting is marked ended or that the recording is cut off");
ok(/await flushRecording\(\)/.test(conference) && /await control\("end"\)/.test(conference),
  "End flushes the recording before control(end)");
ok(/End this session/.test(conference),
  "the button is End this session");

ok(/END SESSION/.test(host) && /\/api\/host\/control/.test(host) && /action:\s*"end"/.test(host),
  "host page END SESSION calls /api/host/control");
ok(!/endMeeting[\s\S]{0,400}active:\s*false/.test(host),
  "…rather than writing active:false itself");

ok(!/active:\s*false/.test(cron),
  "cron cleanup does not set active: false");
ok(/ended_at/.test(cron),
  "…it records ended_at so we know the last session went quiet");

ok(!/Works until the host ends it/.test(conference),
  "lobby does not say the link dies when the host ends it");
ok(/Keeps working after a session/.test(conference),
  "lobby says the link keeps working after a session");
ok(!/until you end the meeting/.test(host),
  "host scheduled note does not say the link dies when you end");

ok(/\/api\/meetings\/delete/.test(host) && /DELETE/.test(host),
  "NEGATIVE CONTROL: delete flow still exists");

const del = code("../app/api/meetings/delete/route.ts");
ok(/sendSpecIfDue/.test(control), "End considers sending the spec");
ok(!/sendSpecIfDue/.test(del) && !/sendMail/.test(del),
  "Delete does not send the spec");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
