// What a meeting owns in the `recordings` bucket, and how to remove it for real.
//
// FIELD 2026-10-19 (self-host test before Show HN): Delete answered
// "deleted: true" while every take it had made was still in storage. It only
// ever looked at `recordings` table rows — LiveKit Egress bookkeeping — and the
// in-browser recorder that every real meeting uses never writes one. Video,
// audio twin, board snapshot and the .summary.json transcript all sat on under
// `<hostId>/<room>/`, readable by a signed link, while the list said "gone".
//
// The same blind spot made retention a label: /meetings printed "DELETES 18
// NOV" from RECORDING_RETENTION_DAYS, and the nightly cron only read
// `recordings.expires_at` — so nothing was ever past it.
//
// Rules this file keeps:
//   * A listing that ERRORS is not an empty folder. Callers stop instead of
//     reporting success.
//   * Scope is the host's own prefix. Nothing outside `<hostId>/` is touched.
//   * A deletion is only reported once a re-list shows the files are gone.
//
// Takes an untyped Supabase client so the unit tests can hand it a fake.

import { glossaryPath } from "./keyterms.ts";

export const BUCKET = "recordings";
const PAGE = 100;

/** Folders under a host's prefix that are NOT meeting rooms: project-level
 *  PRDs, project briefs, glossaries (prd/) and Memory packages (memory/). */
export const NON_ROOM_FOLDERS = new Set(["prd", "memory"]);

export type Listed = { name: string; id: string | null; created_at?: string | null; metadata?: any };

/** A room name that can safely be used as ONE path segment. */
export function safeSegment(s: string): boolean {
  const v = String(s || "");
  return !!v && v.length <= 200 && !v.includes("/") && !v.includes("\\") && v !== "." && v !== ".." && !NON_ROOM_FOLDERS.has(v) && v !== "shares";
}

/** Every entry directly under `prefix`, paged until a short page. */
export async function listAll(sb: any, prefix: string, cap = 20000): Promise<{ items: Listed[]; error?: string }> {
  const items: Listed[] = [];
  for (let offset = 0; offset < cap; offset += PAGE) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) return { items, error: `list ${prefix}: ${error.message || String(error)}` };
    const page: Listed[] = data || [];
    items.push(...page);
    if (page.length < PAGE) return { items };
  }
  return { items, error: `list ${prefix}: more than ${cap} entries` };
}

/** Every FILE under `prefix`, descending into sub-folders (storage lists a
 *  folder as an entry with id null). */
export async function listTree(sb: any, prefix: string, depth = 4): Promise<{ files: (Listed & { path: string })[]; error?: string }> {
  const out: (Listed & { path: string })[] = [];
  const got = await listAll(sb, prefix);
  if (got.error) return { files: out, error: got.error };
  for (const it of got.items) {
    const path = `${prefix}/${it.name}`;
    if (it.id) out.push({ ...it, path });
    else if (depth > 0) {
      const sub = await listTree(sb, path, depth - 1);
      if (sub.error) return { files: out, error: sub.error };
      out.push(...sub.files);
    }
  }
  return { files: out };
}

/** Is `name` (a file directly in `folder`) present? Exact match, not search. */
async function exists(sb: any, folder: string, name: string): Promise<{ yes: boolean; error?: string }> {
  const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: PAGE, search: name });
  if (error) return { yes: false, error: `list ${folder}: ${error.message || String(error)}` };
  return { yes: (data || []).some((f: Listed) => f.id && f.name === name) };
}

/** Everything one host's meeting wrote: the takes under `<hostId>/<room>/`
 *  (video, audio twin, board, .summary.json) and the meeting's caption
 *  glossary in `<hostId>/prd/`. Project-level PRD / Memory files are NOT
 *  included — a project spans meetings, and one Delete must not erase the
 *  document the other meetings built. */
export async function meetingStoragePaths(sb: any, hostId: string, room: string): Promise<{ paths: string[]; error?: string }> {
  if (!safeSegment(hostId) || !safeSegment(room)) return { paths: [], error: "unsafe host or room name" };
  const tree = await listTree(sb, `${hostId}/${room}`);
  if (tree.error) return { paths: [], error: tree.error };
  const paths = tree.files.map((f) => f.path);
  const g = glossaryPath(hostId, room);
  const slash = g.lastIndexOf("/");
  const has = await exists(sb, g.slice(0, slash), g.slice(slash + 1));
  if (has.error) return { paths: [], error: has.error };
  if (has.yes) paths.push(g);
  return { paths };
}

/** Is `prefix` (from a legacy Egress `recordings` row) inside this meeting's
 *  own space? Only the host's folder, or an Egress-style `<room>/...`. */
export function prefixInScope(prefix: string, hostId: string, room: string): boolean {
  const p = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (!p || p.split("/").some((s) => s === ".." || s === ".")) return false;
  const first = p.split("/")[0];
  return first === hostId || first === room;
}

/** Remove paths in bounded batches. `removed` counts what storage says it
 *  removed, not what was asked for. */
export async function removePaths(sb: any, paths: string[]): Promise<{ removed: number; error?: string }> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += PAGE) {
    const batch = paths.slice(i, i + PAGE);
    const { data, error } = await sb.storage.from(BUCKET).remove(batch);
    if (error) return { removed, error: error.message || String(error) };
    removed += Array.isArray(data) ? data.length : 0;
  }
  return { removed };
}

/** Which of `paths` still exist, by re-listing their folders. */
export async function stillThere(sb: any, paths: string[]): Promise<{ left: string[]; error?: string }> {
  const byFolder = new Map<string, Set<string>>();
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    const dir = p.slice(0, i), name = p.slice(i + 1);
    if (!byFolder.has(dir)) byFolder.set(dir, new Set());
    byFolder.get(dir)!.add(name);
  }
  const left: string[] = [];
  for (const [dir, names] of byFolder) {
    const got = await listAll(sb, dir);
    if (got.error) return { left, error: got.error };
    for (const it of got.items) if (it.id && names.has(it.name)) left.push(`${dir}/${it.name}`);
  }
  return { left };
}

// ── Retention ────────────────────────────────────────────────────────────

/** RECORDING_RETENTION_DAYS as a whole number of days; 0 = keep forever.
 *  Unset means OFF, never a default — /meetings says "No automatic deletion
 *  is configured" in exactly that case, and the cron must agree with it. */
export function retentionDays(raw: string | undefined | null): number {
  const d = Number(raw);
  return Number.isFinite(d) && d > 0 ? Math.floor(d) : 0;
}

/** A take's files share the stem before the first dot:
 *  `2026-10-17T01-05-00-000Z.webm`, `.audio.webm`, `.m4a`, `.board.jpg`,
 *  `.board.json`, `.summary.json`. */
export function takeStem(name: string): string {
  const s = String(name || "");
  const i = s.indexOf(".");
  return i > 0 ? s.slice(0, i) : s;
}

const VIDEO = /\.(webm|mp4|mkv|mov)$/i;
const AUDIO_TWIN = /\.(audio\.webm|m4a)$/i;

export type DueTake = { owner: string; room: string; stem: string; created: string; deletesOn: string; paths: string[]; bytes: number };

/** Group one room folder's files into takes and decide which are past the
 *  window. A take's date is its video's created_at — the same date /meetings
 *  adds the retention to — or, with no video, its oldest file. */
export function dueTakes(owner: string, room: string, files: Listed[], days: number, nowMs: number): DueTake[] {
  if (days <= 0) return [];
  const groups = new Map<string, Listed[]>();
  for (const f of files) {
    if (!f.id) continue;
    const st = takeStem(f.name);
    if (!groups.has(st)) groups.set(st, []);
    groups.get(st)!.push(f);
  }
  const out: DueTake[] = [];
  for (const [stem, fs] of groups) {
    const video = fs.find((f) => VIDEO.test(f.name) && !AUDIO_TWIN.test(f.name));
    const times = (video ? [video] : fs).map((f) => Date.parse(String(f.created_at || ""))).filter(Number.isFinite);
    if (!times.length) continue;            // no date we can trust → keep it
    const created = Math.min(...times);
    const deletesOn = created + days * 86400000;
    if (deletesOn > nowMs) continue;
    out.push({
      owner, room, stem,
      created: new Date(created).toISOString(),
      deletesOn: new Date(deletesOn).toISOString(),
      paths: fs.map((f) => `${owner}/${room}/${f.name}`),
      bytes: fs.reduce((n, f) => n + (Number(f.metadata?.size) || 0), 0),
    });
  }
  return out;
}

/** Walk the bucket (`<owner>/<room>/<files>`) and list every take past the
 *  window. READ-ONLY — the cron deletes what this returns; a dry run prints it. */
export async function planRetention(sb: any, days: number, nowMs: number): Promise<{ due: DueTake[]; error?: string; scanned: number }> {
  if (days <= 0) return { due: [], scanned: 0 };
  const root = await listAll(sb, "");
  if (root.error) return { due: [], scanned: 0, error: root.error };
  const due: DueTake[] = [];
  let scanned = 0;
  for (const owner of root.items.filter((f) => !f.id && safeSegment(f.name))) {
    const rooms = await listAll(sb, owner.name);
    if (rooms.error) return { due, scanned, error: rooms.error };
    for (const room of rooms.items.filter((f) => !f.id && safeSegment(f.name))) {
      const files = await listAll(sb, `${owner.name}/${room.name}`);
      if (files.error) return { due, scanned, error: files.error };
      scanned += files.items.length;
      due.push(...dueTakes(owner.name, room.name, files.items, days, nowMs));
    }
  }
  return { due, scanned };
}
