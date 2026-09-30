// Shareable project PRD link — the URL a person can open without signing in.
//
// FIELD / pre-OSS: Copy markdown, Download .md, and Email-the-spec already
// hand the document off. What was missing is a link you can paste into Slack
// or an email that opens the PRD in a browser — same artifact, no account.
//
// The link is opaque. Ownership stays under the host's storage prefix; a
// small map file under shares/ is the only public index. Revoking deletes
// that map so the URL dies without touching the assessment itself.
//
// ZERO-IMPORT so the guards stay offline and browser-free.

/** Storage path for the reverse lookup a public viewer needs. */
export function shareMapPath(shareId: string): string {
  const id = String(shareId || "").trim().toLowerCase();
  return `shares/${id}.json`;
}

/** Absolute URL a host can copy. Empty origin is refused so we never mint
 *  a relative "share" that only works on one machine. */
export function shareUrl(origin: string, shareId: string): string {
  const base = String(origin || "").replace(/\/$/, "");
  const id = String(shareId || "").trim().toLowerCase();
  if (!base || !id) return "";
  return `${base}/prd/${id}`;
}

/** Accept only the ids we mint: 24 hex chars. Anything else is not a share. */
export function isShareId(raw: string): boolean {
  return /^[a-f0-9]{24}$/.test(String(raw || "").trim().toLowerCase());
}

export type ShareMap = {
  shareId: string;
  userId: string;
  project: string;
  at: string;
};

export function acceptShareMap(raw: any): ShareMap | null {
  const shareId = String(raw?.shareId || "").trim().toLowerCase();
  const userId = String(raw?.userId || "").trim();
  const project = String(raw?.project || "").trim();
  const at = String(raw?.at || "").trim();
  if (!isShareId(shareId) || !userId || !project) return null;
  return { shareId, userId, project, at: at || new Date(0).toISOString() };
}

/** What a stranger with the link is allowed to see. Never user ids, never
 *  storage paths, never the model note that names internal routing. */
export type PublicPrd = {
  project: string;
  artifact: string;
  gate: string;
  mode: string;
  score: number;
  present_count: number;
  total: number;
  ready: boolean;
  summary: string;
  markdown: string;
  filename: string;
  at: string;
  meetings_used: number;
};

export function publicPrdFromStored(stored: any, projectFallback = ""): PublicPrd | null {
  if (!stored || typeof stored !== "object") return null;
  const markdown = String(stored.markdown || "").trim();
  if (!markdown) return null;
  const project = String(stored.project || projectFallback || "").trim() || "project";
  const artifact = String(stored.artifact || "PRD").trim() || "PRD";
  const score = Number(stored.score);
  return {
    project,
    artifact,
    gate: String(stored.gate || "Build-ready").trim() || "Build-ready",
    mode: String(stored.mode || "build").trim() || "build",
    score: Number.isFinite(score) ? score : 0,
    present_count: Math.max(0, Number(stored.present_count) || 0),
    total: Math.max(0, Number(stored.total) || 0),
    ready: Boolean(stored.ready),
    summary: String(stored.summary || "").trim(),
    markdown,
    filename: String(stored.filename || `${project.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-prd.md`).trim(),
    at: String(stored.at || "").trim(),
    meetings_used: Math.max(0, Number(stored.meetings_used) || 0),
  };
}

/** Handoff chip copy after a session ends — what the host needs to see
 *  before they wander off the host page. */
export function postMeetingHandoffCopy(opts: {
  hasPrd: boolean;
  shareUrl?: string;
  artifact?: string;
}): string {
  const art = String(opts.artifact || "PRD").trim() || "PRD";
  if (!opts.hasPrd) {
    return `Session ended. When this project's ${art} is ready, copy, download, or share the link from the PRD panel below.`;
  }
  if (opts.shareUrl) {
    return `Session ended. Your ${art} is ready — copy the shareable link, download the .md, or email the spec from the last room.`;
  }
  return `Session ended. Your ${art} is ready — copy it, download the .md, or turn on a shareable link below.`;
}
