// Search across every meeting you have ever had.
//
// FIELD 2026-08-18: "Ask" answered questions about ONE recording. But the
// question a person actually has does not arrive while they are looking at the
// meeting it belongs to. It arrives three weeks later, in a different context,
// and it sounds like "what did we decide about the billing provider?" or "who
// said the margin number was wrong?" — and the honest answer today is "open
// each of your meetings and try Ask on all of them".
//
// THE ARCHITECTURAL DECISION, because everything follows from it:
// retrieve deterministically, THEN read.
//
// The naive build — concatenate every transcript and hand the pile to a model —
// demos beautifully with three meetings and dies in month two. It breaks the
// context window, the cost grows with your archive, and it gets SLOWER the
// longer you use the product, which is precisely backwards. Search should get
// more valuable the more you have, not more expensive.
//
// So the ranking is real code: BM25 over the passages, run here, offline, in
// milliseconds, for free. The model only ever sees the handful of passages
// that already won, and its job is narrow — turn evidence into a sentence.
//
// The consequence that matters most: search WORKS WITH NO MODEL KEY. Ranked,
// quoted, timestamped results are useful on their own. Throwing them away
// because one environment variable is missing would be the app choosing to
// know less than it does.

// ── the query language ─────────────────────────────────────────────────────
//
// Three things people expect from a search box and almost never get:
//   "exact phrase"   — quoted means quoted, as a FILTER not a hint
//   -word            — and not this
//   who:kiran        — only what this person said
//
// The third one is the one this app can answer and Zoom cannot, because every
// caption line already knows whose microphone it came from. "What did Kiran
// commit to" is a query, not a research project.

export type Kind = "said" | "decision" | "action" | "topic" | "title";

export type Passage = {
  mid: string;   // which meeting — identity travels with every passage
  kind: Kind;
  at: number;    // seconds into the meeting; -1 when it is not a spoken line
  who: string;
  text: string;
};

export type MeetingDoc = {
  id: string;    // the summary path — unique, and already ownership-checked
  room: string;
  title: string;
  when: string;  // ISO
  videoPath?: string;
  audioPath?: string;
  people: string[];
  passages: Passage[];
};

export type Query = {
  terms: string[];    // stemmed, stopwords removed — what gets ranked
  raw: string[];      // as typed — what gets highlighted
  phrases: string[];  // lowercased exact phrases, ANDed as a filter
  exclude: string[];  // stemmed
  who: string;        // lowercased speaker filter; "" means anyone
};

// Stopwords only affect RANKING, never what the model reads. Dropping "not"
// from a ranking is harmless; dropping it from a transcript would invert a
// decision, which is why the raw text is always what gets quoted.
const STOP = new Set(
  ("a an the and or but if then so as at by for from in into of on to with " +
   "is are was were be been being am do does did doing have has had having " +
   "i me my we us our you your he him his she her it its they them their " +
   "this that these those there here what which when where who whom how why " +
   "can could will would shall should may might must " +
   "about after again all also any because before both each few more most " +
   "other some such only own same than too very just now no nor not " +
   "ok okay yeah yes right like get got go going said say says think know " +
   "really thing things want need make made take see look going gonna")
    .split(" ")
);

const VOWEL = /[aeiouy]/;

/** A deliberately conservative stemmer.
 *
 *  It unifies the endings that cost the most recall — plurals, -ing, -ed, -ly —
 *  and stops there. Aggressive stemming makes search feel haunted: you ask for
 *  "organisation" and get "organ". The rule that prevents that is the minimum
 *  stem length, and it is tested.
 *
 *  It does NOT unify "decide" with "decision", nor "ran" with "run". Those are
 *  real limits, and they are better than having "billion" collide with "bill". */
export function stemWord(w: string): string {
  let s = w;
  const keep = (t: string) => (t.length >= 3 && VOWEL.test(t) ? t : s);
  if (s.length > 4 && s.endsWith("ies")) return keep(s.slice(0, -3) + "i");
  if (s.length > 4 && s.endsWith("sses")) return keep(s.slice(0, -2));
  if (s.length > 3 && s.endsWith("s") && !/(ss|us|is)$/.test(s)) s = keep(s.slice(0, -1));
  if (s.length > 4 && s.endsWith("ing")) s = keep(s.slice(0, -3));
  else if (s.length > 4 && s.endsWith("ed")) s = keep(s.slice(0, -2));
  else if (s.length > 4 && s.endsWith("ly")) s = keep(s.slice(0, -2));
  if (s.length > 3 && s.endsWith("y")) s = keep(s.slice(0, -1) + "i");
  // The silent -e, last. Without it "decide" and "decided" are two different
  // words, and so are "price"/"pricing" and "service"/"services" — which is
  // most of what a meeting is about.
  if (s.length > 3 && s.endsWith("e")) s = keep(s.slice(0, -1));
  return s;
}

/** Words worth ranking on. Keeps digits — "57%" and "Q3" are exactly the kind
 *  of thing somebody searches for and exactly what a naive tokeniser drops. */
export function tokenize(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'%$]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stemWord);
}

export function parseQuery(q: string): Query {
  const src = String(q || "");
  const phrases: string[] = [];
  // Quoted first, so the words inside a phrase are not also loose terms —
  // otherwise "single sign on" would rank every document mentioning "on".
  const rest = src.replace(/"([^"]+)"/g, (_m, p) => {
    const t = String(p).trim().toLowerCase().replace(/\s+/g, " ");
    if (t) phrases.push(t);
    return " ";
  });

  const exclude: string[] = [];
  let who = "";
  const raw: string[] = [];

  for (const tok of rest.split(/\s+/)) {
    if (!tok) continue;
    const m = /^who:(.+)$/i.exec(tok);
    if (m) { who = m[1].toLowerCase().replace(/[^a-z0-9 ]/g, ""); continue; }
    if (tok.startsWith("-") && tok.length > 1) {
      exclude.push(...tokenize(tok.slice(1)));
      continue;
    }
    raw.push(tok.replace(/[^\w'%$-]/g, ""));
  }

  return {
    terms: Array.from(new Set(tokenize(raw.join(" ")))),
    raw: raw.filter(Boolean),
    phrases,
    exclude: Array.from(new Set(exclude)),
    who,
  };
}

/** True when the query asks for nothing rankable. A search box that runs on
 *  an empty string and returns "no results" reads as "you have no meetings". */
export function isEmptyQuery(q: Query): boolean {
  return q.terms.length === 0 && q.phrases.length === 0 && !q.who;
}

// ── turning a saved meeting into searchable passages ───────────────────────
//
// A passage is the unit that gets ranked AND the unit that gets shown, which
// is not a coincidence: a result you cannot see the evidence for is a result
// you have to go and verify by hand, and then the search saved you nothing.

/** Evidence is not all equal. A term appearing in a recorded DECISION is
 *  stronger evidence than the same term said in passing, and the title is
 *  stronger still. These weights are the difference between "the meeting where
 *  we decided it" ranking first and ranking eleventh. */
const WEIGHT: Record<Kind, number> = {
  title: 3.0,
  decision: 2.2,
  action: 2.0,
  topic: 1.4,
  said: 1.0,
};

/** Storage paths are stamped `2026-08-18T01-30-00-000Z` — an ISO time with the
 *  colons beaten out of it, because colons are not welcome in object keys.
 *
 *  FIELD 2026-08-18: this went unconverted at first, so `Date.parse` returned
 *  NaN for every meeting, every recency comparison silently became 0 vs 0, and
 *  the tiebreaker did nothing at all. A ranking signal that quietly evaluates
 *  to a constant is worse than not having it: the tests still pass on
 *  hand-written ISO fixtures and the live product ignores it. */
export function parseWhen(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    const raw = String(c || "").trim();
    if (!raw) continue;
    if (!isNaN(Date.parse(raw))) return new Date(raw).toISOString();
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:[-.](\d{1,3}))?Z?$/.exec(raw);
    if (m) {
      const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${(m[5] || "0").padStart(3, "0")}Z`;
      if (!isNaN(Date.parse(iso))) return iso;
    }
  }
  // Nothing parsed. Hand back what we were given rather than losing the label.
  return String(candidates.find((c) => String(c || "").trim()) || "");
}

export function toDoc(
  payload: any,
  meta: { id: string; room: string; when: string; videoPath?: string; audioPath?: string }
): MeetingDoc {
  const p = payload || {};
  const notes = p.notes || {};
  const people: string[] = (Array.isArray(p.people) ? p.people : []).map((x: any) => String(x || "").trim()).filter(Boolean);
  const title = String(p.title || notes.title || "").trim();
  const passages: Passage[] = [];
  const push = (kind: Kind, text: string, at = -1, who = "") => {
    const t = String(text || "").trim();
    if (t.length > 1) passages.push({ mid: meta.id, kind, at, who, text: t });
  };

  if (title) push("title", title);
  push("topic", String(p.summaryText || notes.overview || ""));
  for (const t of (Array.isArray(p.topics) ? p.topics : notes.topics) || []) {
    push("topic", String(t?.title || ""));
    for (const pt of Array.isArray(t?.points) ? t.points : []) push("topic", String(pt));
  }
  for (const d of (Array.isArray(p.decisions) ? p.decisions : notes.decisions) || []) push("decision", String(d));
  for (const a of (Array.isArray(p.actions) ? p.actions : notes.actions) || []) push("action", String(a));
  for (const f of (Array.isArray(p.followups) ? p.followups : notes.followups) || []) push("action", String(f));

  // The spoken record. Utterances carry a second, which is what makes a result
  // openable rather than merely believable.
  const utts: any[] = Array.isArray(p.utterances) ? p.utterances : [];
  for (const u of utts) {
    const who =
      String(u?.who || "").trim() ||
      (typeof u?.speaker === "number" ? people[u.speaker] || `Speaker ${u.speaker + 1}` : "");
    push("said", String(u?.transcript || u?.text || ""), Math.max(0, Math.round(Number(u?.start) || 0)), who);
  }
  // A meeting transcribed before timed lines existed still has to be findable.
  if (!utts.length) {
    const flat = String(p.transcript || notes.transcript || "");
    for (const line of flat.split(/\n+/)) {
      const m = /^\[(\d+)s\]\s*([^:]{0,60}?):\s*(.+)$/.exec(line.trim());
      if (m) push("said", m[3], Number(m[1]), m[2].trim());
      else push("said", line);
    }
  }

  return {
    id: meta.id,
    room: meta.room,
    title,
    when: parseWhen(meta.when, p.createdAt),
    videoPath: meta.videoPath || p.videoPath || undefined,
    audioPath: meta.audioPath || p.audioPath || undefined,
    people,
    passages,
  };
}

// ── ranking ────────────────────────────────────────────────────────────────

export type Moment = {
  at: number;
  who: string;
  kind: Kind;
  text: string;
  score: number;
  terms: string[];  // which of the query's words actually matched, in the text's own words
};

export type MeetingHit = {
  id: string;
  room: string;
  title: string;
  when: string;
  videoPath?: string;
  audioPath?: string;
  score: number;
  hitCount: number;   // how many passages matched IN TOTAL, not how many we show
  moments: Moment[];
};

export type SearchResult = {
  hits: MeetingHit[];
  scanned: { meetings: number; passages: number };
  matched: { meetings: number; passages: number };
  /** Set when the corpus itself was cut short. NEVER silently: a search that
   *  read 20 of your 200 meetings and reported "no results" is not a search,
   *  it is the app confidently telling you something untrue. */
  truncated: string;
  suggestion: string;
};

const K1 = 1.4;
const B = 0.72;

/** BM25, with the smoothed IDF that stays positive on a small corpus.
 *  The textbook IDF goes NEGATIVE for a term appearing in more than half the
 *  documents — which, when you own four meetings and they all say "billing",
 *  ranks the ones that say it most LAST. */
function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function rank(
  q: Query,
  docs: MeetingDoc[],
  opts: { perMeeting?: number; meetings?: number } = {}
): SearchResult {
  const perMeeting = opts.perMeeting ?? 4;
  const maxMeetings = opts.meetings ?? 25;

  const all: Passage[] = [];
  for (const d of docs) all.push(...d.passages);
  const scanned = { meetings: docs.length, passages: all.length };
  const empty: SearchResult = {
    hits: [], scanned, matched: { meetings: 0, passages: 0 }, truncated: "", suggestion: "",
  };
  if (isEmptyQuery(q) || !all.length) return empty;

  // Document frequency over passages, plus the vocabulary "did you mean" reads.
  const df = new Map<string, number>();
  const toks: string[][] = new Array(all.length);
  let totalLen = 0;
  for (let i = 0; i < all.length; i++) {
    const t = tokenize(all[i].text);
    toks[i] = t;
    totalLen += t.length;
    for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  }
  const avgdl = totalLen / Math.max(1, all.length) || 1;
  const N = all.length;

  const byMeeting = new Map<string, { doc: MeetingDoc; moments: Moment[] }>();
  for (const d of docs) byMeeting.set(d.id, { doc: d, moments: [] });

  let matchedPassages = 0;
  for (let i = 0; i < N; i++) {
    const p = all[i];
    const t = toks[i];
    const lower = norm(p.text);

    // Filters first — they are answers to "must", and a must that only nudges
    // the score is a filter the user will not believe a second time.
    if (q.who && !norm(p.who).includes(q.who)) continue;
    if (q.phrases.length && !q.phrases.every((ph) => lower.includes(ph))) continue;
    if (q.exclude.length && q.exclude.some((x) => t.includes(x))) continue;

    let s = 0;
    const matched: string[] = [];
    const counts = new Map<string, number>();
    for (const w of t) counts.set(w, (counts.get(w) || 0) + 1);

    for (const term of q.terms) {
      const f = counts.get(term) || 0;
      if (!f) continue;
      matched.push(term);
      s += idf(N, df.get(term) || 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * t.length) / avgdl)));
    }

    // A quoted phrase that survived the filter IS the match, even when the
    // loose terms score nothing — "single sign on" is all stopwords.
    if (q.phrases.length) s += 2.5 * q.phrases.length;
    if (q.who && !q.terms.length && !q.phrases.length) s += 1; // "everything Kiran said"

    if (s <= 0) continue;
    s *= WEIGHT[p.kind];
    matchedPassages++;
    byMeeting.get(p.mid)?.moments.push({
      at: p.at, who: p.who, kind: p.kind, text: p.text, score: s,
      terms: Array.from(new Set(matched)),
    });
  }

  const hits: MeetingHit[] = [];
  for (const { doc, moments } of byMeeting.values()) {
    if (!moments.length) continue;
    moments.sort((a, b) => b.score - a.score || a.at - b.at);
    // One dense passage should not beat a meeting that returns to the subject
    // all afternoon — but the extra passages have diminishing returns, or a
    // long meeting wins every search by being long.
    const best = moments[0].score;
    const rest = moments.slice(1, 6).reduce((n, m) => n + m.score, 0);
    hits.push({
      id: doc.id, room: doc.room, title: doc.title, when: doc.when,
      videoPath: doc.videoPath, audioPath: doc.audioPath,
      score: best + 0.3 * rest,
      hitCount: moments.length,
      moments: moments.slice(0, perMeeting).sort((a, b) => a.at - b.at),
    });
  }

  // Recency is a TIEBREAKER, not a ranker. A strong answer from last year has
  // to beat a passing mention from yesterday, or search becomes a recency feed
  // with extra steps. Five percent can settle a tie and cannot flip a result.
  const times = hits.map((h) => Date.parse(h.when) || 0);
  const newest = Math.max(...times, 0);
  const oldest = Math.min(...times.filter(Boolean), newest);
  const span = Math.max(1, newest - oldest);
  for (const h of hits) {
    const age = (Date.parse(h.when) || oldest) - oldest;
    h.score = h.score * (1 + 0.05 * (age / span));
  }
  hits.sort((a, b) => b.score - a.score || (a.when < b.when ? 1 : -1));

  const shown = hits.slice(0, maxMeetings);
  const unmatched = q.terms.filter((term) => !df.has(term));
  return {
    hits: shown,
    scanned,
    matched: { meetings: hits.length, passages: matchedPassages },
    truncated: hits.length > shown.length
      ? `Showing the ${shown.length} best of ${hits.length} meetings that matched.`
      : "",
    suggestion: unmatched.length ? suggest(unmatched, df) : "",
  };
}

// ── when nothing matched ───────────────────────────────────────────────────
//
// "No results" is where most search gives up, and it is the moment the person
// most needs help: they cannot tell whether the thing was never said, or they
// spelled it differently from the transcript. So the miss reports the nearest
// word that IS in their meetings.

function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function suggest(missing: string[], vocab: Map<string, number>): string {
  for (const m of missing) {
    if (m.length < 4) continue;
    let bestWord = "";
    let bestD = 3;
    let bestF = 0;
    for (const [w, f] of vocab) {
      if (Math.abs(w.length - m.length) > 2) continue;
      const d = editDistance(m, w, 2);
      if (d < bestD || (d === bestD && f > bestF)) { bestD = d; bestWord = w; bestF = f; }
    }
    if (bestWord && bestD <= 2) return bestWord;
  }
  return "";
}

/** Split text into hit / not-hit runs so the UI can mark what matched without
 *  building HTML in a string and hoping nobody typed a less-than sign. */
export function highlight(text: string, terms: string[]): Array<{ t: string; hit: boolean }> {
  const src = String(text || "");
  if (!terms.length || !src) return src ? [{ t: src, hit: false }] : [];
  const want = new Set(terms.map(stemWord));
  const out: Array<{ t: string; hit: boolean }> = [];
  const re = /[A-Za-z0-9'%$]+|[^A-Za-z0-9'%$]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const piece = m[0];
    const hit = /[A-Za-z0-9]/.test(piece) && want.has(stemWord(piece.toLowerCase()));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.t += piece;
    else out.push({ t: piece, hit });
  }
  return out;
}

export function summarise(r: SearchResult): string {
  if (!r.scanned.meetings) return "You have no recorded meetings yet.";
  if (!r.hits.length) {
    const base = `Nothing in ${r.scanned.meetings} meeting${r.scanned.meetings === 1 ? "" : "s"}.`;
    return r.suggestion ? `${base} Did you mean "${r.suggestion}"?` : base;
  }
  const m = r.matched.passages;
  const n = r.matched.meetings;
  return `${m} moment${m === 1 ? "" : "s"} across ${n} meeting${n === 1 ? "" : "s"}` +
    ` — searched all ${r.scanned.meetings}.`;
}

// ── the model layer ────────────────────────────────────────────────────────
//
// Narrow on purpose. The model does not search; the ranking already did. It
// reads the passages that won and writes the sentence — and every claim it
// makes has to name the meeting AND the second, because an answer that spans
// four meetings is exactly the kind you cannot check from memory.

export type Cite = { meeting: string; id: string; at: number; who: string; quote: string };
export type SearchAnswer = { answer: string; cites: Cite[]; grounded: boolean };

export function searchPrompt(question: string, hits: MeetingHit[]): string {
  const blocks: string[] = [];
  hits.forEach((h, i) => {
    const label = h.title || h.room;
    const day = (h.when || "").slice(0, 10);
    blocks.push(`### MEETING ${i + 1}: ${label}${day ? ` (${day})` : ""} [id=${h.id}]`);
    for (const m of h.moments) {
      const at = m.at >= 0 ? `[${m.at}s] ` : `[${m.kind}] `;
      blocks.push(`${at}${m.who ? m.who + ": " : ""}${m.text}`);
    }
    blocks.push("");
  });

  return [
    "You are answering a question using excerpts from several of this person's",
    "own past meetings. Return STRICT JSON:",
    "",
    '{"answer": string, "grounded": boolean,',
    ' "cites": [{"meeting": string, "id": string, "at": number, "who": string, "quote": string}]}',
    "",
    "answer — 1 to 4 sentences, in plain language. Say which meeting each part",
    "  came from by name, e.g. \"In Billing Cutover on 12 March you settled on\".",
    "  If the excerpts disagree with each other, SAY SO and give both — meetings",
    "  change their minds and the change is usually the answer.",
    "",
    "grounded — true only if the excerpts actually answer the question. If they",
    "  merely mention the subject without answering, set false and say what the",
    "  excerpts DO establish. A confident answer to a question the meetings",
    "  never settled is the failure that makes people stop trusting this.",
    "",
    "cites — the excerpts you used. `id` is copied EXACTLY from the [id=…] of",
    "  the meeting the line came from. `at` is the number of seconds from that",
    "  line's [123s] marker, or -1 for a [decision]/[action]/[topic] line.",
    "  `quote` is a short verbatim span from the excerpt — never paraphrase in",
    "  a quote. `meeting` is that meeting's name as printed above.",
    "",
    "RULES:",
    "1. Use only what is below. Never add outside knowledge.",
    "2. Never invent a citation. Every cite must be traceable to a line above.",
    "3. If nothing here answers it, say exactly that, set grounded false, and",
    "   return the closest excerpts as cites so the person can judge.",
    "4. Return JSON only. No prose before or after, no code fences.",
    "",
    `QUESTION: ${String(question || "").slice(0, 500)}`,
    "",
    "EXCERPTS:",
    blocks.join("\n").slice(0, 90000),
  ].join("\n");
}

export function parseSearchAnswer(raw: string, valid?: Set<string>): SearchAnswer {
  const fail: SearchAnswer = {
    answer: "The model's reply couldn't be read. The matching moments are below — they came from your meetings directly.",
    cites: [], grounded: false,
  };
  let text = String(raw || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return fail;
  let p: any;
  try { p = JSON.parse(text.slice(a, b + 1)); } catch { return fail; }

  const cites: Cite[] = (Array.isArray(p?.cites) ? p.cites : [])
    .map((c: any) => ({
      meeting: String(c?.meeting || "").trim(),
      id: String(c?.id || "").trim(),
      at: Number.isFinite(Number(c?.at)) ? Math.max(-1, Math.round(Number(c.at))) : -1,
      who: String(c?.who || "").trim(),
      quote: String(c?.quote || "").trim().slice(0, 300),
    }))
    // A citation pointing at a meeting that was never in the excerpts is an
    // invented citation, and it is worse than none: it is checkable-looking.
    .filter((c: Cite) => c.quote && (!valid || valid.has(c.id)))
    .slice(0, 12);

  const answer = String(p?.answer || "").trim();
  if (!answer) return fail;
  return { answer, cites, grounded: Boolean(p?.grounded) && cites.length > 0 };
}
