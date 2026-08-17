// The notes a meeting actually produces.
//
// FIELD 2026-08-17: "Users will like if they have clear summary and options
// like wave AI meeting notes attached, AI intelligence is needed for users to
// adopt."
//
// What we had was a paragraph and a flat list. What a person needs is the
// shape of the conversation: what was discussed, broken into the handful of
// things it was actually about; what got settled; what somebody now owes; and
// what happens next. Those are four different questions and a summary that
// blurs them into one paragraph answers none of them — you still have to
// re-listen to find out whether anything was decided.
//
// Pure functions here. The prompt and the rendering are the two parts that
// can be quietly wrong, and neither of them touches the network.

export type Topic = { title: string; points: string[] };

export type Notes = {
  title: string;          // a real title — "Conclave Cleanup And Payments"
  overview: string;       // one paragraph, for somebody who wasn't there
  topics: Topic[];
  decisions: string[];
  actions: string[];
  followups: string[];
  speakers: string[];
  transcript: string;
};

export const EMPTY: Notes = {
  title: "", overview: "", topics: [], decisions: [],
  actions: [], followups: [], speakers: [], transcript: "",
};

// ── the prompt ─────────────────────────────────────────────────────────────
//
// Written out here rather than inline in the route so it can be read, argued
// with and tested. The rules that matter are the ones about NOT inventing:
// a set of notes that adds a decision nobody made is worse than no notes,
// because somebody will act on it.

export function notesPrompt(
  transcript: string,
  hint?: string,
  people?: string[]
): string {
  // FIELD 2026-08-17: every set of notes said "Speaker 1" and "Speaker 2".
  // The app KNEW the names — everybody types one on the way in — and threw
  // them away before the model ever saw them. Notes full of Speaker 2 are
  // notes nobody can act on: you cannot chase a commitment made by a number.
  //
  // But the mapping has to stay honest. Diarisation gives you "these two
  // stretches are the same voice", not "this voice is Kiran". So the names go
  // in as a LIST of who was in the room, with an explicit instruction to keep
  // the number whenever the transcript doesn't settle it. A confidently wrong
  // name is worse than an anonymous one — it puts words in someone's mouth.
  const roster = (people || []).map((x) => String(x || "").trim()).filter(Boolean);
  return [
    "You are writing the notes for the people who were in this meeting, and",
    "for the one person who missed it. Read the transcript and return STRICT",
    "JSON with exactly these keys:",
    "",
    '{"title": string, "overview": string, "topics": [{"title": string,',
    ' "points": string[]}], "decisions": string[], "actions": string[],',
    ' "followups": string[]}',
    "",
    "title — 3 to 6 words in Title Case naming what this meeting was actually",
    "  about. Not \"Team Meeting\". Something a person would recognise in a",
    "  list six weeks later, e.g. \"Billing Cutover And Paddle Risk\".",
    "",
    "overview — ONE paragraph, 2 to 4 sentences. What this meeting was for and",
    "  where it ended up. Written for somebody who was not there.",
    "",
    "topics — the 3 to 9 things the meeting was genuinely about, in the order",
    "  they came up. Each topic has a short noun-phrase title and 3 to 8",
    "  points. A point is one complete sentence. Attribute it when the",
    "  transcript makes the speaker clear (\"Raghu said…\", \"Kiran confirmed…\").",
    "  Wrap the names of products, companies, tools, people and numbers in",
    "  **double asterisks**. Prefer the specific over the general: \"the margin",
    "  shown is **57%** and the real figure is higher\" beats \"they discussed",
    "  margins\".",
    "",
    "decisions — things that were SETTLED, one line each. A preference is not",
    "  a decision. If nothing was settled, return an empty array.",
    "",
    "actions — things somebody now owes. Start with who owns it when the",
    "  transcript says, then what they will do, then when if a time was named:",
    "  \"**Kiran** to finish the payment integration and the expense cleanup\".",
    "",
    "followups — what happens next: the next meeting, the thing being waited",
    "  on, the deadline. Empty array if none was mentioned.",
    "",
    "RULES, in order of importance:",
    "1. Never invent. If the transcript does not support it, leave it out. An",
    "   empty array is a correct answer and an imagined decision is not.",
    "2. Never guess a name. If the transcript only has \"Speaker 2\", write",
    "   \"Speaker 2\".",
    "3. No praise, no filler, no \"the team had a productive discussion\".",
    "4. Transcription is imperfect. Where a word is clearly garbled but the",
    "   meaning is plain, write the meaning. Where the meaning is NOT plain,",
    "   leave it out rather than guessing at it.",
    "5. Return JSON only. No prose before or after, no code fences.",
    hint ? `\nThe host called this meeting: ${hint}` : "",
    roster.length
      ? "\nThe people in the room were: " + roster.join(", ") + ".\n" +
        "Where the transcript makes it CLEAR which of them a speaker label " +
        "belongs to — they introduce themselves, somebody addresses them by " +
        "name, they say something only one of them could say — use the name " +
        "instead of \"Speaker 2\". Where it is not clear, KEEP the speaker " +
        "number. Guessing puts words in somebody's mouth, and a name attached " +
        "to a commitment is the thing people are chased about."
      : "",
    "",
    "TRANSCRIPT:",
    transcript.slice(0, 120000),
  ].join("\n");
}

const str = (v: unknown) => String(v ?? "").trim();
const list = (v: unknown, cap = 40): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, cap) : [];

/** Take whatever the model returned and make it safe to render. A model that
 *  answers with prose, a code fence or half an object must degrade to the
 *  notes we already had — never to an exception, and never to a blank page. */
export function parseNotes(raw: string, base: Notes): Notes {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return base;
  let p: any;
  try {
    p = JSON.parse(text.slice(start, end + 1));
  } catch {
    return base;
  }
  const topics: Topic[] = Array.isArray(p?.topics)
    ? p.topics
        .map((t: any) => ({ title: str(t?.title), points: list(t?.points, 12) }))
        .filter((t: Topic) => t.title && t.points.length)
        .slice(0, 12)
    : base.topics;
  return {
    ...base,
    title: str(p?.title) || base.title,
    overview: str(p?.overview) || base.overview,
    topics,
    decisions: Array.isArray(p?.decisions) ? list(p.decisions) : base.decisions,
    actions: Array.isArray(p?.actions) ? list(p.actions) : base.actions,
    followups: Array.isArray(p?.followups) ? list(p.followups) : base.followups,
  };
}

// ── rendering ──────────────────────────────────────────────────────────────

export const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** `**Paddle**` becomes bold. Escaped FIRST, always — a transcript is
 *  untrusted text and a meeting title is not a place to accept markup. */
export function rich(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function plain(s: string): string {
  return String(s ?? "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** Did the model actually produce structure, or are we looking at a fallback?
 *  The answer decides whether a reader is shown sections or a single list, and
 *  showing empty section headings is how a page looks broken. */
export function hasShape(n: Notes): boolean {
  return n.topics.length > 0;
}

export function notesText(n: Notes): string {
  const out: string[] = [];
  out.push((n.title || "Meeting notes").toUpperCase(), "");
  if (n.overview) out.push(plain(n.overview), "");
  if (n.topics.length) {
    out.push("WHAT WAS DISCUSSED", "");
    n.topics.forEach((t, i) => {
      out.push(`${i + 1}) ${plain(t.title)}`);
      t.points.forEach((pt) => out.push(`   - ${plain(pt)}`));
      out.push("");
    });
  }
  if (n.decisions.length) {
    out.push("DECISIONS AND DIRECTION", ...n.decisions.map((d) => `- ${plain(d)}`), "");
  }
  out.push("ACTION ITEMS");
  out.push(...(n.actions.length ? n.actions.map((a) => `- ${plain(a)}`) : ["- None were captured."]));
  out.push("");
  if (n.followups.length) {
    out.push("FOLLOW-UP / NEXT STEPS", ...n.followups.map((f) => `- ${plain(f)}`), "");
  }
  return out.join("\n");
}

const H = (t: string) =>
  `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#00a99d;font-weight:700;margin:30px 0 12px">${esc(t)}</div>`;

const UL = (items: string[], empty?: string) =>
  items.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${items
        .map(
          (i) =>
            `<tr><td width="14" valign="top" style="padding:4px 0;color:#4a5262;font-size:14px">&bull;</td>` +
            `<td valign="top" style="padding:4px 0;font-size:14.5px;color:#cfd6e4;line-height:1.55">${rich(i)}</td></tr>`
        )
        .join("")}</table>`
    : empty
    ? `<p style="color:#6f7789;font-size:14px;margin:0">${esc(empty)}</p>`
    : "";

/** The email. Tables only — mail clients strip flexbox, and a set of notes
 *  that arrives as one run-on column is a set of notes nobody reads. */
export function notesHtml(
  n: Notes,
  opts: { room?: string; watchUrl?: string; appUrl?: string; when?: string } = {}
): string {
  const body: string[] = [];

  if (n.overview) {
    body.push(
      `<p style="font-size:15.5px;line-height:1.65;color:#cfd6e4;margin:0 0 8px">${rich(n.overview)}</p>`
    );
  }

  if (n.topics.length) {
    body.push(H("What was discussed"));
    n.topics.forEach((t, i) => {
      body.push(
        `<div style="margin:0 0 20px">` +
          `<div style="font-size:15px;font-weight:600;color:#e9edf5;margin:0 0 7px">${i + 1}) ${rich(t.title)}</div>` +
          UL(t.points) +
          `</div>`
      );
    });
  }

  if (n.decisions.length) {
    body.push(H("Decisions and direction"), UL(n.decisions));
  }

  body.push(H("Action items"), UL(n.actions, "Nothing was committed to out loud."));

  if (n.followups.length) {
    body.push(H("Follow-up / next steps"), UL(n.followups));
  }

  const watch = opts.watchUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0">
    <tr><td style="background:#00a99d;border-radius:8px">
      <a href="${esc(opts.watchUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#04120f;text-decoration:none">Watch the recording</a>
    </td></tr></table>
  <p style="font-size:12px;color:#6f7789;margin:10px 0 0">That link works for 7 days. The recording and these notes stay on your host page.</p>`
    : "";

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0d13;color:#e9edf5;padding:30px;max-width:660px;margin:0 auto">
  <div style="font-size:13px;color:#8b93a5;margin:0 0 4px">Quantlys Meeting${opts.when ? ` &middot; ${esc(opts.when)}` : ""}</div>
  <h1 style="font-size:23px;font-weight:700;margin:0 0 18px;color:#e9edf5;line-height:1.3">${esc(n.title || "Meeting notes")}</h1>
  ${body.join("\n  ")}
  ${watch}
  ${
    opts.appUrl
      ? `<p style="font-size:12px;color:#6f7789;margin:28px 0 0;padding-top:18px;border-top:1px solid #262b36">Tick action items off at <a href="${esc(opts.appUrl)}/host" style="color:#00a99d">${esc(opts.appUrl.replace(/^https?:\/\//, ""))}/host</a> — anything you don't tick comes back in Monday's digest.</p>`
      : ""
  }
</div>`;
}

/** A title for the row in a list, and for the email subject line. Falls back
 *  to something true rather than to "Untitled". */
export function notesSubject(n: Notes, room: string): string {
  const t = n.title || "Meeting notes";
  const n_ = n.actions.length;
  return n_ ? `${t} · ${n_} action item${n_ === 1 ? "" : "s"}` : `${t} · ${room}`;
}


// ── asking the meeting a question ──────────────────────────────────────────
//
// FIELD 2026-08-17: the notes answer the questions we thought to ask. The one
// somebody actually has is narrower and arrives three weeks later — "what did
// we decide about the billing provider?", "did anyone commit to a date?",
// "who said the margin number was wrong?" — and today the only way to answer
// it is to play a fifty-minute recording.
//
// The rule that makes this trustworthy rather than impressive: it answers
// from the transcript ONLY, and it says WHERE. An answer with a timestamp is
// one you can check in ten seconds. An answer without one is a claim about a
// meeting you now have to re-listen to anyway, which is the problem it was
// supposed to solve.

export type AskCite = { at: number; who: string; quote: string };
export type Answer = { answer: string; cites: AskCite[]; grounded: boolean };

export function askPrompt(question: string, transcript: string, people?: string[]): string {
  const roster = (people || []).filter(Boolean);
  return [
    "You are answering a question about a meeting, using ONLY the transcript",
    "below. Return STRICT JSON:",
    "",
    '{"answer": string, "cites": [{"at": number, "who": string, "quote": string}],',
    ' "grounded": boolean}',
    "",
    "answer — 1 to 4 sentences, plain language, straight at the question. No",
    "  preamble, no \"based on the transcript\".",
    "",
    "cites — up to 4 moments that support the answer. `at` is the number of",
    "  SECONDS from the start, taken from the [123s] marker at the beginning",
    "  of the line you are quoting. `quote` is a short verbatim fragment, 20",
    "  words at most. `who` is the speaker label on that line.",
    "",
    "grounded — true only if the transcript actually answers the question.",
    "",
    "THE RULE: if the transcript does not answer it, set grounded to false,",
    "return an empty cites array, and say so in the answer — \"That did not",
    "come up\" or \"They discussed X but never settled it\". Do NOT reason from",
    "general knowledge, do NOT infer what they probably meant, and",
    "do NOT soften a no into a maybe. The whole value of this is that it can be",
    "checked in ten seconds; an answer that cannot be checked is worse than",
    "no answer, because the person will act on it.",
    roster.length ? `\nPeople in the room: ${roster.join(", ")}.` : "",
    "",
    `QUESTION: ${String(question || "").slice(0, 500)}`,
    "",
    "TRANSCRIPT:",
    String(transcript || "").slice(0, 120000),
  ].join("\n");
}

export function parseAnswer(raw: string): Answer {
  const fallback: Answer = {
    answer: "I couldn't read an answer out of that. Try asking it a different way.",
    cites: [], grounded: false,
  };
  const text = String(raw || "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return fallback;
  let p: any;
  try {
    p = JSON.parse(text.slice(a, b + 1));
  } catch {
    return fallback;
  }
  const answer = str(p?.answer);
  if (!answer) return fallback;
  const cites: AskCite[] = Array.isArray(p?.cites)
    ? p.cites
        .map((c: any) => ({
          at: Math.max(0, Math.round(Number(c?.at) || 0)),
          who: str(c?.who) || "Someone",
          quote: str(c?.quote).slice(0, 240),
        }))
        .filter((c: AskCite) => c.quote)
        .slice(0, 4)
    : [];
  // A "yes" with nothing behind it is the failure mode this whole feature has
  // to avoid, so grounded is not taken on the model's word alone: claiming to
  // have found something while citing nothing is treated as not finding it.
  const grounded = Boolean(p?.grounded) && cites.length > 0;
  return { answer, cites, grounded };
}

/** The transcript the model reads, with a second-marker on every line so a
 *  citation can point at a moment instead of a paragraph. */
export function timedTranscript(
  utterances: Array<{ start?: number; speaker?: number; transcript?: string }>,
  names?: string[]
): string {
  return (utterances || [])
    .map((u) => {
      const said = String(u?.transcript || "").trim();
      const secs = Math.max(0, Math.round(Number(u?.start) || 0));
      const i = typeof u?.speaker === "number" ? u.speaker : -1;
      const who =
        i >= 0 && names && names[i] ? names[i] : i >= 0 ? `Speaker ${i + 1}` : "Someone";
      return { said, line: `[${secs}s] ${who}: ${said}` };
    })
    // Measure WHAT WAS SAID, not the formatted line. The first version tested
    // the line, and "[61s] Kiran: ok" is fifteen characters — so every "ok",
    // "yeah" and "mm-hm" survived as a citable moment and the model had a
    // hundred meaningless things to point at.
    .filter((x) => x.said.length > 12)
    .map((x) => x.line)
    .join("\n");
}

/** mm:ss for a citation, so a person can scrub to it. */
export function at(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s2)}` : `${two(m)}:${two(s2)}`;
}
