/**
 * MAYA GUARD — sharing a window must show a preview; only a browser tab covers.
 *
 * After PR #9, every local share was blanked with "You're sharing this window".
 * That hid legitimate window/monitor previews. Cover only displaySurface=browser.
 *
 * Run: node lib/share.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  shouldCoverLocalSharePreview,
  screenShareCaptureDefaults,
  LOCAL_SHARE_COVER_COPY,
} from "./share.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const conference = code("../app/room/[room]/Conference.tsx");
const full = read("../app/room/[room]/Conference.tsx");
const share = code("./share.ts");

// ── pure helper ──────────────────────────────────────────────────────────
ok(shouldCoverLocalSharePreview({ displaySurface: "browser" }) === true,
  "browser surface is covered (would recurse)");
ok(shouldCoverLocalSharePreview({ displaySurface: "window" }) === false,
  "window share shows the real preview");
ok(shouldCoverLocalSharePreview({ displaySurface: "monitor" }) === false,
  "monitor / full-screen share shows the real preview");
ok(shouldCoverLocalSharePreview({}) === false,
  "unknown surface shows the preview — exclude already keeps this tab out");
ok(shouldCoverLocalSharePreview(null) === false && shouldCoverLocalSharePreview(undefined) === false,
  "missing settings never blank the tile");
ok(shouldCoverLocalSharePreview({ displaySurface: "BROWSER" }) === true,
  "displaySurface compare is case-insensitive");

ok(/You're sharing this tab — others still see it/.test(LOCAL_SHARE_COVER_COPY),
  "cover copy names a tab and reassures that others still see it");

// ── wiring ───────────────────────────────────────────────────────────────
ok(/function ConferenceStage/.test(conference),
  "ConferenceStage wraps the stage");
ok(/shouldCoverLocalSharePreview/.test(conference) && /qmr-self-share/.test(conference),
  "cover class is gated by shouldCoverLocalSharePreview, not bare isScreenShareEnabled");
ok(!/isScreenShareEnabled \? "qmr-conf qmr-self-share"/.test(conference),
  "NEGATIVE: no longer adds qmr-self-share for every local share");
ok(full.includes(LOCAL_SHARE_COVER_COPY),
  "CSS cover copy matches LOCAL_SHARE_COVER_COPY");
ok(!/You're sharing this window/.test(full),
  "old 'this window' cover copy is gone");
ok(/selfBrowserSurface:\s*"exclude"/.test(conference) || /screenShareCaptureDefaults\(\)/.test(conference),
  "current tab is excluded from the share picker where supported");
ok(/function screenShareCaptureDefaults/.test(share),
  "screenShareCaptureDefaults is a feature-detect helper, not a UA sniff");
ok(!/userAgent|Safari|Chrome/.test(share),
  "share helpers never UA-sniff");
ok(/<VideoConference\s*\/>/.test(conference),
  "NEGATIVE CONTROL: VideoConference still owns layout/share/leave");
ok(/<Drawing\s*\/>/.test(conference),
  "NEGATIVE CONTROL: Drawing still sits on the stage");
ok(/data-lk-local-participant="true"\]\[data-lk-source="screen_share"/.test(conference),
  "cover targets only the local screen-share tile");
ok(!/\.qmr-self-share \.lk-focus-layout > \.lk-participant-tile/.test(full),
  "broad focus-layout cover selector is gone — never blank a remote focus tile");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
