// Name + glossary boosting for live captions.
//
// Wispr-Flow-style context: the recogniser gets told, up front, the words it
// is most likely to get wrong — the people in the room and the project's own
// jargon. Deepgram takes these as query params, and the param depends on the
// model: nova-3 takes `keyterm` (phrases allowed), nova-2 takes `keywords`
// (single words, optional `:boost`). Sending the wrong one is silently ignored
// or rejected, so the choice is made here, in one tested place.

export const MAX_GLOSSARY_TERMS = 50;
export const MAX_TERM_CHARS = 40;
export const MAX_NAMES = 20;
export const MAX_GLOSSARY_INPUT = 4000;

/** One term, cleaned: letters/digits (any script), space, and . - ' & + only. */
export function cleanTerm(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .\-'&+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_CHARS)
    .trim();
}

/** Host-entered text (comma/newline/semicolon separated, or an array) → terms.
 *  Deduped case-insensitively, capped. */
export function sanitizeGlossary(input: unknown, cap = MAX_GLOSSARY_TERMS): string[] {
  const parts = Array.isArray(input)
    ? input.map(String)
    : String(input ?? "").slice(0, MAX_GLOSSARY_INPUT).split(/[,;\n\r]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = cleanTerm(p);
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** Display names → terms. Drops generic placeholders that only add noise. */
export function sanitizeNames(names: unknown[]): string[] {
  const generic = /^(guest|host|me|you|participant|user|anonymous)(\s*\d+)?$/i;
  return sanitizeGlossary(
    (names || []).map((n) => cleanTerm(n)).filter((n) => n && !generic.test(n)),
    MAX_NAMES
  );
}

export type DgModel = string;

/** Query params for Deepgram /v1/listen. nova-3 → keyterm (phrases);
 *  anything older (nova-2, enhanced, base) → keywords (single words, boosted). */
export function keytermParams(model: DgModel, names: string[], glossary: string[]): Array<[string, string]> {
  const terms = sanitizeGlossary([...(names || []), ...(glossary || [])], MAX_NAMES + MAX_GLOSSARY_TERMS);
  if (/^nova-3/i.test(String(model || ""))) {
    return terms.map((t) => ["keyterm", t] as [string, string]);
  }
  const words = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const t of terms) {
    for (const w of t.split(" ")) {
      const k = w.toLowerCase();
      if (w.length < 2 || words.has(k)) continue;
      words.add(k);
      out.push(["keywords", `${w}:2`]);
      if (out.length >= 100) return out;
    }
  }
  return out;
}

/** Storage path for a meeting's glossary — inside the host's existing prd/
 *  folder, so no migration and nothing new for the listing code to trip on. */
export function glossaryPath(hostId: string, room: string): string {
  const slug = String(room || "room").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
  return `${String(hostId || "")}/prd/${slug}.glossary.json`;
}
