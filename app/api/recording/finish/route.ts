// After a recording is saved: transcribe it, write meeting notes next to it,
// and email the host. Every step is optional — a missing key turns that step
// off and the recording is still there. Nothing here ever fails a recording.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUMMARY_SUFFIX = ".summary.json";

type Notes = {
  summary: string;
  actions: string[];
  decisions: string[];
  topics: string[];
  transcript: string;
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ---- Deepgram: words, speakers, a summary and the topics discussed --------

async function listen(url: string): Promise<any | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  const q = [
    "model=nova-2",
    "smart_format=true",
    "punctuate=true",
    "paragraphs=true",
    "utterances=true",
    "diarize=true",
    "summarize=v2",
    "topics=true",
    "detect_language=true",
  ].join("&");
  const r = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) return null;
  return r.json();
}

// ---- Action items without needing another account -------------------------
// Someone committing to something in a meeting says it in a small number of
// ways. This is not clever, and it does not need to be: it is far better than
// a host reading a 30-minute transcript, and it costs nothing to run.

const COMMIT = new RegExp(
  "\\b(i'?ll|i will|we'?ll|we will|i'?m going to|we'?re going to|" +
    "we need to|we should|you should|let'?s|can you|could you|please|" +
    "make sure|follow ?up|action item|take (?:this|that|it) on|i'?ll own|" +
    "send (?:me|us|over)|share (?:the|a)|set up|schedule|by (?:eod|cob|" +
    "today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|" +
    "end of (?:day|week)))\\b",
  "i"
);
const DECIDE = new RegExp(
  "\\b(we (?:decided|agreed|settled on)|let'?s go with|we'?re going with|" +
    "the decision is|final answer|agreed[,.]|sign(?:ed)? off|approved)\\b",
  "i"
);
const NOISE = /^(?:yeah|yes|no|ok|okay|right|sure|thanks|thank you|hello|hi|mm+|uh+|um+)[\s.,!?]*$/i;

function speakerName(n: number | undefined) {
  return typeof n === "number" ? `Speaker ${n + 1}` : "Someone";
}

function extract(dg: any): { actions: string[]; decisions: string[] } {
  const utts: any[] = dg?.results?.utterances || [];
  const actions: string[] = [];
  const decisions: string[] = [];
  const seen = new Set<string>();
  for (const u of utts) {
    const text = String(u?.transcript || "").trim();
    if (text.length < 12 || NOISE.test(text)) continue;
    const line = `${speakerName(u?.speaker)} — ${text}`;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    if (DECIDE.test(text)) {
      seen.add(key);
      if (decisions.length < 10) decisions.push(line);
    } else if (COMMIT.test(text)) {
      seen.add(key);
      if (actions.length < 15) actions.push(line);
    }
  }
  return { actions, decisions };
}

// ---- Optional: let a model write the notes properly -----------------------
// Only runs when a key exists. Its output REPLACES the extraction above; if
// anything goes wrong the extraction is still there, so notes never vanish.

async function refine(transcript: string, base: Notes): Promise<Notes> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || transcript.length < 200) return base;
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = openrouter
    ? process.env.NOTES_MODEL || "anthropic/claude-3.5-sonnet"
    : process.env.NOTES_MODEL || "gpt-4o-mini";
  const prompt =
    "You are taking notes for the people who were in this meeting. From the " +
    "transcript below, return STRICT JSON with exactly these keys: " +
    '{"summary": string, "actions": string[], "decisions": string[]}. ' +
    "summary: 3-5 sentences, plain language, what was discussed and where it " +
    "landed. actions: each item is one line, starting with who owns it if the " +
    "transcript says, then what they will do, then when if a date was said. " +
    "decisions: things that were settled, one line each. If there were no " +
    "actions or no decisions, return an empty array — never invent one. " +
    "Return JSON only, no prose.\n\nTRANSCRIPT:\n" +
    transcript.slice(0, 60000);
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!r.ok) return base;
    const j: any = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return base;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      ...base,
      summary: String(parsed.summary || base.summary),
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String) : base.actions,
      decisions: Array.isArray(parsed.decisions)
        ? parsed.decisions.map(String)
        : base.decisions,
    };
  } catch {
    return base;
  }
}

// ---- Rendering ------------------------------------------------------------

function asText(room: string, n: Notes) {
  const lines = [`MEETING NOTES — ${room}`, ""];
  if (n.summary) lines.push("SUMMARY", n.summary, "");
  lines.push("ACTION ITEMS");
  lines.push(...(n.actions.length ? n.actions.map((a) => `• ${a}`) : ["• None were captured."]));
  lines.push("");
  if (n.decisions.length) lines.push("DECISIONS", ...n.decisions.map((d) => `• ${d}`), "");
  if (n.topics.length) lines.push("TOPICS", n.topics.join(", "), "");
  return lines.join("\n");
}

function esc(s: string) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function asHtml(room: string, n: Notes, link: string) {
  const list = (items: string[]) =>
    items.length
      ? `<ul style="margin:0 0 18px;padding-left:20px">${items
          .map((i) => `<li style="margin:0 0 6px">${esc(i)}</li>`)
          .join("")}</ul>`
      : `<p style="color:#5b6478;margin:0 0 18px">None were captured.</p>`;
  return `
  <div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c2230;max-width:640px">
    <h2 style="margin:0 0 2px">Meeting notes</h2>
    <p style="color:#5b6478;margin:0 0 22px">${esc(room)}</p>
    ${n.summary ? `<h3 style="margin:0 0 6px">Summary</h3><p style="margin:0 0 18px">${esc(n.summary)}</p>` : ""}
    <h3 style="margin:0 0 6px">Action items</h3>
    ${list(n.actions)}
    ${n.decisions.length ? `<h3 style="margin:0 0 6px">Decisions</h3>${list(n.decisions)}` : ""}
    ${n.topics.length ? `<p style="color:#5b6478;margin:0 0 18px"><strong>Topics:</strong> ${esc(n.topics.join(", "))}</p>` : ""}
    ${
      link
        ? `<p style="margin:24px 0"><a href="${link}" style="background:#00a99d;color:#06110f;
             padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">
             Watch or download the recording</a></p>
           <p style="color:#8b93a5;font-size:13px">This link works for 7 days. The recording and
           these notes are also on your host page.</p>`
        : ""
    }
  </div>`;
}

async function email(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.RESEND_FROM || "Quantlys Meeting <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return r.ok;
}

// ---- The route ------------------------------------------------------------

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const room = String(body.room || "").trim();
  const videoPath = String(body.videoPath || "").trim();
  const audioPath = body.audioPath ? String(body.audioPath) : "";
  if (!room || !videoPath) {
    return Response.json({ error: "Missing the recording details." }, { status: 400 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }

  // Who is asking? Their own token, verified — never trust an id in a body.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = await admin().auth.getUser(jwt);
  const user = who.data?.user;
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!videoPath.startsWith(`${user.id}/`)) {
    return Response.json({ error: "That recording isn't yours." }, { status: 403 });
  }

  const sb = admin();
  const forTranscript = audioPath || videoPath;
  const signed = await sb.storage.from("recordings").createSignedUrl(forTranscript, 3600);

  let notes: Notes = { summary: "", actions: [], decisions: [], topics: [], transcript: "" };
  try {
    const dg = signed.data?.signedUrl ? await listen(signed.data.signedUrl) : null;
    if (dg) {
      const alt = dg?.results?.channels?.[0]?.alternatives?.[0];
      notes.transcript = alt?.paragraphs?.transcript || alt?.transcript || "";
      notes.summary = dg?.results?.summary?.short || "";
      const segs: any[] = dg?.results?.topics?.segments || [];
      notes.topics = Array.from(
        new Set(segs.flatMap((s) => (s?.topics || []).map((t: any) => String(t?.topic || ""))))
      )
        .filter(Boolean)
        .slice(0, 8);
      const found = extract(dg);
      notes.actions = found.actions;
      notes.decisions = found.decisions;
      notes = await refine(notes.transcript, notes);
    }
  } catch {
    /* notes are a bonus; the recording is the product */
  }

  const summaryPath = videoPath.replace(/\.[a-z0-9]+$/i, "") + SUMMARY_SUFFIX;
  const payload = {
    room,
    videoPath,
    audioPath: audioPath || null,
    // The host page shows this field, so it carries the whole set of notes.
    summary: asText(room, notes),
    summaryText: notes.summary,
    actions: notes.actions,
    decisions: notes.decisions,
    topics: notes.topics,
    transcript: notes.transcript,
    createdAt: new Date().toISOString(),
  };
  try {
    await sb.storage
      .from("recordings")
      .upload(summaryPath, new Blob([JSON.stringify(payload)], { type: "application/json" }), {
        contentType: "application/json",
        upsert: true,
      });
  } catch {
    /* the recording still exists; the sidecar is a convenience */
  }

  // The email carries the notes and a link — never the file. A recording is
  // tens of megabytes and mail servers reject it.
  const watch = await sb.storage.from("recordings").createSignedUrl(videoPath, 60 * 60 * 24 * 7);
  const link = watch.data?.signedUrl || "";
  let emailed: string | false = false;
  try {
    const ok = await email(
      user.email || "",
      `Meeting notes — ${room}`,
      asHtml(room, notes, link)
    );
    emailed = ok ? user.email || "" : false;
  } catch {
    emailed = false;
  }

  return Response.json({
    ok: true,
    summary: notes.summary,
    actions: notes.actions.length,
    decisions: notes.decisions.length,
    hasTranscript: Boolean(notes.transcript),
    emailed,
  });
}
