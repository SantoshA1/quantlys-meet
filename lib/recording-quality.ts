// Recording quality + upload path for the continuous take.
//
// FIELD 2026-10-05 (Santosh): keep continuous full-video handoffs (MP4/WebM +
// captions + audio + .md), but record at **720p** to save storage cost —
// not 1080p. Pre-#81 was 1280×720 @ 24fps / 2.5 Mbps; that is the preset
// again. Cameras capture at 720p; remote guests are still drawn from
// off-screen twins so adaptiveStream can pull the top (720p) layer rather
// than a tiny on-screen tile.
//
// Upload stays resumable (TUS, 6 MB transport chunks). The STORED OBJECT is
// still one continuous file — chunking is only how the bytes travel.
//
// ZERO-IMPORT so the judgements stay offline-testable.

export type RecordingPreset = {
  width: number;
  height: number;
  fps: number;
  videoBitsPerSecond: number;
  label: string;
};

/** The take. 720p24 at 2.5 Mbps — matches pre-#81 storage savings;
 *  ~1.1 GB per hour (~19 MB/min). */
export const RECORDING_PRESET: RecordingPreset = {
  width: 1280,
  height: 720,
  fps: 24,
  videoBitsPerSecond: 2_500_000,
  label: "720p",
};

/** Human label for stored video metadata: 2160 → "4K", 1080 → "1080p". */
export function videoQualityLabel(height: unknown): string {
  const h = Math.floor(Number(height) || 0);
  if (h <= 0) return "";
  if (h >= 2160) return "4K";
  if (h >= 1440) return "1440p";
  return `${h}p`;
}

export type StoredVideoMeta = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  container: "mp4" | "webm";
  mime: string;
  continuous: true;
};

/** Accept the recorder's self-report for the summary JSON. Anything odd is
 *  dropped rather than stored — a label must never claim what wasn't made. */
export function acceptVideoMeta(raw: unknown): StoredVideoMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const width = Math.floor(Number(o.width));
  const height = Math.floor(Number(o.height));
  const fps = Math.floor(Number(o.fps));
  const bitrate = Math.floor(Number(o.bitrate));
  const container = String(o.container || "").toLowerCase();
  if (!(width >= 160 && width <= 7680 && height >= 90 && height <= 4320)) return null;
  if (!(fps >= 1 && fps <= 120)) return null;
  if (container !== "mp4" && container !== "webm") return null;
  return {
    width, height, fps,
    bitrate: bitrate > 0 && bitrate <= 100_000_000 ? bitrate : 0,
    container,
    mime: String(o.mime || "").slice(0, 120),
    continuous: true,
  };
}

// ── Resumable (TUS) upload to Supabase Storage ─────────────────────────────

/** Supabase requires exactly 6 MB per PATCH (last one may be shorter). */
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;
/** Above this, use resumable. Below it, the one-shot upload is fine. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

export function resumableEndpoint(supabaseUrl: string): string {
  return `${String(supabaseUrl || "").replace(/\/+$/, "")}/storage/v1/upload/resumable`;
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** TUS Upload-Metadata: comma-separated `key base64(value)`. */
export function tusMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .filter(([k, v]) => k && v != null)
    .map(([k, v]) => `${k} ${b64(String(v))}`)
    .join(",");
}

/** What the person sees when storage refuses the take. */
export function uploadRefusalText(status: number | undefined, body: string): string {
  const b = String(body || "");
  if (status === 413 || /maximum allowed size|too large|payload too large|exceeded/i.test(b)) {
    return "Cloud storage refused a file this size (the project upload limit is lower than the take). The full-resolution take is still in this tab — download it now.";
  }
  if (status === 401 || status === 403) {
    return "Cloud storage refused the upload (sign-in expired or no permission). The take is still in this tab — download it now.";
  }
  return `Upload failed${status ? ` (${status})` : ""}${b ? `: ${b.slice(0, 140)}` : ""}. The take is still in this tab — download it now.`;
}

export type ResumableResult = { ok: true } | { ok: false; status?: number; error: string };

type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean; status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export async function resumableUpload(opts: {
  endpoint: string;
  token: string;
  apikey: string;
  bucket: string;
  objectName: string;
  blob: Blob;
  contentType: string;
  upsert?: boolean;
  chunkBytes?: number;
  retries?: number;
  onProgress?: (sent: number, total: number) => void;
  fetchImpl?: FetchLike;
}): Promise<ResumableResult> {
  const f: FetchLike = opts.fetchImpl || ((u, i) => fetch(u, i) as any);
  const size = opts.blob.size;
  const chunk = Math.max(1, opts.chunkBytes || RESUMABLE_CHUNK_BYTES);
  const retries = Math.max(0, opts.retries ?? 4);
  const base = {
    Authorization: `Bearer ${opts.token}`,
    apikey: opts.apikey,
    "Tus-Resumable": "1.0.0",
  };

  let create;
  try {
    create = await f(opts.endpoint, {
      method: "POST",
      headers: {
        ...base,
        "Upload-Length": String(size),
        "Upload-Metadata": tusMetadata({
          bucketName: opts.bucket,
          objectName: opts.objectName,
          contentType: opts.contentType,
          cacheControl: "3600",
        }),
        "x-upsert": opts.upsert ? "true" : "false",
      },
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach storage." };
  }
  if (!create.ok) {
    const t = await create.text().catch(() => "");
    return { ok: false, status: create.status, error: uploadRefusalText(create.status, t) };
  }
  const loc = create.headers.get("location") || create.headers.get("Location");
  if (!loc) return { ok: false, error: "Storage did not return an upload location." };
  const url = /^https?:/i.test(loc) ? loc : new URL(loc, opts.endpoint).toString();

  let offset = 0;
  let failures = 0;
  while (offset < size) {
    const end = Math.min(size, offset + chunk);
    try {
      const r = await f(url, {
        method: "PATCH",
        headers: {
          ...base,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: opts.blob.slice(offset, end),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        // 409 = offset mismatch: ask the server where it is and carry on.
        if (r.status === 409 && failures < retries) {
          failures++;
          const at = await headOffset(f, url, base);
          if (at != null) { offset = at; continue; }
        }
        if (r.status >= 500 && failures < retries) { failures++; continue; }
        return { ok: false, status: r.status, error: uploadRefusalText(r.status, t) };
      }
      const next = Number(r.headers.get("upload-offset") ?? r.headers.get("Upload-Offset"));
      offset = Number.isFinite(next) && next > offset ? next : end;
      failures = 0;
      opts.onProgress?.(offset, size);
    } catch (e: any) {
      if (failures >= retries) return { ok: false, error: uploadRefusalText(undefined, e?.message || "network error") };
      failures++;
      const at = await headOffset(f, url, base);
      if (at != null) offset = at;
    }
  }
  return { ok: true };
}

async function headOffset(f: FetchLike, url: string, base: Record<string, string>): Promise<number | null> {
  try {
    const h = await f(url, { method: "HEAD", headers: base });
    const n = Number(h.headers.get("upload-offset") ?? h.headers.get("Upload-Offset"));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
