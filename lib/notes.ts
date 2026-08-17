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

export function notesPrompt(transcript: string, hint?: string): string {
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
