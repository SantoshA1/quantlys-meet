// A recording that survives the tab.
//
// FIELD 2026-10-17: three Memory sessions on a Saturday night, and nothing
// saved. The recorder kept every 2-second piece in this tab's memory and only
// uploaded on Stop, so a tab that was closed, crashed or killed by the OS took
// the whole take with it.
//
// Now each piece is ALSO written to IndexedDB as it arrives, next to a small
// record of what the take is (room, mode, who was there, the captions so far,
// how long it ran). A normal Stop uploads exactly as before and then deletes
// the copy. If the tab dies first, the next page that loads for the same
// account finds the copy and uploads it through the same storage path and the
// same /api/recording/finish call, so notes, PRD and the Memory story are
// written from it like any other take.
//
// Whether a take is abandoned is decided by a Web Lock the recording tab holds
// for as long as it is recording or saving. A dead tab releases its locks, so
// "the lock is free" means "nobody is looking after this take". Browsers
// without Web Locks fall back to the heartbeat in `updatedAt`.
//
// Nothing here may ever stop a recording: every IndexedDB call swallows its own
// failure (private mode, quota, a browser without it) and the in-memory take
// carries on as it always has.

export type TakeKind = "v" | "a";

export type TakeMeta = {
  id: string;
  userId: string;
  room: string;
  title: string;
  /** "meeting" | "memory" — rides into the finish body as sessionMode. */
  sessionMode: string;
  /** The page that recorded it. A take from THIS page is never "recovered". */
  pageId: string;
  startedAt: number;
  updatedAt: number;
  /** On-screen elapsed seconds, kept current by the heartbeat. */
  elapsed: number;
  vExt: string;
  vMime: string;
  aExt: string;
  aMime: string;
  vBytes: number;
  aBytes: number;
  people: string[];
  captions: unknown[];
  captionText: string;
  video: Record<string, unknown> | null;
  /** Set when a normal save failed after upload was attempted. */
  lastError?: string;
};

export type TakeChunk = { takeId: string; kind: TakeKind; seq: number; data: Blob };

/** A heartbeat older than this, with no Web Locks to ask, means abandoned. */
export const ORPHAN_AFTER_MS = 30_000;
/** Anything under this is not a recording, it is a header. */
export const MIN_TAKE_BYTES = 1024;
/** After two weeks a copy is offered for discard only; still never auto-deleted. */
export const STALE_AFTER_MS = 14 * 24 * 3600_000;

export function takeLockName(id: string): string {
  return `qm-take-${id}`;
}

export function newTakeId(now = Date.now(), rand = Math.random): string {
  return `${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

/**
 * Could this take be recovered by this page, judged on the record alone?
 * (The Web Lock, where present, is the final word on whether its tab is alive.)
 */
export function isRecoverable(
  meta: Partial<TakeMeta> | null | undefined,
  opts: { userId: string; pageId: string; now?: number; locksAvailable?: boolean },
): boolean {
  if (!meta || !meta.id) return false;
  if (!opts.userId || meta.userId !== opts.userId) return false;
  if (meta.pageId && meta.pageId === opts.pageId) return false;
  const bytes = Math.max(Number(meta.vBytes) || 0, Number(meta.aBytes) || 0);
  if (bytes < MIN_TAKE_BYTES) return false;
  if (opts.locksAvailable) return true;
  const now = opts.now ?? Date.now();
  return now - (Number(meta.updatedAt) || 0) > ORPHAN_AFTER_MS;
}

/** Pieces back in the order they were recorded, whatever order IndexedDB kept. */
export function orderedParts(chunks: TakeChunk[], kind: TakeKind): Blob[] {
  return chunks
    .filter((c) => c && c.kind === kind && c.data)
    .sort((a, b) => a.seq - b.seq)
    .map((c) => c.data);
}

/**
 * Where a recovered take goes in storage. Same `${user}/${room}/${stamp}` shape
 * as a live save, so the host page and the Memory loader list it like any other.
 * A take whose video never got written (quota) still has its audio twin; that
 * becomes the "video" so finish has a primary file and the notes get written.
 */
export function recoveryPaths(meta: TakeMeta, hasVideo: boolean, hasAudio: boolean): {
  base: string; videoPath: string | null; audioPath: string | null;
} {
  const stamp = new Date(meta.startedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
  const base = `${meta.userId}/${meta.room}/${stamp}`;
  const aSuffix = meta.aExt === "m4a" ? "m4a" : "audio.webm";
  if (hasVideo) {
    return { base, videoPath: `${base}.${meta.vExt || "webm"}`, audioPath: hasAudio ? `${base}.${aSuffix}` : null };
  }
  if (hasAudio) {
    return { base, videoPath: `${base}.${meta.aExt === "m4a" ? "mp4" : "webm"}`, audioPath: null };
  }
  return { base, videoPath: null, audioPath: null };
}

/** The finish body for a recovered take — the same fields a live save sends. */
export function recoveryFinishBody(meta: TakeMeta, videoPath: string, audioPath: string | null) {
  return {
    room: meta.room,
    videoPath,
    audioPath,
    people: Array.isArray(meta.people) ? meta.people.slice(0, 40) : [],
    title: meta.title || "",
    duration_s: Math.max(0, Math.floor(Number(meta.elapsed) || 0)),
    captions: Array.isArray(meta.captions) ? meta.captions.slice(0, 4000) : [],
    captionText: String(meta.captionText || "").slice(0, 200000),
    strokes: [],
    workflow: null,
    boardSnapshotPath: null,
    sessionMode: meta.sessionMode === "memory" ? "memory" : "meeting",
    video: meta.video,
    recovered: true,
  };
}

export function describeTake(meta: Pick<TakeMeta, "startedAt" | "elapsed" | "vBytes" | "aBytes" | "sessionMode" | "title" | "room">): string {
  const mins = Math.max(1, Math.round((Number(meta.elapsed) || 0) / 60));
  const mb = ((Math.max(Number(meta.vBytes) || 0, Number(meta.aBytes) || 0)) / 1048576).toFixed(1);
  const when = new Date(meta.startedAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const what = meta.sessionMode === "memory" ? "Memory session" : "Meeting";
  return `${what}${meta.title ? ` “${meta.title}”` : ` ${meta.room}`} · ${when} · ~${mins} min · ${mb} MB`;
}

// ── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = "qm-takes";
const DB_VERSION = 1;
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("takes")) d.createObjectStore("takes", { keyPath: "id" });
        if (!d.objectStoreNames.contains("chunks")) {
          const s = d.createObjectStore("chunks", { autoIncrement: true });
          s.createIndex("takeId", "takeId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function putTake(meta: TakeMeta): Promise<boolean> {
  try {
    const d = await open();
    if (!d) return false;
    const tx = d.transaction("takes", "readwrite");
    tx.objectStore("takes").put(meta);
    return await done(tx);
  } catch { return false; }
}

/** Merge into the stored record. Missing record: nothing is written. */
export async function patchTake(id: string, patch: Partial<TakeMeta>): Promise<boolean> {
  try {
    const d = await open();
    if (!d) return false;
    const tx = d.transaction("takes", "readwrite");
    const st = tx.objectStore("takes");
    const g = st.get(id);
    g.onsuccess = () => { if (g.result) st.put({ ...g.result, ...patch, id }); };
    return await done(tx);
  } catch { return false; }
}

/** One piece. Resolves false on quota/any failure — the caller stops persisting. */
export async function putChunk(c: TakeChunk, bytesSoFar?: { vBytes?: number; aBytes?: number }): Promise<boolean> {
  try {
    const d = await open();
    if (!d) return false;
    const tx = d.transaction(["chunks", "takes"], "readwrite");
    tx.objectStore("chunks").add(c);
    if (bytesSoFar) {
      const st = tx.objectStore("takes");
      const g = st.get(c.takeId);
      g.onsuccess = () => { if (g.result) st.put({ ...g.result, ...bytesSoFar, updatedAt: Date.now() }); };
    }
    return await done(tx);
  } catch { return false; }
}

export async function listTakes(): Promise<TakeMeta[]> {
  try {
    const d = await open();
    if (!d) return [];
    const tx = d.transaction("takes", "readonly");
    const req = tx.objectStore("takes").getAll();
    const out = await new Promise<TakeMeta[]>((resolve) => {
      req.onsuccess = () => resolve((req.result as TakeMeta[]) || []);
      req.onerror = () => resolve([]);
    });
    return out;
  } catch { return []; }
}

export async function readChunks(takeId: string): Promise<TakeChunk[]> {
  try {
    const d = await open();
    if (!d) return [];
    const tx = d.transaction("chunks", "readonly");
    const req = tx.objectStore("chunks").index("takeId").getAll(takeId);
    return await new Promise<TakeChunk[]>((resolve) => {
      req.onsuccess = () => resolve((req.result as TakeChunk[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

export async function deleteTake(takeId: string): Promise<boolean> {
  try {
    const d = await open();
    if (!d) return false;
    const tx = d.transaction(["chunks", "takes"], "readwrite");
    tx.objectStore("takes").delete(takeId);
    const idx = tx.objectStore("chunks").index("takeId");
    const cur = idx.openKeyCursor(IDBKeyRange.only(takeId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { tx.objectStore("chunks").delete(c.primaryKey); c.continue(); }
    };
    return await done(tx);
  } catch { return false; }
}

// ── Web Locks ────────────────────────────────────────────────────────────────

export function locksAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as any).locks?.request);
}

/**
 * Hold the take's lock until `release` is called. The recording tab calls this
 * at Start and releases after its own save. A crashed tab releases it for us.
 */
export function holdTakeLock(id: string): () => void {
  let release = () => {};
  if (!locksAvailable()) return release;
  const p = new Promise<void>((r) => { release = r; });
  try {
    (navigator as any).locks.request(takeLockName(id), { mode: "exclusive" }, () => p).catch(() => {});
  } catch { /* no lock: the heartbeat still protects the take */ }
  return () => release();
}

/**
 * Run `fn` only if nobody holds the take's lock (its tab is gone and no other
 * tab is already recovering it). Returns null when the lock was taken.
 */
export async function withFreeTakeLock<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  if (!locksAvailable()) return fn();
  try {
    return await (navigator as any).locks.request(
      takeLockName(id), { mode: "exclusive", ifAvailable: true },
      async (lock: unknown) => (lock ? fn() : null),
    );
  } catch {
    return null;
  }
}

/** Is a take's lock free right now? (A query, no waiting.) */
export async function takeLockFree(id: string): Promise<boolean> {
  if (!locksAvailable()) return true;
  try {
    const q = await (navigator as any).locks.query();
    const held: Array<{ name?: string }> = [...(q?.held || []), ...(q?.pending || [])];
    return !held.some((l) => l?.name === takeLockName(id));
  } catch {
    return true;
  }
}

/** One id per page load: a take recorded by this page is never "abandoned". */
export const PAGE_ID: string = typeof window === "undefined" ? "server" : newTakeId();
