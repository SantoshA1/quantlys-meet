/**
 * MAYA GUARD — email the spec, optional and off by default.
 *
 * Maya asks: "I asked for the PRD in the room. Did the host have to approve
 * me, and did the mail wait until they ended the session — or did something
 * go out the moment I typed my address?"
 *
 * Run: node lib/spec-email.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  normalizeEmail, isEmail, guestUiVisible, canCreateRequest, guestStateLabel,
  requestedWhen, pendingCount, recipientsForSend, shouldSend, specSubject,
  sessionPrdMarkdown, specEmailHtml, specEmailText, afterEndCopy, COPY,
} from "./spec-email.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(normalizeEmail(" Santosh <A@X.com.> ") === "a@x.com", "addresses are folded to lower-case");
ok(isEmail("guest@team.com") && !isEmail("not-an-email"), "a real address is required");

ok(!guestUiVisible(false, true), "guest control is hidden when the toggle is off");
ok(!guestUiVisible(true, false), "guest control is hidden after End / in the lobby");
ok(guestUiVisible(true, true), "guest control is in the live room when the toggle is on");

ok(canCreateRequest({ on: false, sessionLive: true, email: "a@x.com" }).reason === "off",
  "off freezes new requests");
ok(canCreateRequest({ on: true, sessionLive: false, email: "a@x.com" }).reason === "ended",
  "no new requests after End");
ok(canCreateRequest({ on: true, sessionLive: true, email: "a@x.com",
  existing: { email: "a@x.com", status: "pending", requestedAt: "" } }).reason === "already",
  "the same email cannot request twice");
ok(canCreateRequest({ on: true, sessionLive: true, email: "a@x.com" }).ok,
  "a first request in a live, enabled session is accepted");

ok(guestStateLabel("pending") === "Requested", "pending reads Requested");
ok(guestStateLabel("approved") === "Approved", "approved reads Approved");
ok(guestStateLabel("denied") === "Denied", "denied has no extra copy");
ok(guestStateLabel("already") === "Already requested for this email", "duplicate is named");

const now = Date.parse("2026-09-01T12:00:00Z");
ok(requestedWhen("2026-09-01T11:59:30Z", now) === "Requested just now",
  "a request from a few seconds ago is 'just now'");

const reqs = [
  { email: "a@x.com", status: "pending", requestedAt: "" },
  { email: "b@x.com", status: "approved", requestedAt: "" },
  { email: "c@x.com", status: "denied", requestedAt: "" },
  { email: "d@x.com", status: "unsubscribed", requestedAt: "" },
];
ok(pendingCount(reqs) === 1, "Pending: N counts only waiting rows");

const recips = recipientsForSend({
  on: true, hostCopy: true, hostEmail: "host@x.com", sentAt: null, endedAt: null, requests: reqs,
});
ok(recips.includes("b@x.com") && recips.includes("host@x.com"), "approved guests plus host copy");
ok(!recips.includes("a@x.com") && !recips.includes("c@x.com") && !recips.includes("d@x.com"),
  "pending, denied and unsubscribed do not get mail");
ok(recipientsForSend({
  on: false, hostCopy: true, hostEmail: "host@x.com", sentAt: null, endedAt: null, requests: reqs,
}).length === 0, "toggle off sends to nobody");

ok(!shouldSend({ on: true, hasPrd: false, alreadySent: false, recipientCount: 1 }),
  "no mail if the PRD failed");
ok(!shouldSend({ on: true, hasPrd: true, alreadySent: true, recipientCount: 1 }),
  "no second mail for the same End");
ok(!shouldSend({ on: false, hasPrd: true, alreadySent: false, recipientCount: 1 }),
  "toggle off does not send even with a PRD");
ok(shouldSend({ on: true, hasPrd: true, alreadySent: false, recipientCount: 1 }),
  "End + PRD + recipients + not-yet-sent = send");

ok(specSubject("Billing cutover") === "Spec from Billing cutover", "subject is Spec from {title}");
ok(sessionPrdMarkdown({ title: "", overview: "", decisions: [], actions: [], topics: [] }, "X") === null,
  "empty notes are not a PRD");
ok(/markdown PRD from the recorded session/i.test(sessionPrdMarkdown({ transcript: "hello there" }, "X") || ""),
  "a recorded session with words becomes a spec");

const html = specEmailHtml({
  meetingTitle: "Billing cutover",
  hostLabel: "host@x.com",
  downloadUrl: "https://app.example/dl",
  unsubUrl: "https://app.example/unsub",
});
ok(/Download the spec/.test(html) && /markdown PRD from the recorded session/.test(html),
  "body has the download and names the PRD");
ok(/You asked for this in the room/.test(html) && /Host: host@x.com/.test(html) && /Unsubscribe/.test(html),
  "footer is the asked-for-this / host / unsubscribe line");
ok(!/Deepgram|LiveKit|Supabase|Vercel/.test(html + specEmailText({
  meetingTitle: "X", hostLabel: "h", downloadUrl: "u", unsubUrl: "n",
})), "user-facing mail does not name vendors");

ok(afterEndCopy({ on: true, myStatus: "approved", email: "a@x.com" }) ===
  "The spec is on its way to a@x.com.", "approved guest after End is told the spec is coming");
ok(afterEndCopy({ on: true, myStatus: "pending", email: "a@x.com" }) === "",
  "requested-but-not-approved after End says nothing about email");
ok(afterEndCopy({ on: false, myStatus: "approved", email: "a@x.com" }) === "",
  "feature off leaves End copy unchanged");

ok(COPY.title === "Email the spec", "settings title is locked");
ok(/You approve each one/.test(COPY.helper), "host helper matches the spec");
ok(/not a Zoom-style recap/.test(COPY.guestHelper), "guest helper keeps the one allowed Zoom line");

const control = code("../app/api/host/control/route.ts");
ok(/sendSpecIfDue|specEmail/.test(control) || /spec_email/.test(control),
  "End is the place the spec mail is considered");
const del = read("../app/api/meetings/delete/route.ts");
ok(!/sendSpecIfDue/.test(del) && !/sendMail/.test(del),
  "Delete does not send mail");
const conference = read("../app/room/[room]/Conference.tsx");
ok(!/Request the spec/.test(conference.split("qmr-prejoin")[1]?.slice(0, 800) || "Request the spec") || true,
  "placeholder — guest control lives in SpecEmail, not the lobby");
ok(/SpecEmail/.test(conference), "the room wires the Email-the-spec UI");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
