/**
 * MAYA GUARD — search across every meeting.
 *
 * Maya asks: "I know we talked about this. I don't know WHICH meeting. Can I
 * just type it and be taken to the moment somebody said it?"
 *
 * FIELD 2026-08-18: Ask worked on one recording at a time, which means the
 * person has to already know the answer to the question they are asking (which
 * meeting was it in) before they can ask it.
 *
 * The guards below concentrate on the four ways search is quietly wrong:
 *   - it ranks by recency and calls it relevance
 *   - it says "no results" after reading a fraction of the archive
 *   - the model cites a meeting that was never in the evidence
 *   - a filter the user typed as a MUST is treated as a hint
 *
 * Run: node lib/search.test.mjs
 */
import {
  parseQuery, tokenize, stemWord, isEmptyQuery, toDoc, rank, highlight,
  suggest, summarise, searchPrompt, parseSearchAnswer, parseWhen,
} from "./search.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── the query language ────────────────────────────────────────────────────
let q = parseQuery("what did we decide about billing");
ok(q.terms.includes("bill") && !q.terms.includes("what") && !q.terms.includes("we"),
  "the words a person types to be polite are not the words that get ranked");
ok(q.terms.includes("decid"), "…and the words that carry meaning survive");

q = parseQuery('"single sign on" rollout');
ok(q.phrases.length === 1 && q.phrases[0] === "single sign on",
  "a quoted phrase is captured as a phrase");
ok(!q.terms.includes("on") && !q.terms.includes("sign"),
  "…and its words do NOT also become loose terms — or every meeting saying \"on\" matches");

q = parseQuery("stripe -paddle");
ok(q.exclude.includes("paddl") && !q.terms.includes("paddl"), "minus means not this");

q = parseQuery("who:Kiran deadline");
ok(q.who === "kiran" && q.terms.includes("deadlin"),
  "who: filters to one person — the query this app can answer and a video call cannot");

ok(isEmptyQuery(parseQuery("   ")) && isEmptyQuery(parseQuery("the and of")),
  "a query of nothing but stopwords is empty, not a search that returns nothing");
ok(!isEmptyQuery(parseQuery("who:kiran")), "…but 'everything Kiran said' is a real query");

ok(tokenize("Q3 margin was 57%").join(",").includes("57%"),
  "numbers and percentages survive tokenising — they are what people search for");

// ── the stemmer, and its limits ───────────────────────────────────────────
ok(stemWord("billing") === stemWord("billed") && stemWord("bills") === stemWord("billing"),
  "billing, billed and bills are one word");
ok(stemWord("meetings") === stemWord("meeting"), "plurals unify");
ok(stemWord("companies") === stemWord("company"), "…including the irregular-looking ones");
ok(stemWord("sing") === "sing" && stemWord("being") === "being",
  "and the minimum stem length stops 'sing' becoming 's' — over-stemming makes search feel haunted");
ok(stemWord("billion") !== stemWord("bill"),
  "billion is not billing — a stemmer that collides those is worse than none");
ok(stemWord("decided") === stemWord("decide") && stemWord("pricing") === stemWord("price"),
  "the silent -e is stripped, so decide/decided and price/pricing are one word each");
ok(stemWord("use") === "use" && stemWord("one") === "one",
  "…but not off short words, where it would leave a stem that means nothing");

// ── building a searchable meeting out of a saved one ──────────────────────
const march = toDoc({
  title: "Billing Cutover And Paddle Risk",
  summaryText: "We compared payment providers.",
  decisions: ["Move billing to Stripe by the end of the quarter."],
  actions: ["**Kiran** to finish the Stripe integration."],
  topics: [{ title: "Providers", points: ["Paddle takes a higher cut."] }],
  people: ["Santosh", "Kiran"],
  utterances: [
    { start: 52, speaker: 0, transcript: "I think we should move to Stripe." },
    { start: 61, speaker: 1, transcript: "Paddle's percentage is too high." },
    { start: 240, speaker: 1, transcript: "I'll own the Stripe integration." },
  ],
}, { id: "u1/march/a.summary.json", room: "march", when: "2026-03-12T10:00:00Z", videoPath: "u1/march/a.mp4" });

ok(march.passages.some((p) => p.kind === "decision"), "the decisions are searchable, not just the transcript");
ok(march.passages.some((p) => p.kind === "title"), "so is the title");
ok(march.passages.find((p) => p.at === 61)?.who === "Kiran",
  "a spoken line keeps the name of the person who said it, resolved from the roster");

const legacy = toDoc({
  title: "Old One",
  transcript: "[10s] Santosh: the invoice run failed again\n[20s] Kiran: I restarted it",
}, { id: "u1/old/a.summary.json", room: "old", when: "2025-11-01T10:00:00Z" });
ok(legacy.passages.some((p) => p.at === 20 && p.who === "Kiran"),
  "a meeting saved before timed lines existed is still findable, and still scrubbable");

const june = toDoc({
  title: "Standup",
  utterances: [
    { start: 30, speaker: 0, transcript: "quick note on billing, nothing changed" },
    { start: 45, speaker: 0, transcript: "otherwise all fine" },
  ],
  people: ["Santosh"],
}, { id: "u1/june/a.summary.json", room: "june", when: "2026-06-01T10:00:00Z", videoPath: "u1/june/b.mp4" });

const docs = [march, legacy, june];

// ── the date on a stored meeting is a real date ──────────────────────────
// Storage paths carry `2026-08-18T01-30-00-000Z`, because a colon is not
// allowed in an object key. Left unconverted it parses as NaN, every recency
// comparison silently becomes 0 vs 0, and the tiebreaker evaluates to a
// constant while the hand-written ISO fixtures in this file all still pass.
ok(parseWhen("2026-08-18T01-30-00-000Z") === "2026-08-18T01:30:00.000Z",
  "the stamp a recording is actually stored under is read back as a real date");
ok(parseWhen("2026-08-18T01:30:00.000Z") === "2026-08-18T01:30:00.000Z",
  "…and a date that was already a date is left alone");
ok(parseWhen("", "2026-03-01T00:00:00Z") === "2026-03-01T00:00:00.000Z",
  "…falling through to whatever the notes file recorded");
ok(parseWhen("not-a-date") === "not-a-date",
  "and something unrecognisable is handed back, not silently blanked");

const stamped = [
  toDoc({ title: "Old", people: ["S"], utterances: [{ start: 5, speaker: 0, transcript: "postgres upgrade" }] },
    { id: "old", room: "r", when: "2025-01-02T09-00-00-000Z" }),
  toDoc({ title: "New", people: ["S"], utterances: [{ start: 5, speaker: 0, transcript: "postgres upgrade" }] },
    { id: "new", room: "r", when: "2026-07-02T09-00-00-000Z" }),
];
ok(stamped.every((d) => !isNaN(Date.parse(d.when))),
  "a meeting loaded from real storage carries a date the ranking can actually compare — left as the raw object key it parses as NaN and every recency comparison silently becomes 0 vs 0");
ok(rank(parseQuery("postgres"), stamped).hits[0]?.id === "new",
  "…so two equal matches stored the way this app really stores them break the tie by date");

// ── relevance beats recency, which is the whole ballgame ──────────────────
let r = rank(parseQuery("billing decision"), docs);
ok(r.hits[0]?.id === march.id,
  "the meeting where it was DECIDED outranks the newer meeting that mentioned it in passing — relevance is not recency");
ok(r.hits[0]?.moments.some((m) => m.kind === "decision"),
  "…and the decision itself is the evidence shown, not a paragraph around it");

// Equal matches, though, should prefer the one you can still remember.
const twinA = toDoc({ title: "Twin", utterances: [{ start: 5, speaker: 0, transcript: "kubernetes upgrade" }], people: ["S"] },
  { id: "a", room: "a", when: "2025-01-01T00:00:00Z" });
const twinB = toDoc({ title: "Twin", utterances: [{ start: 5, speaker: 0, transcript: "kubernetes upgrade" }], people: ["S"] },
  { id: "b", room: "b", when: "2026-08-01T00:00:00Z" });
ok(rank(parseQuery("kubernetes"), [twinA, twinB]).hits[0]?.id === "b",
  "when two meetings match equally, the recent one comes first — recency settles ties and nothing else");

// ── a filter is a filter ─────────────────────────────────────────────────
r = rank(parseQuery("who:kiran stripe"), docs);
ok(r.hits.length === 1 && r.hits[0]?.moments.every((m) => /kiran/i.test(m.who)),
  "who: excludes everyone else — a 'must' that merely nudges the ranking is a filter nobody believes twice");

r = rank(parseQuery('"higher cut"'), docs);
ok(r.hits.length === 1 && r.hits[0]?.moments.some((m) => /higher cut/i.test(m.text)),
  "a quoted phrase matches the phrase");
ok(rank(parseQuery('"higher cut" -paddle'), docs).hits.length === 0,
  "…and minus removes it again, so both halves of the language actually work");
ok(rank(parseQuery('"cut higher"'), docs).hits.length === 0,
  "a phrase is not a bag of words — the order is the point of quoting it");

// ── nothing found, said usefully ─────────────────────────────────────────
r = rank(parseQuery("kubernetes"), docs);
ok(r.hits.length === 0 && r.scanned.meetings === 3,
  "a miss still reports how much was actually read");
r = rank(parseQuery("stipe"), docs);
ok(r.suggestion === stemWord("stripe"),
  "a typo is met with the nearest word that IS in your meetings, instead of a dead end");
ok(!rank(parseQuery("billing"), docs).suggestion,
  "…and a query that matched is not second-guessed");

ok(/searched all 3/.test(summarise(rank(parseQuery("stripe"), docs))),
  "the count says how many meetings were searched — 'no results' after reading a fraction is the app telling you something untrue");
ok(summarise(rank(parseQuery("stripe"), [])) === "You have no recorded meetings yet.",
  "and an empty archive says THAT, rather than 'no results'");

// ── truncation is never silent ───────────────────────────────────────────
const many = Array.from({ length: 30 }, (_, i) =>
  toDoc({ title: `M${i}`, utterances: [{ start: 1, speaker: 0, transcript: "stripe migration" }], people: ["S"] },
    { id: `m${i}`, room: `m${i}`, when: `2026-0${(i % 9) + 1}-01T00:00:00Z` }));
r = rank(parseQuery("stripe"), many, { meetings: 5 });
ok(r.hits.length === 5 && /5 best of 30/.test(r.truncated),
  "showing the best five of thirty SAYS it is showing five of thirty");
ok(r.matched.meetings === 30, "…and the true total is still reported");

// A meeting that returns to a subject beats one dense mention of it.
const oneShot = toDoc({ title: "A", utterances: [{ start: 1, speaker: 0, transcript: "stripe stripe" }], people: ["S"] },
  { id: "one", room: "one", when: "2026-01-01T00:00:00Z" });
const allDay = toDoc({ title: "B", utterances: [
  { start: 1, speaker: 0, transcript: "stripe first" }, { start: 9, speaker: 0, transcript: "stripe again" },
  { start: 20, speaker: 0, transcript: "back to stripe" }, { start: 30, speaker: 0, transcript: "stripe once more" },
], people: ["S"] }, { id: "all", room: "all", when: "2026-01-01T00:00:00Z" });
ok(rank(parseQuery("stripe"), [oneShot, allDay]).hits[0]?.id === "all",
  "a meeting that keeps coming back to the subject outranks one that said it twice in a row");

// A word almost every meeting uses must still be searchable. The textbook BM25
// IDF goes NEGATIVE for a term appearing in more than half the documents, which
// on a four-meeting archive means the meetings that talk about it MOST score
// below zero and vanish entirely.
const common = toDoc({ title: "Alpha", people: ["S"], utterances: [
  { start: 1, speaker: 0, transcript: "we need to sync" }, { start: 9, speaker: 0, transcript: "another sync" },
  { start: 20, speaker: 0, transcript: "sync it again" }, { start: 30, speaker: 0, transcript: "one more sync" },
] }, { id: "c", room: "c", when: "2026-02-01T00:00:00Z" });
const rare = toDoc({ title: "Beta", people: ["S"], utterances: [{ start: 5, speaker: 0, transcript: "we need to sync" }] },
  { id: "rr", room: "rr", when: "2026-02-02T00:00:00Z" });
r = rank(parseQuery("sync"), [common, rare]);
ok(r.hits.length === 2,
  "a word most of your meetings use is still findable — with textbook IDF it scores below zero on a small archive and every result disappears");
ok(r.hits[0]?.id === "c", "…and the meeting that talks about it most still ranks first");

// The same sentence carries more weight when it was recorded as a DECISION
// than when it went past in conversation.
const settled = toDoc({ title: "Infra", decisions: ["Adopt Postgres for the ledger."], people: ["S"] },
  { id: "settled", room: "settled", when: "2026-01-01T00:00:00Z" });
const mentioned = toDoc({ title: "Chat", people: ["S"],
  utterances: [{ start: 5, speaker: 0, transcript: "Adopt Postgres for the ledger." }] },
  { id: "mentioned", room: "mentioned", when: "2026-07-01T00:00:00Z" });
ok(rank(parseQuery("postgres ledger"), [settled, mentioned]).hits[0]?.id === "settled",
  "word for word, a decision outranks a passing remark — even when the remark is newer");

// Best-scoring is not first-said.
const late = toDoc({ title: "Late", people: ["S"], utterances: [
  { start: 10, speaker: 0, transcript: "one word about redis" },
  { start: 300, speaker: 0, transcript: "redis redis redis" },
] }, { id: "late", room: "late", when: "2026-05-01T00:00:00Z" });
ok(rank(parseQuery("redis"), [late]).hits[0]?.moments?.[0]?.at === 10,
  "the strongest moment is not necessarily the first one — the excerpt still reads in the order it was said");

r = rank(parseQuery("stripe"), [march]);
ok(r.hits[0]?.moments.every((m, i, a) => i === 0 || a[i - 1].at <= m.at),
  "the moments inside a result are shown in the order they were said — a meeting read out of order is unreadable");
ok(r.hits[0]?.hitCount >= r.hits[0]?.moments.length,
  "and the result knows how many matches it has, not just how many it is showing");

// ── highlighting, without building HTML in a string ──────────────────────
const parts = highlight("Move billing to Stripe", ["bill"]);
ok(parts.some((p) => p.hit && /billing/i.test(p.t)), "the matched word is marked even though the query was stemmed");
ok(parts.map((p) => p.t).join("") === "Move billing to Stripe",
  "…and reassembling the pieces gives back the original text exactly — no dropped characters, no injected markup");
ok(highlight("<script>alert(1)</script>", ["script"]).map((p) => p.t).join("") === "<script>alert(1)</script>",
  "text that looks like markup survives as text — highlighting returns pieces, not HTML");

// ── the model layer ──────────────────────────────────────────────────────
const hits = rank(parseQuery("billing"), docs).hits;
const prompt = searchPrompt("what did we settle on for billing?", hits);
ok(/\[id=u1\/march\/a\.summary\.json\]/.test(prompt),
  "each excerpt block carries the meeting's id, so a citation can point back at the right recording");
ok(/\[52s\]|\[61s\]|\[decision\]/.test(prompt), "…and each line carries its second, or what kind of line it is");
ok(/disagree with each other/.test(prompt),
  "the prompt asks it to surface meetings that CONTRADICT each other — the change of mind is usually the answer");

const good = parseSearchAnswer(JSON.stringify({
  answer: "In Billing Cutover you settled on Stripe.",
  grounded: true,
  cites: [{ meeting: "Billing Cutover", id: "u1/march/a.summary.json", at: 52, who: "Santosh", quote: "we should move to Stripe" }],
}), new Set(["u1/march/a.summary.json"]));
ok(good.grounded && good.cites[0]?.at === 52, "a good answer keeps its citation and its second");

const invented = parseSearchAnswer(JSON.stringify({
  answer: "You decided in the Q4 planning meeting.",
  grounded: true,
  cites: [{ meeting: "Q4 Planning", id: "not-a-meeting-you-have", at: 10, who: "x", quote: "we agreed" }],
}), new Set(["u1/march/a.summary.json"]));
ok(invented.cites.length === 0 && !invented.grounded,
  "a citation naming a meeting that was never in the evidence is dropped, and the answer stops claiming to be grounded — an invented citation is worse than none because it LOOKS checkable");

const nocites = parseSearchAnswer(JSON.stringify({ answer: "Probably Stripe.", grounded: true, cites: [] }));
ok(!nocites.grounded, "grounded with nothing to point at is not grounded");
ok(parseSearchAnswer("I'm afraid I can't do that").cites.length === 0,
  "a model that answers in prose degrades to no citations rather than throwing mid-search");
ok(/moments are below/.test(parseSearchAnswer('{"answer": "x",}').answer),
  "…and unreadable JSON still tells the person the ranked results underneath are real");
ok(parseSearchAnswer('```json\n{"answer":"Yes.","grounded":false,"cites":[]}\n```').answer === "Yes.",
  "a fenced reply is unwrapped rather than rejected");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
