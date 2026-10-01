// Shareable Memory package link — /memory/{id}, mirroring lib/prd-share.ts.
//
// ZERO-IMPORT so guards stay offline and browser-free.

/** Storage path for the reverse lookup a public viewer needs. */
export function memoryShareMapPath(shareId: string): string {
  const id = String(shareId || "").trim().toLowerCase();
  return `shares/memory/${id}.json`;
}

/** Absolute URL a host can copy. */
export function memoryShareUrl(origin: string, shareId: string): string {
  const base = String(origin || "").replace(/\/$/, "");
  const id = String(shareId || "").trim().toLowerCase();
  if (!base || !id) return "";
  return `${base}/memory/${id}`;
}

/** Accept only the ids we mint: 24 hex chars. */
export function isMemoryShareId(raw: string): boolean {
  return /^[a-f0-9]{24}$/.test(String(raw || "").trim().toLowerCase());
}

export type MemoryShareMap = {
  shareId: string;
  userId: string;
  project: string;
  at: string;
  kind: "memory";
};

export function acceptMemoryShareMap(raw: any): MemoryShareMap | null {
  const shareId = String(raw?.shareId || "").trim().toLowerCase();
  const userId = String(raw?.userId || "").trim();
  const project = String(raw?.project || "").trim();
  const at = String(raw?.at || "").trim();
  if (!isMemoryShareId(shareId) || !userId || !project) return null;
  return { shareId, userId, project, at: at || new Date(0).toISOString(), kind: "memory" };
}

/** What a stranger with the link is allowed to see. */
export type PublicMemory = {
  project: string;
  artifact: string;
  gate: string;
  title: string;
  summary: string;
  markdown: string;
  filename: string;
  at: string;
  meetings_used: number;
  intent: string;
  sessionMode: "memory";
  present_count: number;
  total: number;
  score: number;
  ready: boolean;
};

export function publicMemoryFromStored(stored: any, projectFallback = ""): PublicMemory | null {
  if (!stored || typeof stored !== "object") return null;
  const markdown = String(stored.markdown || "").trim();
  if (!markdown) return null;
  const project = String(stored.project || projectFallback || "").trim() || "project";
  const score = Number(stored.score);
  return {
    project,
    artifact: String(stored.artifact || "Memory package").trim() || "Memory package",
    gate: String(stored.gate || "Story-ready").trim() || "Story-ready",
    title: String(stored.title || project).trim() || project,
    summary: String(stored.summary || "").trim(),
    markdown,
    filename: String(stored.filename || `${project.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-memory.md`).trim(),
    at: String(stored.at || "").trim(),
    meetings_used: Math.max(0, Number(stored.meetings_used) || 0),
    intent: String(stored.intent || "story").trim() || "story",
    sessionMode: "memory",
    present_count: Math.max(0, Number(stored.present_count) || 0),
    total: Math.max(0, Number(stored.total) || 0),
    score: Number.isFinite(score) ? score : 0,
    ready: Boolean(stored.ready),
  };
}
