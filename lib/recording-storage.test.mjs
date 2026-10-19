// node --experimental-strip-types lib/recording-storage.test.mjs
import fs from "node:fs";
import {
  meetingStoragePaths, removePaths, stillThere, listTree, prefixInScope, safeSegment,
  retentionDays, takeStem, dueTakes, planRetention,
} from "./recording-storage.ts";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };

/** In-memory stand-in for supabase.storage, with the same list semantics:
 *  direct children only, folders as { id: null }, paged by limit/offset. */
function fakeSb(files, opts = {}) {
  const store = new Map(Object.entries(files)); // path -> created_at
  const calls = { removed: [] };
  const bucket = {
    async list(prefix, o = {}) {
      if (opts.listError && (opts.listError === true || prefix.startsWith(opts.listError))) return { data: null, error: { message: "boom" } };
      const pre = prefix ? prefix + "/" : "";
      const seen = new Map();
      for (const [p, created] of store) {
        if (!p.startsWith(pre)) continue;
        const rest = p.slice(pre.length);
        const i = rest.indexOf("/");
        const name = i < 0 ? rest : rest.slice(0, i);
        if (o.search && !name.includes(o.search)) continue;
        if (!seen.has(name)) seen.set(name, i < 0 ? { name, id: "id-" + p, created_at: created, metadata: { size: 10 } } : { name, id: null });
      }
      const all = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
      const off = o.offset || 0, lim = o.limit || 100;
      return { data: all.slice(off, off + lim), error: null };
    },
    async remove(paths) {
      if (opts.removeError) return { data: null, error: { message: "nope" } };
      const done = [];
      for (const p of paths) {
        if (opts.sticky && p.includes(opts.sticky)) continue;   // storage "succeeds" but keeps it
        if (store.delete(p)) done.push({ name: p });
      }
      calls.removed.push(...paths);
      return { data: done, error: null };
    },
  };
  return { storage: { from: () => bucket }, store, calls };
}

const H = "11111111-1111-1111-1111-111111111111", O = "22222222-2222-2222-2222-222222222222";
const R = "qm-abc-123";
const T = "2026-10-01T10-00-00-000Z";
const base = () => ({
  [`${H}/${R}/${T}.webm`]: "2026-10-01T10:00:00Z",
  [`${H}/${R}/${T}.audio.webm`]: "2026-10-01T10:00:01Z",
  [`${H}/${R}/${T}.summary.json`]: "2026-10-01T10:01:00Z",
  [`${H}/${R}/${T}.board.jpg`]: "2026-10-01T10:00:30Z",
  [`${H}/prd/${R}.glossary.json`]: "2026-10-01T09:00:00Z",
  [`${H}/prd/apollo.prd.json`]: "2026-10-01T11:00:00Z",       // project-level, kept
  [`${H}/memory/apollo.memory.json`]: "2026-10-01T11:00:00Z",
  [`${H}/${R}-2/${T}.webm`]: "2026-10-01T10:00:00Z",          // a DIFFERENT room with a shared prefix
  [`${O}/${R}/${T}.webm`]: "2026-10-01T10:00:00Z",            // someone else's folder
  [`shares/abcdef.json`]: "2026-10-01T10:00:00Z",
});

// ── Delete: what a meeting owns ──
{
  const sb = fakeSb(base());
  const m = await meetingStoragePaths(sb, H, R);
  ok(!m.error, "lists without error");
  ok(m.paths.length === 5, `finds the 4 take files + glossary (got ${m.paths.length})`);
  ok(m.paths.every((p) => p.startsWith(`${H}/${R}/`) || p === `${H}/prd/${R}.glossary.json`), "every path is inside this host + room");
  ok(!m.paths.some((p) => p.includes(`${R}-2/`)), "a room whose name merely starts the same is not touched");
  ok(!m.paths.some((p) => p.startsWith(O)), "another user's folder is not touched");
  ok(!m.paths.some((p) => p.endsWith(".prd.json") || p.endsWith(".memory.json")), "project-level PRD/Memory are kept");
  const r = await removePaths(sb, m.paths);
  ok(!r.error && r.removed === 5, "removes them and counts what storage removed");
  const left = await stillThere(sb, m.paths);
  ok(!left.error && left.left.length === 0, "re-list confirms they are gone");
  ok(sb.store.has(`${H}/${R}-2/${T}.webm`) && sb.store.has(`${O}/${R}/${T}.webm`) && sb.store.has(`${H}/prd/apollo.prd.json`), "neighbours survive");
}
{
  const many = {};
  for (let i = 0; i < 250; i++) many[`${H}/${R}/t${String(i).padStart(3, "0")}.webm`] = "2026-10-01T10:00:00Z";
  const sb = fakeSb(many);
  const m = await meetingStoragePaths(sb, H, R);
  ok(m.paths.length === 250, "pages past 100 files (250 listed)");
  const r = await removePaths(sb, m.paths);
  ok(r.removed === 250 && sb.store.size === 0, "removes in batches");
}
{
  const sb = fakeSb({ ...base(), [`${H}/${R}/sub/x.webm`]: "2026-10-01T10:00:00Z" });
  const t = await listTree(sb, `${H}/${R}`);
  ok(t.files.some((f) => f.path === `${H}/${R}/sub/x.webm`), "descends into sub-folders");
}
{
  const sb = fakeSb(base(), { listError: `${H}/${R}` });
  const m = await meetingStoragePaths(sb, H, R);
  ok(!!m.error && m.paths.length === 0, "a listing ERROR is reported, not treated as an empty folder");
}
{
  const sb = fakeSb(base(), { removeError: true });
  const r = await removePaths(sb, [`${H}/${R}/${T}.webm`]);
  ok(!!r.error && r.removed === 0, "a remove error is reported");
}
{
  const sb = fakeSb(base(), { sticky: ".webm" });
  const m = await meetingStoragePaths(sb, H, R);
  await removePaths(sb, m.paths);
  const left = await stillThere(sb, m.paths);
  ok(left.left.length === 2, "a file storage silently kept is caught by the re-list");
}
ok(!safeSegment("a/b") && !safeSegment("..") && !safeSegment("") && !safeSegment("prd") && !safeSegment("shares") && safeSegment(R), "unsafe room names refused");
{
  const m = await meetingStoragePaths(fakeSb(base()), H, "../x");
  ok(!!m.error, "path traversal in a room name is refused");
}
ok(prefixInScope(`${H}/${R}/old`, H, R) && prefixInScope(`${R}/egress`, H, R), "egress prefixes in the host folder / room are in scope");
ok(!prefixInScope(`${O}/${R}`, H, R) && !prefixInScope("", H, R) && !prefixInScope(`${H}/../${O}`, H, R), "anything else is out of scope");

// ── Retention ──
ok(retentionDays(undefined) === 0 && retentionDays("") === 0 && retentionDays("0") === 0 && retentionDays("-3") === 0 && retentionDays("abc") === 0, "unset/0/garbage = OFF (no default window)");
ok(retentionDays("30") === 30 && retentionDays("7.9") === 7, "whole days");
ok(takeStem(`${T}.audio.webm`) === T && takeStem(`${T}.summary.json`) === T, "files group by take stem");
{
  const now = Date.parse("2026-11-05T00:00:00Z");
  const files = [
    { name: `${T}.webm`, id: "1", created_at: "2026-10-01T10:00:00Z", metadata: { size: 100 } },
    { name: `${T}.summary.json`, id: "2", created_at: "2026-10-30T10:00:00Z", metadata: { size: 5 } },  // rewritten later, still same take
    { name: "2026-10-20T10-00-00-000Z.webm", id: "3", created_at: "2026-10-20T10:00:00Z" },
  ];
  const d = dueTakes(H, R, files, 30, now);
  ok(d.length === 1 && d[0].stem === T, "only the take whose VIDEO is older than 30 days is due");
  ok(d[0].paths.length === 2 && d[0].bytes === 105, "the whole take goes: video and its summary");
  ok(dueTakes(H, R, files, 0, now).length === 0, "retention OFF deletes nothing");
  ok(dueTakes(H, R, [{ name: "x.webm", id: "9", created_at: null }], 1, now).length === 0, "no trustworthy date → kept");
}
{
  const sb = fakeSb(base());
  const now = Date.parse("2026-11-05T00:00:00Z");
  const p = await planRetention(sb, 30, now);
  ok(!p.error, "plan walks the bucket");
  const owners = new Set(p.due.map((t) => t.owner));
  ok(p.due.length === 3 && owners.has(H) && owners.has(O), `due takes across owners (got ${p.due.length})`);
  ok(!p.due.some((t) => t.room === "prd" || t.room === "memory" || t.owner === "shares"), "prd/, memory/ and shares/ are never retention targets");
  ok(sb.calls.removed.length === 0, "planning is read-only");
  const off = await planRetention(sb, 0, now);
  ok(off.due.length === 0 && off.scanned === 0, "OFF: does not even walk");
  const bad = await planRetention(fakeSb(base(), { listError: H }), 30, now);
  ok(!!bad.error, "a listing error stops the plan");
}

// ── Route guards (source) ──
const del = fs.readFileSync(new URL("../app/api/meetings/delete/route.ts", import.meta.url), "utf8");
ok(del.includes("meetingStoragePaths(sb, hostId, room)") && del.includes("stillThere("), "Delete removes the host's room folder and re-checks before success");
ok(!/storage_error/.test(del), "Delete no longer swallows storage errors into a success response");
const cron = fs.readFileSync(new URL("../app/api/cron/cleanup/route.ts", import.meta.url), "utf8");
ok(cron.includes("planRetention(") && cron.includes("retentionDays(process.env.RECORDING_RETENTION_DAYS)"), "cron deletes browser recordings past RECORDING_RETENTION_DAYS");
ok(cron.indexOf("CRON_SECRET") < cron.indexOf("planRetention("), "cron checks CRON_SECRET before touching storage");
const tok = fs.readFileSync(new URL("../app/api/room/token/route.ts", import.meta.url), "utf8");
ok(!/return open;\s*\/\/ DB hiccup|the door fails OPEN/.test(tok), "room token: no fail-open on lookup errors");
ok(/door\.unavailable[\s\S]{0,400}status: 503/.test(tok), "room token: lookup error → 503");
ok(/if \(!url \|\| !key\) return open;/.test(tok), "room token: deliberate no-database mode unchanged");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
