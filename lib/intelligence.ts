// The meeting, read back to you — the numbers behind the intelligence panel.
//
// DESIGN 2026-08-18. The console's centrepiece is a post-meeting readout:
// a talk-density strip with markers where decisions landed, a talk-balance
// figure, and the open items grouped by project. Every number here is
// DERIVED from data the finish route already saves (timed utterances,
// decisions, actions) — nothing is estimated by a model, because a chart a
// person can't reconcile with the recording teaches them to ignore charts.
//
// Everything is pure. The panel renders what these return; the guards prove
// what these return.

export type Utt = { start: number; speaker?: number; transcript: string };

export type Marker = { at: number; label: string; kind: "decision" | "action" };

const words = (t: string) => String(t || "").split(/\s+/).filter(Boolean);

/** Talk-density bars for the timeline strip. `n` buckets over the meeting's
 *  span, each 0..1 against the busiest bucket — so the shape survives any
 *  meeting length. An empty meeting is an empty array, never a flat lie. */
export function bars(utts: Utt[], n = 28, endSec?: number): number[] {
  const u = (utts || []).filter((x) => x && Number.isFinite(Number(x.start)));
  if (!u.length || n < 2) return [];
  const last = Math.max(endSec || 0, ...u.map((x) => Number(x.start))) + 4;
  const bins = new Array<number>(n).fill(0);
  for (const x of u) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((Number(x.start) / last) * n)));
    bins[i] += words(x.transcript).length;
  }
  const top = Math.max(...bins);
  if (top <= 0) return [];
  // A floor of .06 keeps quiet minutes visible as *quiet*, not missing —
  // a gap in the strip reads as "the recording cut out".
  return bins.map((b) => (b === 0 ? 0.06 : Math.max(0.08, b / top)));
}

/** Who talked, as shares of words spoken. Keyed by speaker label. */
export function shares(utts: Utt[]): Record<string, number> {
  const count: Record<string, number> = {};
  let total = 0;
  for (const x of utts || []) {
    const w = words(x.transcript).length;
    if (!w) continue;
    const who = typeof x.speaker === "number" && x.speaker >= 0 ? `Speaker ${x.speaker + 1}` : "Speaker";
    count[who] = (count[who] || 0) + w;
    total += w;
  }
  if (!total) return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(count)) out[k] = count[k] / total;
  return out;
}

/** How evenly the room talked, 0..1. 1 = perfectly shared, 0 = one voice.
 *  Defined so a person can check it: (1 − loudest share) ÷ (1 − 1/speakers).
 *  One speaker is 0 by definition — a monologue is not balanced, however
 *  fluent. */
export function balance(utts: Utt[]): number | null {
  const s = shares(utts);
  const k = Object.keys(s).length;
  if (!k) return null;
  if (k === 1) return 0;
  const top = Math.max(...Object.values(s));
  const b = (1 - top) / (1 - 1 / k);
  return Math.round(Math.min(1, Math.max(0, b)) * 100) / 100;
}

const STOP = new Set([
  "the","a","an","and","or","to","of","in","on","for","we","i","it","is","are",
  "that","this","be","will","was","were","with","at","by","so","but","if","then",
]);
const sig = (t: string) =>
  words(t.toLowerCase().replace(/[^a-z0-9\s']/g, " ")).filter((w) => w.length > 2 && !STOP.has(w));

/** Where in the recording a decision/action line happened, by token overlap
 *  with the timed utterances. Null when nothing matches convincingly —
 *  a marker in the wrong minute is worse than no marker, because the first
 *  time somebody clicks it and hears something unrelated, every other marker
 *  becomes a decoration. */
export function locate(text: string, utts: Utt[]): number | null {
  const t = sig(String(text || "").replace(/^[^—]*—\s*/, ""));   // drop the "Who —" prefix
  if (t.length < 2) return null;
  let bestAt: number | null = null, bestHit = 0;
  for (const u of utts || []) {
    const uw = new Set(sig(u.transcript));
    if (!uw.size) continue;
    let hit = 0;
    for (const w of t) if (uw.has(w)) hit++;
    if (hit > bestHit) { bestHit = hit; bestAt = Math.round(Number(u.start) || 0); }
  }
  return bestHit >= Math.max(2, Math.ceil(t.length * 0.34)) ? bestAt : null;
}

/** A short shouting-caps label for the strip: the first few words that carry
 *  meaning, not the first few words. */
export function markerLabel(text: string): string {
  const s = sig(text);
  return (s.slice(0, 2).join(" ") || words(text).slice(0, 2).join(" ")).toUpperCase();
}

/** Markers for the timeline: decisions first (they're why anyone scrubs),
 *  then actions, capped so the strip stays readable, only where a real
 *  timestamp was found, deduped per bucket-ish (>= 20s apart). */
export function markers(decisions: string[], actions: string[], utts: Utt[], cap = 4): Marker[] {
  const out: Marker[] = [];
  const take = (list: string[], kind: Marker["kind"]) => {
    for (const text of list || []) {
      if (out.length >= cap) return;
      const at = locate(text, utts);
      if (at === null) continue;
      if (out.some((m) => Math.abs(m.at - at) < 20)) continue;
      out.push({ at, label: markerLabel(text), kind });
    }
  };
  take(decisions, "decision");
  take(actions, "action");
  return out.sort((a, b) => a.at - b.at);
}

// ── the rails ────────────────────────────────────────────────────────────

export type OpenItem = { project?: string | null; [k: string]: any };

/** Open items grouped for the STILL OPEN rail: biggest project first, the
 *  project-less pile last under GENERAL — it is a catch-all, not a project. */
export function stillOpen<T extends OpenItem>(items: T[]): Array<{ project: string; items: T[] }> {
  const by: Record<string, T[]> = {};
  for (const it of items || []) {
    const p = String(it.project || "").trim().toUpperCase() || "GENERAL";
    (by[p] = by[p] || []).push(it);
  }
  return Object.keys(by)
    .sort((a, b) => {
      if (a === "GENERAL") return 1;
      if (b === "GENERAL") return -1;
      return by[b].length - by[a].length || a.localeCompare(b);
    })
    .map((project) => ({ project, items: by[project] }));
}

export type Sched = { scheduled_at?: string | null; active?: boolean | null; [k: string]: any };

/** The one meeting the NEXT UP card shows: the soonest scheduled one that
 *  hasn't been ended and isn't already long past. A meeting that started ten
 *  minutes ago is still NEXT — people join late — but an hour gone is over. */
export function nextUp<T extends Sched>(meetings: T[], now = Date.now()): T | null {
  const grace = 60 * 60 * 1000;
  const soon = (meetings || [])
    .filter((m) => m.scheduled_at && m.active !== false)
    .map((m) => ({ m, t: new Date(m.scheduled_at as string).getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t > now - grace)
    .sort((a, b) => a.t - b.t);
  return soon.length ? soon[0].m : null;
}

/** "In 14 minutes" / "started 5 minutes ago" for the NEXT UP eyebrow. */
export function inWords(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60000));
  const unit =
    mins < 60 ? `${mins} minute${mins === 1 ? "" : "s"}` :
    mins < 60 * 36 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"}` :
    `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;
  return ms >= 0 ? `in ${unit}` : `started ${unit} ago`;
}

/** When a recording will be deleted, from the retention the deployment set.
 *  Null when no retention is configured — a made-up date on a screen is a
 *  promise the cron never made. */
export function deletesOn(createdAtISO: string, retentionDays: number): string | null {
  const d = Number(retentionDays);
  if (!Number.isFinite(d) || d <= 0) return null;
  const t = new Date(createdAtISO).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + d * 86400000).toISOString();
}

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

export function deletesLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Hand-formatted day-first, because toLocaleDateString flips to month-first
  // on US-locale machines and the same recording would show two different
  // labels to two people looking at the same screen-share.
  return `DELETES ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Bytes for humans. The history header says "9.2 GB", not 9875312640. */
export function gb(bytes: number): string {
  const b = Number(bytes) || 0;
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + " GB";
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}

export function hms(totalSec: number): string {
  const t = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
