// Memory episodes / chapters for writers & podcasters.
//
// A Memory *project* is a book or show. Each Memory-tagged recording is one
// episode (or manuscript chapter). The host can reorder them; Build can target
// the whole show or a single episode. Clip export cuts time ranges from the
// stored audio when chapter `at` cues or transcript timestamps exist.
//
// ZERO-IMPORT so judgements stay offline-testable.
//
// V1 LIMITS (documented, not papered over):
// - Episode list comes from recordings whose summary has sessionMode=memory
//   (falls back to any project recording when none are tagged Memory yet).
// - Intra-recording chapter clips need MemoryPackage.chapters[].at clocks
//   (mm:ss / hh:mm:ss / Ns). Without `at`, that chapter is listed but not cut.
// - Quote clips need a timed utterance whose text contains the quote. When
//   Deepgram/captions left no timestamps, quotes stay in the package markdown
//   but are not downloadable as audio clips.

export type MemoryEpisode = {
  /** Stable id — the summary storage path. */
  id: string;
  path: string;
  room: string;
  title: string;
  at: string;
  sessionMode: "memory" | "meeting";
  audioPath?: string | null;
  videoPath?: string | null;
  /** Height of the continuous take (720 = 720p) when the recorder reported it. */
  videoHeight?: number | null;
  durationSec?: number | null;
  /** 0-based position after applying saved order. */
  order: number;
};

export type MemoryChapterOrderDoc = {
  project: string;
  /** Ordered episode ids (summary paths). Unknown ids are ignored on apply. */
  order: string[];
  at: string;
};

export type MemoryClipKind = "episode" | "chapter" | "quote";

export type MemoryClip = {
  id: string;
  kind: MemoryClipKind;
  label: string;
  startSec: number;
  endSec: number;
  /** Storage path of the source audio (m4a / audio.webm). */
  audioPath?: string | null;
  /** Summary path the clip came from. */
  sourcePath?: string;
  ready: boolean;
  /** Why this clip cannot be cut yet — shown honestly in the host UI. */
  limit?: string;
};

export const MEMORY_CLIP_PAD_BEFORE_S = 1.5;
export const MEMORY_CLIP_PAD_AFTER_S = 2.5;
export const MEMORY_CLIP_MIN_LEN_S = 1;
export const MEMORY_CLIP_MAX_LEN_S = 600;

/** Sidecar next to the Memory package JSON — saved episode order. */
export function memoryChaptersPath(userId: string, projectName: string): string {
  const slug =
    String(projectName || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return `${String(userId || "")}/memory/${slug}.chapters.json`;
}

export function acceptChapterOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const id = String(x || "").trim();
    if (!id || seen.has(id)) continue;
    // Paths are owner/room/file — refuse path traversal junk.
    if (id.includes("..") || id.startsWith("/")) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * Parse a chapter clock cue into seconds.
 * Accepts: "mm:ss", "h:mm:ss", "90s", "90", 90.
 * Returns null when missing or unparseable — caller must not invent a cut.
 */
export function parseClock(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?s$/i.test(s)) {
    return Math.max(0, Math.floor(parseFloat(s)));
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Math.max(0, Math.floor(parseFloat(s)));
  }
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let sec = 0;
  if (nums.length === 3) {
    const [h, m, s2] = nums;
    if (m >= 60 || s2 >= 60) return null;
    sec = h * 3600 + m * 60 + s2;
  } else {
    const [m, s2] = nums;
    if (s2 >= 60) return null;
    sec = m * 60 + s2;
  }
  return sec;
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function clean(s: any): string {
  return String(s || "").trim();
}

/** Build episode rows from summary sidecars (caller already filtered by project). */
export function episodesFromSummaries(
  rows: Array<{
    path: string;
    title?: string;
    room?: string;
    at?: string;
    sessionMode?: string;
    audioPath?: string | null;
    videoPath?: string | null;
    videoHeight?: number | null;
    durationSec?: number | null;
  }>,
  savedOrder: string[] = []
): MemoryEpisode[] {
  const base: MemoryEpisode[] = (rows || [])
    .filter((r) => clean(r?.path))
    .map((r) => ({
      id: clean(r.path),
      path: clean(r.path),
      room: clean(r.room),
      title: clean(r.title) || clean(r.room) || "Untitled episode",
      at: clean(r.at),
      sessionMode: clean(r.sessionMode).toLowerCase() === "memory" ? "memory" : "meeting",
      audioPath: r.audioPath ? clean(r.audioPath) : null,
      videoPath: r.videoPath ? clean(r.videoPath) : null,
      videoHeight:
        typeof r.videoHeight === "number" && r.videoHeight > 0 ? Math.floor(r.videoHeight) : null,
      durationSec:
        typeof r.durationSec === "number" && Number.isFinite(r.durationSec)
          ? Math.max(0, Math.floor(r.durationSec))
          : null,
      order: 0,
    }));

  // Default chronological by `at`, then path — oldest first (book / show order).
  base.sort((a, b) => {
    const aa = a.at || "";
    const bb = b.at || "";
    if (aa && bb && aa !== bb) return aa < bb ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return applyEpisodeOrder(base, savedOrder);
}

/** Reorder episodes: saved ids first (in that order), then any leftovers. */
export function applyEpisodeOrder(episodes: MemoryEpisode[], savedOrder: string[]): MemoryEpisode[] {
  const byId = new Map(episodes.map((e) => [e.id, e]));
  const out: MemoryEpisode[] = [];
  const seen = new Set<string>();
  for (const id of acceptChapterOrder(savedOrder)) {
    const hit = byId.get(id);
    if (!hit || seen.has(id)) continue;
    seen.add(id);
    out.push(hit);
  }
  for (const e of episodes) {
    if (seen.has(e.id)) continue;
    out.push(e);
  }
  return out.map((e, i) => ({ ...e, order: i }));
}

/** Prefer Memory-tagged episodes; if none, keep the project pool (honest fallback). */
export function preferMemoryEpisodes(episodes: MemoryEpisode[]): {
  episodes: MemoryEpisode[];
  usedFallback: boolean;
} {
  const mem = episodes.filter((e) => e.sessionMode === "memory");
  if (mem.length) return { episodes: mem.map((e, i) => ({ ...e, order: i })), usedFallback: false };
  return { episodes, usedFallback: episodes.length > 0 };
}

export function slugClipLabel(label: string, max = 48): string {
  const s =
    String(label || "clip")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "clip";
  return s.slice(0, max);
}

function clampRange(
  start: number,
  end: number,
  durationSec: number | null | undefined
): { startSec: number; endSec: number } | null {
  let a = Math.max(0, Math.floor(start));
  let b = Math.max(0, Math.floor(end));
  if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) {
    const d = Math.floor(durationSec);
    a = Math.min(a, d);
    b = Math.min(b, d);
  }
  if (b - a < MEMORY_CLIP_MIN_LEN_S) return null;
  if (b - a > MEMORY_CLIP_MAX_LEN_S) b = a + MEMORY_CLIP_MAX_LEN_S;
  return { startSec: a, endSec: b };
}

/**
 * Intra-recording chapter clips from Memory package chapter headings that
 * carry an `at` cue. End = next chapter start (or duration / +5 min guess).
 */
export function chapterBoundaryClips(opts: {
  chapters: Array<{ heading?: string; at?: string; body?: string }>;
  audioPath?: string | null;
  sourcePath?: string;
  durationSec?: number | null;
  episodeLabel?: string;
}): MemoryClip[] {
  const chapters = Array.isArray(opts.chapters) ? opts.chapters : [];
  const timed = chapters.map((c, i) => ({
    i,
    heading: clean(c.heading) || `Chapter ${i + 1}`,
    at: parseClock(c.at),
    rawAt: clean(c.at),
  }));

  const out: MemoryClip[] = [];
  for (let i = 0; i < timed.length; i++) {
    const cur = timed[i];
    const id = `chapter-${i}-${slugClipLabel(cur.heading)}`;
    if (cur.at == null) {
      out.push({
        id,
        kind: "chapter",
        label: cur.heading,
        startSec: 0,
        endSec: 0,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: cur.rawAt
          ? `Chapter cue "${cur.rawAt}" is not a parseable clock (need mm:ss or seconds).`
          : "No timestamp on this chapter — add an mm:ss cue in the Memory package, or re-build after a captioned session.",
      });
      continue;
    }
    const nextTimed = timed.slice(i + 1).find((t) => t.at != null);
    const endGuess =
      nextTimed?.at != null
        ? nextTimed.at
        : opts.durationSec != null && opts.durationSec > cur.at
          ? opts.durationSec
          : cur.at + 120;
    const range = clampRange(cur.at, endGuess, opts.durationSec);
    if (!range) {
      out.push({
        id,
        kind: "chapter",
        label: cur.heading,
        startSec: cur.at,
        endSec: cur.at,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "Chapter window is too short to cut.",
      });
      continue;
    }
    if (!opts.audioPath) {
      out.push({
        id,
        kind: "chapter",
        label: cur.heading,
        ...range,
        audioPath: null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "No audio-only file beside this recording — Record with audio sidecar to export clips.",
      });
      continue;
    }
    out.push({
      id,
      kind: "chapter",
      label: cur.heading,
      ...range,
      audioPath: opts.audioPath,
      sourcePath: opts.sourcePath,
      ready: true,
    });
  }
  return out;
}

function normText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match notable quotes to timed utterances. Returns ready clips when a line
 * contains the quote (or the quote contains a long enough line fragment).
 */
export function quoteClips(opts: {
  quotes: string[];
  utterances: Array<{ start?: number; end?: number; transcript?: string; who?: string }>;
  audioPath?: string | null;
  sourcePath?: string;
  durationSec?: number | null;
}): MemoryClip[] {
  const quotes = (opts.quotes || []).map((q) => clean(q)).filter(Boolean).slice(0, 20);
  const utts = Array.isArray(opts.utterances) ? opts.utterances : [];
  const out: MemoryClip[] = [];

  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const id = `quote-${i}-${slugClipLabel(q)}`;
    const nq = normText(q);
    if (!nq || nq.length < 8) {
      out.push({
        id,
        kind: "quote",
        label: q.slice(0, 80),
        startSec: 0,
        endSec: 0,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "Quote too short to match safely against the transcript.",
      });
      continue;
    }
    if (!utts.length) {
      out.push({
        id,
        kind: "quote",
        label: q.slice(0, 80),
        startSec: 0,
        endSec: 0,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit:
          "No timed transcript lines on this recording — quote text is in the package, but clip export needs Deepgram utterances or caption timestamps.",
      });
      continue;
    }

    let best: { start: number; end: number; score: number } | null = null;
    for (let u = 0; u < utts.length; u++) {
      const line = normText(String(utts[u]?.transcript || ""));
      if (!line) continue;
      const start = Math.max(0, Math.floor(Number(utts[u]?.start) || 0));
      const explicitEnd = Number(utts[u]?.end);
      const nextStart = Number(utts[u + 1]?.start);
      let end =
        Number.isFinite(explicitEnd) && explicitEnd > start
          ? Math.floor(explicitEnd)
          : Number.isFinite(nextStart) && nextStart > start
            ? Math.floor(nextStart)
            : start + Math.max(4, Math.ceil(line.split(" ").length * 0.45));

      let score = 0;
      if (line.includes(nq) || nq.includes(line)) score = Math.min(nq.length, line.length);
      else {
        // Token overlap for near-paraphrase package quotes.
        const qt = new Set(nq.split(" ").filter((t) => t.length > 3));
        const lt = line.split(" ").filter((t) => t.length > 3);
        let hit = 0;
        for (const t of lt) if (qt.has(t)) hit++;
        if (qt.size >= 3 && hit / qt.size >= 0.7) score = hit;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { start, end, score };
      }
    }

    if (!best) {
      out.push({
        id,
        kind: "quote",
        label: q.slice(0, 80),
        startSec: 0,
        endSec: 0,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "Could not find this quote in timed transcript lines — wording may have been cleaned in the package.",
      });
      continue;
    }

    const padded = clampRange(
      best.start - MEMORY_CLIP_PAD_BEFORE_S,
      best.end + MEMORY_CLIP_PAD_AFTER_S,
      opts.durationSec
    );
    if (!padded) {
      out.push({
        id,
        kind: "quote",
        label: q.slice(0, 80),
        startSec: best.start,
        endSec: best.end,
        audioPath: opts.audioPath || null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "Matched quote window is too short to cut.",
      });
      continue;
    }
    if (!opts.audioPath) {
      out.push({
        id,
        kind: "quote",
        label: q.slice(0, 80),
        ...padded,
        audioPath: null,
        sourcePath: opts.sourcePath,
        ready: false,
        limit: "No audio-only file beside this recording.",
      });
      continue;
    }
    out.push({
      id,
      kind: "quote",
      label: q.slice(0, 80),
      ...padded,
      audioPath: opts.audioPath,
      sourcePath: opts.sourcePath,
      ready: true,
    });
  }
  return out;
}

/** Full-episode clip (entire audio file) — always "ready" when audio exists. */
export function episodeAudioClip(ep: MemoryEpisode): MemoryClip {
  const label = ep.title || `Episode ${ep.order + 1}`;
  if (!ep.audioPath) {
    return {
      id: `episode-${slugClipLabel(ep.id)}`,
      kind: "episode",
      label,
      startSec: 0,
      endSec: ep.durationSec || 0,
      audioPath: null,
      sourcePath: ep.path,
      ready: false,
      limit: "No audio-only sidecar for this episode.",
    };
  }
  return {
    id: `episode-${slugClipLabel(ep.id)}`,
    kind: "episode",
    label,
    startSec: 0,
    endSec: ep.durationSec && ep.durationSec > 0 ? ep.durationSec : 0,
    audioPath: ep.audioPath,
    sourcePath: ep.path,
    ready: true,
  };
}

/**
 * Build the download plan for a project: per-episode full audio + optional
 * intra-recording chapter/quote cuts from the Memory package when timestamps exist.
 */
export function buildClipPlan(opts: {
  episodes: MemoryEpisode[];
  packageChapters?: Array<{ heading?: string; at?: string; body?: string }>;
  packageQuotes?: string[];
  /** utterances keyed by summary path */
  utterancesByPath?: Record<string, Array<{ start?: number; end?: number; transcript?: string }>>;
  /** When set, only this episode contributes chapter/quote cuts (still lists its full audio). */
  focusEpisodeId?: string;
}): { clips: MemoryClip[]; limits: string[] } {
  const limits: string[] = [];
  const clips: MemoryClip[] = [];
  const eps = opts.episodes || [];
  if (!eps.length) {
    limits.push("No Memory episodes yet — run a Memory-mode session with captions, End, then come back.");
    return { clips, limits };
  }

  for (const ep of eps) {
    clips.push(episodeAudioClip(ep));
  }

  const focus = clean(opts.focusEpisodeId);
  // Package chapter/quote cuts attach only when the host focused one episode,
  // or the show has a single recording (nothing to disambiguate).
  const attach = focus
    ? eps.find((e) => e.id === focus) || null
    : eps.length === 1
      ? eps[0]
      : null;

  if (attach && (opts.packageChapters?.length || opts.packageQuotes?.length)) {
    const utts = (opts.utterancesByPath && opts.utterancesByPath[attach.path]) || [];
    if (opts.packageChapters?.length) {
      const ch = chapterBoundaryClips({
        chapters: opts.packageChapters,
        audioPath: attach.audioPath,
        sourcePath: attach.path,
        durationSec: attach.durationSec,
        episodeLabel: attach.title,
      });
      clips.push(...ch);
      if (ch.some((c) => !c.ready)) {
        limits.push(
          "Some chapter clips lack parseable mm:ss cues or audio — those stay in the markdown package only."
        );
      }
    }
    if (opts.packageQuotes?.length) {
      const q = quoteClips({
        quotes: opts.packageQuotes,
        utterances: utts,
        audioPath: attach.audioPath,
        sourcePath: attach.path,
        durationSec: attach.durationSec,
      });
      clips.push(...q);
      if (q.some((c) => !c.ready)) {
        limits.push(
          "Some quote clips could not be timed against the transcript — download the full episode audio and scrub, or rebuild after captions/transcription."
        );
      }
    }
  } else if ((opts.packageChapters?.length || opts.packageQuotes?.length) && eps.length > 1 && !focus) {
    limits.push(
      "Multiple episodes in this show — pick one chapter (Per-chapter audio) to attach package chapter/quote cuts, or download full episode audio only."
    );
  }

  return { clips, limits };
}

/** Encode mono/stereo Float32 PCM as a WAV ArrayBuffer (16-bit). Testable offline. */
export function encodeWavPCM(
  channelData: Float32Array[],
  sampleRate: number
): ArrayBuffer {
  const channels = Math.max(1, channelData.length);
  const length = channelData[0]?.length || 0;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, dataSize, true);

  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, channelData[c][i] || 0));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

/** Slice PCM channel arrays by time range (seconds). */
export function slicePcm(
  channelData: Float32Array[],
  sampleRate: number,
  startSec: number,
  endSec: number
): Float32Array[] {
  const a = Math.max(0, Math.floor(startSec * sampleRate));
  const b = Math.max(a + 1, Math.floor(endSec * sampleRate));
  return channelData.map((ch) => ch.subarray(a, Math.min(b, ch.length)));
}

export const MEMORY_CLIP_FORMAT_NOTE =
  "Chapter/quote cuts download as WAV (browser decode of stored m4a or audio.webm). Full episode audio downloads in its original container (m4a or audio.webm). The full episode video is one continuous MP4 or WebM take (HD 720p on current recorders) — Full video. Captions download as .vtt / .srt. No MOV re-encode.";

/** Candidate storage paths for an episode's continuous video, best first.
 *  Older summaries lacked videoPath; the recorder writes `${stem}.mp4` or
 *  `${stem}.webm`, never anything else. */
export function episodeVideoCandidates(ep: { path: string; videoPath?: string | null }): string[] {
  const stem = clean(ep.path).replace(/\.summary\.json$/i, "");
  const out: string[] = [];
  const push = (s: string) => { if (s && !out.includes(s)) out.push(s); };
  if (ep.videoPath && /\.(mp4|webm)$/i.test(ep.videoPath) && !/\.audio\.webm$/i.test(ep.videoPath)) push(clean(ep.videoPath));
  if (stem) { push(`${stem}.mp4`); push(`${stem}.webm`); }
  return out;
}
