/**
 * A recording that survives the tab (FIELD 2026-10-17: three Memory sessions,
 * nothing saved). Pure rules + the wiring that makes them true.
 *
 * Run: node --experimental-strip-types lib/take-store.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  isRecoverable, orderedParts, recoveryPaths, recoveryFinishBody, takeLockName,
  newTakeId, describeTake, ORPHAN_AFTER_MS, MIN_TAKE_BYTES,
  listTakes, putChunk, deleteTake, holdTakeLock, withFreeTakeLock,
} from "./take-store.ts";
import { leaveIntent, readUnrecorded, unrecordedText, UNRECORDED_KEY } from "./leave-guard.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const now = 1_760_000_000_000;
const meta = {
  id: "t1", userId: "u1", room: "qm-abc", title: "Grandpa", sessionMode: "memory",
  pageId: "p-old", startedAt: Date.UTC(2026, 9, 17, 1, 5, 0), updatedAt: now - 60_000, elapsed: 754,
  vExt: "mp4", vMime: "video/mp4;codecs=avc1", aExt: "m4a", aMime: "audio/mp4",
  vBytes: 5_000_000, aBytes: 300_000, people: ["Santosh", "Shayan"],
  captions: [{ start: 1, speaker: 0, transcript: "hi" }], captionText: "hi", video: { height: 720 },
};

// ── isRecoverable ───────────────────────────────────────────────────────
ok(isRecoverable(meta, { userId: "u1", pageId: "p-new", now, locksAvailable: false }),
  "abandoned take (stale heartbeat, other page) is recoverable");
ok(!isRecoverable(meta, { userId: "u2", pageId: "p-new", now }), "another account's take is never offered");
ok(!isRecoverable(meta, { userId: "", pageId: "p-new", now }), "signed-out page recovers nothing");
ok(!isRecoverable(meta, { userId: "u1", pageId: "p-old", now }), "this page's own take is not 'recovered'");
ok(!isRecoverable({ ...meta, updatedAt: now - 5_000 }, { userId: "u1", pageId: "p-new", now, locksAvailable: false }),
  "fresh heartbeat without Web Locks = still recording elsewhere");
ok(isRecoverable({ ...meta, updatedAt: now - 5_000 }, { userId: "u1", pageId: "p-new", now, locksAvailable: true }),
  "with Web Locks the lock (not the clock) decides");
ok(!isRecoverable({ ...meta, vBytes: 10, aBytes: 10 }, { userId: "u1", pageId: "p-new", now }), "a header is not a recording");
ok(isRecoverable({ ...meta, vBytes: 0, aBytes: 4096 }, { userId: "u1", pageId: "p-new", now }), "audio alone still counts");
ok(!isRecoverable(null, { userId: "u1", pageId: "p", now }), "null meta is ignored");
ok(ORPHAN_AFTER_MS >= 15_000 && MIN_TAKE_BYTES === 1024, "thresholds");

// ── order + paths + finish body ─────────────────────────────────────────
const B = (s) => new Blob([s]);
const parts = orderedParts([
  { takeId: "t1", kind: "v", seq: 2, data: B("c") },
  { takeId: "t1", kind: "a", seq: 0, data: B("x") },
  { takeId: "t1", kind: "v", seq: 0, data: B("a") },
  { takeId: "t1", kind: "v", seq: 1, data: B("b") },
], "v");
ok((await new Blob(parts).text()) === "abc", "pieces reassemble in recorded order");
ok(orderedParts([], "a").length === 0, "no pieces → nothing");

const p1 = recoveryPaths(meta, true, true);
ok(p1.videoPath === "u1/qm-abc/2026-10-17T01-05-00-000Z.mp4", "video path is user/room/startStamp.ext");
ok(p1.audioPath === "u1/qm-abc/2026-10-17T01-05-00-000Z.m4a", "audio twin path matches a live save");
const p2 = recoveryPaths({ ...meta, aExt: "webm" }, false, true);
ok(p2.videoPath.endsWith(".webm") && p2.audioPath === null, "audio-only take becomes the primary file");
ok(recoveryPaths(meta, false, false).videoPath === null, "nothing kept → no path");
ok(p1.videoPath.startsWith(`${meta.userId}/`), "path passes finish's ownership check");

const body = recoveryFinishBody(meta, p1.videoPath, p1.audioPath);
ok(body.sessionMode === "memory", "Memory take is summarized as Memory (story pipeline)");
ok(body.duration_s === 754 && body.people.length === 2 && body.captions.length === 1, "duration, people, captions ride along");
ok(body.room === "qm-abc" && body.videoPath === p1.videoPath, "room + video path");
ok(recoveryFinishBody({ ...meta, sessionMode: "weird" }, "x", null).sessionMode === "meeting", "unknown mode → meeting");

ok(takeLockName("t1") === "qm-take-t1", "lock name");
ok(newTakeId(1, () => 0.5) !== newTakeId(2, () => 0.5), "ids differ");
ok(/Memory session “Grandpa”/.test(describeTake(meta)) && /~13 min/.test(describeTake(meta)), "describe");

// ── no IndexedDB / no Web Locks (Node, private mode): never throws ─────
ok(Array.isArray(await listTakes()) && (await listTakes()).length === 0, "listTakes without IndexedDB → []");
ok((await putChunk({ takeId: "t", kind: "v", seq: 0, data: B("a") })) === false, "putChunk without IndexedDB → false, no throw");
ok((await deleteTake("t")) === false, "deleteTake without IndexedDB → false");
const rel = holdTakeLock("t"); rel();
ok(typeof rel === "function", "holdTakeLock is a no-op without Web Locks");
ok((await withFreeTakeLock("t", async () => 7)) === 7, "withFreeTakeLock runs without Web Locks");

// ── leave guard ─────────────────────────────────────────────────────────
const L = (o) => leaveIntent({ recording: false, busy: false, isHost: true, sessionMode: "memory", recordedThisPage: false, ...o });
ok(L({ busy: true, recording: true }) === "wait", "uploading → wait");
ok(L({ recording: true }) === "confirm-recording", "recording → confirm, then save & leave");
ok(L({}) === "confirm-unrecorded", "host leaving an unrecorded Memory session is told");
ok(L({ recordedThisPage: true }) === "leave", "recorded and saved → just leave");
ok(L({ isHost: false }) === "leave", "guests are not nagged");
ok(L({ sessionMode: "meeting" }) === "leave", "meeting mode unchanged");
const n = readUnrecorded(JSON.stringify({ room: "qm-1", title: "T", at: now }), now + 1000);
ok(n && n.room === "qm-1", "unrecorded note parses");
ok(readUnrecorded(JSON.stringify({ room: "qm-1", at: now }), now + 11 * 60_000) === null, "stale note ignored");
ok(readUnrecorded("{bad", now) === null && readUnrecorded(null, now) === null, "malformed note ignored");
ok(/wasn't recorded/.test(unrecordedText(n)), "notice says it plainly");
ok(UNRECORDED_KEY === "qm.unrecorded", "key");

// ── wiring ──────────────────────────────────────────────────────────────
const conf = code("../app/room/[room]/Conference.tsx");
const host = code("../app/host/page.tsx");
const rec = code("../app/_recovery/RecoverTakes.tsx");
ok(/sessionMode !== "memory"/.test(conf) && /memoryAutoRec\.current = true;\s*startRecordingRef\.current\(\)/.test(conf),
  "Memory mode auto-starts recording once");
ok(/if \(spec \|\| !isHost \|\| !signedIn \|\| recording \|\| memoryAutoRec\.current\) return;/.test(conf),
  "auto-record is host-only, signed-in only, not in spec (spec has its own)");
ok(/vr\.start\(2000\)/.test(conf) && /ar\.start\(2000\)/.test(conf), "recorders run with a 2s timeslice");
ok(/keep\("v", e\.data\)/.test(conf) && /keep\("a", e\.data\)/.test(conf), "every piece is copied to IndexedDB");
ok(/holdTakeLock\(id\)/.test(conf), "the recording tab holds the take's lock");
ok(/uploaded \? deleteTake\(id\)/.test(conf), "browser copy deleted only after the video is uploaded");
ok(/new Date\(takeStartedAt\.current/.test(conf), "live save uses the start stamp (same path as recovery)");
ok(/leaveIntent\(/.test(conf) && /Save &amp; leave|Save & leave/.test(conf), "Leave asks before stopping a recording");
ok(/await flushRecording\(\);\s*noteUnrecorded\(\);\s*ctx\.disconnect\(\)/.test(conf), "Leave stops + uploads before disconnecting");
ok(/addEventListener\("beforeunload", guard\)/.test(conf), "closing the tab still warns");
ok(/RecoverTakes client=\{db\(\)\} userId=\{signedIn\}/.test(conf), "room offers recovery");
ok(/RecoverTakes client=\{db\(\)\} userId=\{user\.id\} auto/.test(host), "host page auto-recovers");
ok(/UNRECORDED_KEY/.test(host) && /NOT RECORDED/.test(host), "host page shows 'This session wasn't recorded'");
ok(/withFreeTakeLock\(meta\.id/.test(rec) && /\/api\/recording\/finish/.test(rec), "recovery takes the lock, then the normal finish path");
ok(/hasSummary/.test(rec), "recovery does not re-summarize a take the dying tab finished");
ok(/Authorization: `Bearer \$\{sess\.session\?\.access_token/.test(rec), "recovery authenticates as the signed-in user");

console.log(fail ? `\n${fail} failed` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
