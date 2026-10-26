/**
 * MAYA GUARD — who said it, carried into the PRD.
 *
 * Maya asks: "The notes say Kiran decided it. Why does the PRD just say
 * 'the team'?"
 *
 * FIELD 2026-10-26: the names were on every summary (`utterances[].who`,
 * put there by lib/speakers.ts from the captions) and /api/prd read the
 * paragraph transcript instead — "Speaker 0: …". The model never saw a name.
 *
 * THE RULE: a confidently wrong name is worse than an anonymous one. So every
 * name in the PRD is checked against the speaker labels of the meetings it
 * was built from, and a room full of voices on one person's microphone is
 * labelled by microphone, not by person.
 *
 * Run: node --experimental-strip-types lib/prd-speakers.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  attributedTranscript, allowedLabels, matchLabel, normalizeAttributions,
  scrubInlineNames, attributionNote, cleanName, isRealName, UNKNOWN_SPEAKER,
} from "./prd-speakers.ts";
import {
  normalizeReport, prdMarkdown, prdPrompt, prdSystemPrompt, speakersBlock,
  fallbackReport, RUBRICS, MODE_META,
} from "./prd.ts";
import { extractPrd } from "./integrations.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── 1. the transcript the PRD reads now has names in it ──────────────────
const named = {
  transcript: "Speaker 0: we should gate on the preview\n\nSpeaker 1: agreed",
  people: ["Kiran", "Priya"],
  utterances: [
    { start: 3, speaker: 0, who: "Kiran", transcript: "We should gate the confirm button on the preview." },
    { start: 7, speaker: 0, who: "Kiran", transcript: "No preview, no confirm." },
    { start: 12, speaker: 1, who: "Priya", transcript: "Agreed. I'll write the copy for it." },
    { start: 75, speaker: 2, who: "Speaker 3", transcript: "What about VAT on proration?" },
  ],
};
const a = attributedTranscript(named);
ok(a.source === "utterances", "a summary with timed lines is read from the timed lines, not the paragraph transcript");
ok(a.text.includes("[00:03] Kiran: We should gate the confirm button on the preview. No preview, no confirm."),
  "consecutive lines from one person become one turn, stamped and named");
ok(a.text.includes("[00:12] Priya: Agreed.") && a.text.includes("[01:15] Speaker 3: What about VAT"),
  "every turn carries its label");
ok(!/Speaker 0:/.test(a.text),
  "NEGATIVE CONTROL, and this is the bug: the old input was 'Speaker 0: …' even though the summary knew it was Kiran");
ok(a.names.join(",") === "Kiran,Priya" && a.labels.includes("Speaker 3") && !a.names.includes("Speaker 3"),
  "an unnamed voice is a LABEL the model may use as written, never a NAME");
ok(a.named === 2 && a.total === 3, "and it is counted: 2 of 3 turns named");

// ── 2. the single-mic room ───────────────────────────────────────────────
const room = {
  people: ["Kiran"],
  utterances: [
    { start: 1, speaker: 0, who: "Kiran", transcript: "Let's ship the preview first." },
    { start: 5, speaker: 1, who: "Kiran", transcript: "I disagree, downgrades matter more." },
  ],
};
const r = attributedTranscript(room);
ok(r.sharedMic === "Kiran", "one person joined and two voices were heard: that is a shared microphone");
ok(r.text.includes("Speaker 1 on Kiran's mic:") && r.text.includes("Speaker 2 on Kiran's mic:"),
  "…so the voices are labelled by microphone");
ok(!r.names.includes("Kiran"),
  "NEGATIVE CONTROL: 'Kiran' is NOT an attributable name here. Every caption on that laptop said Kiran, so every voice mapped to Kiran — and 'Kiran disagreed' about something the person across the table said is the wrong name this exists to refuse");
const solo = attributedTranscript({ people: ["Kiran"], utterances: [
  { start: 1, speaker: 0, who: "Kiran", transcript: "Just me today, shipping the preview." },
] });
ok(solo.sharedMic === null && solo.names.join() === "Kiran", "one person and ONE voice is just that person");

// ── 3. old summaries and anonymous transcripts ───────────────────────────
const old = attributedTranscript({ transcript: "Speaker 0: hello there\nSpeaker 1: hi" });
ok(old.source === "transcript" && old.names.length === 0 && old.labels.length === 0,
  "a Deepgram paragraph transcript with no timed lines yields NO names — 'Speaker 0' is a voice, not a person, and nothing may be attributed");
const cc = attributedTranscript({ transcript: "[3s] Kiran: we gate on preview\n[9s] Priya: agreed" });
ok(cc.names.join(",") === "Kiran,Priya", "an old caption transcript names its speakers in the text, and those are read");
ok(attributedTranscript(null).text === "" && attributedTranscript({}).names.length === 0, "nothing in, nothing out");
const anon = attributedTranscript({ utterances: [{ start: 0, transcript: "hello", who: "Someone" }] });
ok(anon.text === `[00:00] ${UNKNOWN_SPEAKER}: hello` && anon.names.length === 0,
  "'Someone' (no speaker index at all) is an unknown speaker, not a person called Someone");

// ── 4. names cannot pose as structure ────────────────────────────────────
ok(cleanName("Kiran: decided\n[00:01] Priya") === "Kiran decided 00 01 Priya",
  "a display name cannot carry a colon, brackets or a newline into the prompt and fake a line of speech");
ok(cleanName("x".repeat(200)).length === 60, "and it is bounded");
ok(!isRealName("Speaker 4") && !isRealName("  ") && isRealName("Speaker Jones"),
  "'Speaker 4' is a placeholder; 'Speaker Jones' is a person");

// ── 5. the model is not trusted with names ───────────────────────────────
const allowed = allowedLabels([a]);
ok(matchLabel("kiran", allowed.labels) === "Kiran" && matchLabel("Kieran", allowed.labels) === "",
  "case is forgiven, spelling is not — 'Kieran' is a different person as far as a document goes");
const atts = normalizeAttributions([
  { kind: "decision", text: "Confirm is gated on the preview", by: ["Kiran"] },
  { kind: "action_item", text: "Write the preview copy", by: ["Priya"], owner: "priya" },
  { kind: "open_question", text: "VAT on proration", by: ["Speaker 3"] },
  { kind: "requirement", text: "Admins can downgrade", by: ["Bob from legal", "Kiran"] },
  { kind: "decision", text: "Ship Friday", by: ["Elon"] },
  { kind: "vibe", text: "nope", by: ["Kiran"] },
  { kind: "decision", text: "  ", by: ["Kiran"] },
], allowed.labels);
ok(atts.length === 5, "unknown kinds and empty items are dropped; real ones are kept");
ok(atts[0].by.join() === "Kiran" && atts[1].owner === "Priya", "a real speaker survives, canonicalised");
ok(atts[2].by.join() === "Speaker 3", "an unnamed voice survives AS its label");
ok(atts[3].by.join() === "Kiran", "NEGATIVE CONTROL: 'Bob from legal' was mentioned, not a speaker — removed, the real one kept");
ok(atts[4].by.length === 0 && atts[4].text === "Ship Friday",
  "NEGATIVE CONTROL: an invented name is removed and the item is KEPT, unattributed — the decision is real even if the name is not");

const md = "- Gate confirm _(raised by Kiran)_\n- Ship Friday _(raised by Elon)_\n- Copy _(owner: Priya)_\n- Both _(raised by Kiran and Bob)_";
const clean = scrubInlineNames(md, allowed.labels);
ok(clean.includes("_(raised by Kiran)_") && clean.includes("_(owner: Priya)_"), "inline marks with real speakers stand");
ok(clean.includes("Ship Friday _(unattributed)_") && !clean.includes("Elon"),
  "NEGATIVE CONTROL: an inline '(raised by Elon)' in the document itself is rewritten to unattributed");
ok(clean.includes("Both _(raised by Kiran)_") && !clean.includes("Bob"), "…and a mixed one keeps only the real speaker");

// ── 6. through the report and into the document ──────────────────────────
const parsed = {
  dimensions: RUBRICS.build.map((d) => ({ key: d.key, status: "present", evidence: "said" })),
  summary: "ok",
  prd: "# PRD\n\n## User stories\n\n- As an admin, I can preview the invoice _(raised by Kiran)_\n- As finance, I can audit _(raised by Elon)_\n",
  attributions: atts,
};
const note = attributionNote([a]);
const rep = normalizeReport(parsed, "build", "m", { ...allowed, note });
ok(rep.speakers.join() === "Kiran,Priya" && rep.attributions.length === 5 && rep.attribution_note === note,
  "the report carries the speakers, the checked attributions and the note");
ok(!rep.prd.includes("Elon") && rep.prd.includes("_(raised by Kiran)_"), "the artifact itself is scrubbed");
const doc = prdMarkdown(rep, "P", [{ title: "Kickoff", transcript: "x" }]);
ok(doc.includes("## Who raised what") && doc.includes("### Decisions") && doc.includes("### Action items"),
  "the document has a Who-raised-what section, grouped");
ok(doc.includes("- Write the preview copy — _raised by Priya · owner: Priya_"), "an action item shows who raised it and who owns it");
ok(doc.includes("- Ship Friday — _unattributed_"), "an unattributed item says so");
ok(doc.includes("2 of 3 turns could be matched"), "…and the note says how much could be attributed, and why not more");

const legacy = normalizeReport(parsed, "build", "m");
ok(legacy.attributions === undefined && legacy.speakers === undefined && !prdMarkdown(legacy, "P", []).includes("Who raised what"),
  "a caller that did not check names gets NO attributions — names nothing has checked are not trusted");
ok(fallbackReport("boom").attributions === undefined,
  "a failed assessment still produces NO document, and no attributions either");

// ── 7. the exports carry it ──────────────────────────────────────────────
const parts = extractPrd(rep.prd, "P");
ok(parts.stories.some((s) => /raised by Kiran/.test(s.text || s.title)),
  "a user story pushed to GitHub / Linear / Jira keeps who raised it, because the mark is part of the story's own line");

// ── 8. what the model is told ────────────────────────────────────────────
const sys = prdSystemPrompt("PRD", "Build-ready");
ok(/ATTRIBUTION/.test(sys) && /ONLY the speaker/.test(sys) && /MENTIONED is not/.test(sys),
  "the system prompt: speaker labels only, and a mentioned name is not a speaker");
ok(/"attributions":\[\{"kind"/.test(sys), "…and the JSON shape asks for attributions");
const up = prdPrompt("x", RUBRICS.build, MODE_META.build, null, allowed);
ok(up.includes("- Kiran") && up.includes("- Priya") && up.includes("- Speaker 3") && /never guess/.test(up),
  "the user prompt lists the names that may be used, and the unnamed voices separately");
ok(/Do NOT attribute/.test(speakersBlock({ names: [], labels: [] })),
  "with no names at all, the model is told to attribute nothing");
ok(!prdPrompt("x", RUBRICS.build, MODE_META.build).includes("Speakers."),
  "a caller with no speaker context gets the old prompt exactly");

// ── 9. the notes reflect what happened ───────────────────────────────────
ok(/No speaker names were available/.test(attributionNote([old])), "no names: the note says so and how to get them");
ok(/Kiran's microphone/.test(attributionNote([r])), "shared mic: the note names the microphone");

// ── 10. the route actually uses all this ─────────────────────────────────
const route = readFileSync(new URL("../app/api/prd/route.ts", import.meta.url), "utf8")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
ok(/attributedTranscript\(\{[\s\S]*utterances: j\?\.utterances/.test(route),
  "/api/prd reads the named utterances off each summary");
ok(/normalizeReport\(parsed, mode, chosen\.id, speakerCtx\)/.test(route),
  "…and passes the allowed labels to normalizeReport, so names are checked server-side");
ok(/prdPrompt\(stitched\.text, dims, meta, ctx, allowed\)/.test(route),
  "…and to the prompt");
ok(!/\.from\("[a-z_]+"\)\s*\.(insert|upsert|update)/.test(route.replace(/from\("meetings"\)\s*\.select/g, "")),
  "PRIVACY: nothing new is written to a table — the names were already in the summary");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
