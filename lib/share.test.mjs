/**
 * MAYA GUARD — local share always shows a real preview; cover never applies.
 *
 * After PR #9 every local share was blanked. After #16 only browser surfaces
 * were covered. Product requirement now: host must always see what is shared.
 * Hall-of-mirrors prevention is picker exclude only (selfBrowserSurface).
 *
 * Run: node lib/share.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  shouldCoverLocalSharePreview,
  screenShareCaptureDefaults,
} from "./share.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const conference = code("../app/room/[room]/Conference.tsx");
const full = read("../app/room/[room]/Conference.tsx");
const share = code("./share.ts");

// ── pure helper — cover never applies ────────────────────────────────────
ok(shouldCoverLocalSharePreview({ displaySurface: "browser" }) === false,
  "browser surface is NOT covered — host sees the real preview");
ok(shouldCoverLocalSharePreview({ displaySurface: "window" }) === false,
  "window share shows the real preview");
ok(shouldCoverLocalSharePreview({ displaySurface: "monitor" }) === false,
  "monitor / full-screen share shows the real preview");
ok(shouldCoverLocalSharePreview({}) === false,
  "unknown surface shows the preview");
ok(shouldCoverLocalSharePreview(null) === false && shouldCoverLocalSharePreview(undefined) === false,
  "missing settings never blank the tile");
ok(shouldCoverLocalSharePreview({ displaySurface: "BROWSER" }) === false,
  "case variants never cover either");

// ── wiring ───────────────────────────────────────────────────────────────
ok(/function ConferenceStage/.test(conference),
  "ConferenceStage wraps the stage");
ok(!/qmr-self-share/.test(full),
  "NEGATIVE: qmr-self-share cover class/CSS is gone");
ok(!/isScreenShareEnabled \? "qmr-conf qmr-self-share"/.test(conference),
  "NEGATIVE: no longer adds qmr-self-share for every local share");
ok(!/You're sharing this (window|tab)/.test(full),
  "cover copy text is gone from Conference");
ok(/selfBrowserSurface:\s*"exclude"/.test(conference) || /screenShareCaptureDefaults\(\)/.test(conference),
  "current tab is excluded from the share picker where supported");
ok(/function screenShareCaptureDefaults/.test(share),
  "screenShareCaptureDefaults is a feature-detect helper, not a UA sniff");
ok(!/userAgent|Safari|Chrome/.test(share),
  "share helpers never UA-sniff");
ok(/return false/.test(share) && /shouldCoverLocalSharePreview/.test(share),
  "shouldCoverLocalSharePreview always returns false");
ok(/<VideoConference\s*\/>/.test(conference),
  "NEGATIVE CONTROL: VideoConference still owns layout/share/leave");
ok(/<Drawing\s*\/>/.test(conference),
  "NEGATIVE CONTROL: Drawing still sits on the stage");
ok(/className="qmr-conf"/.test(conference),
  "ConferenceStage always uses qmr-conf without a cover class");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
