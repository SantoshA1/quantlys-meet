/**
 * MAYA GUARD — shareable project PRD link.
 *
 * Maya asks: "We finished the meeting. Can I paste one link so the rest of
 * the team can open the PRD without signing in — and can I turn that link
 * off when the draft is stale?"
 *
 * Run: node lib/prd-share.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  shareMapPath, shareUrl, isShareId, acceptShareMap, publicPrdFromStored,
  postMeetingHandoffCopy,
} from "./prd-share.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(shareMapPath("AbCdef0123456789abcdef01") === "shares/abcdef0123456789abcdef01.json",
  "share maps live under shares/ and fold to lower-case");
ok(shareUrl("https://quantlys-meeting.com/", "abcdef0123456789abcdef01") ===
  "https://quantlys-meeting.com/prd/abcdef0123456789abcdef01",
  "the public URL is /prd/{id} with no trailing slash on origin");
ok(shareUrl("", "abcdef0123456789abcdef01") === "" && shareUrl("https://x.com", "") === "",
  "a missing origin or id never invents a half-link");

ok(isShareId("abcdef0123456789abcdef01") && !isShareId("short") && !isShareId("../etc"),
  "only 24 hex chars are share ids");

ok(acceptShareMap({ shareId: "abcdef0123456789abcdef01", userId: "u1", project: "Billing" })?.project === "Billing",
  "a complete map is accepted");
ok(acceptShareMap({ shareId: "nope", userId: "u1", project: "Billing" }) === null,
  "a bad id is refused");
ok(acceptShareMap({ shareId: "abcdef0123456789abcdef01", userId: "", project: "Billing" }) === null,
  "…and so is a map with no owner");

const pub = publicPrdFromStored({
  project: "Billing-v2", artifact: "PRD", gate: "Build-ready", mode: "build",
  score: 0.75, present_count: 6, total: 8, ready: false,
  summary: "Plan changes without support tickets.",
  markdown: "# PRD - billing-v2\n\nHello.",
  filename: "billing-v2-prd.md", at: "2026-09-30T12:00:00Z",
  meetings_used: 3, userId: "secret", model_note: "internal",
});
ok(Boolean(pub) && String(pub.markdown).includes("billing-v2") && pub.project === "Billing-v2",
  "the public body carries the document");
ok(Boolean(pub) && !("userId" in pub) && !("model_note" in pub),
  "…and strips owner / model internals");
ok(publicPrdFromStored({ project: "x" }) === null,
  "no markdown means nothing to share");

ok(/Session ended/.test(postMeetingHandoffCopy({ hasPrd: true, shareUrl: "https://x/prd/a" })),
  "post-end copy names the session end when a share link exists");
ok(/turn on a shareable link/i.test(postMeetingHandoffCopy({ hasPrd: true })),
  "…and nudges enable when the PRD exists but is not shared yet");
ok(/when this project's/i.test(postMeetingHandoffCopy({ hasPrd: false })),
  "…and does not pretend a missing PRD is ready");

const route = code("../app/api/prd/share/route.ts");
ok(/export async function GET/.test(route) && /export async function POST/.test(route),
  "share route exposes GET (public) and POST (host)");
ok(/Please sign in/.test(route) && /action === "revoke"|\["enable", "revoke", "status"\]/.test(route),
  "POST requires auth and supports enable/revoke/status");
ok(/shareId/.test(route) && /shareMapPath/.test(route),
  "enable writes the opaque map; revoke clears it");

const page = code("../app/prd/[id]/page.tsx");
ok(/Copy the/.test(page) && /Download \.md/.test(page),
  "the public page offers copy and download");
ok(/share link is gone|Link unavailable/i.test(page),
  "…and names a revoked link plainly");

const prdUi = code("../app/host/Prd.tsx");
ok(/shareable|Copy shareable|Turn sharing off/i.test(prdUi),
  "host PRD panel exposes shareable link controls");

const conf = code("../app/room/[room]/Conference.tsx");
ok(/handoff=1|#prd/.test(conf),
  "End sends the host to the PRD handoff on /host");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
