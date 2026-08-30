/**
 * MAYA GUARD — sharing this meeting window must not nest forever.
 *
 * The local screen-share tile is covered while we publish; remotes still
 * see the real share. The current tab is also dropped from the picker.
 *
 * Run: node lib/share.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const conference = code("../app/room/[room]/Conference.tsx");
const full = read("../app/room/[room]/Conference.tsx");

ok(/function ConferenceStage/.test(conference),
  "ConferenceStage wraps the stage");
ok(/qmr-self-share/.test(conference) && /isScreenShareEnabled/.test(conference),
  "local screen share adds qmr-self-share");
ok(/You're sharing this window/.test(full),
  "cover copy is You're sharing this window");
ok(/selfBrowserSurface:\s*"exclude"/.test(conference),
  "current tab is excluded from the share picker");
ok(/<VideoConference\s*\/>/.test(conference),
  "NEGATIVE CONTROL: VideoConference still owns layout/share/leave");
ok(/<Drawing\s*\/>/.test(conference),
  "NEGATIVE CONTROL: Drawing still sits on the stage");
ok(/data-lk-source="screen_share"/.test(conference) && /lk-focus-layout/.test(conference),
  "cover targets the local screen-share tile and the focused tile");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
