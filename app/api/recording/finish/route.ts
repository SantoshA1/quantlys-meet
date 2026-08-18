// After a recording is saved: transcribe it, write meeting notes next to it,
// and email the host. Every step is optional — a missing key turns that step
// off and the recording is still there. Nothing here ever fails a recording.

import { createClient } from "@supabase/supabase-js";
import type { Step } from "@/lib/notes-health";
import { checkTranscribe, checkNotes, checkEmail, headline } from "@/lib/notes-health";
import { pickActionItems } from "@/lib/digest";
import type { Notes } from "@/lib/notes";
import {
  EMPTY as EMPTY_NOTES, notesPrompt, parseNotes, notesHtml, notesText, notesSubject,
} from "@/lib/notes";
import { chooseModel } from "@/lib/model";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUMMARY_SUFFIX = ".summary.json";


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

type Marked = { text: string; owner: string; at: number };

function extract(dg: any): { actions: string[]; decisions: string[]; marks: Marked[] } {
  const utts: any[] = dg?.results?.utterances || [];
  const actions: string[] = [];
  const decisions: string[] = [];
  // QUANTLYS 2026-08-17 — the WHEN was always there in Deepgram's utterances
  // and was being thrown away. A commitment you can jump to in the recording
  // is a commitment somebody can settle; one without a timestamp is a claim
  // you have to re-listen to a whole meeting to check.
  const marks: Marked[] = [];
  const seen = new Set<string>();
  for (const u of utts) {
    const text = String(u?.transcript || "").trim();
    if (text.length < 12 || NOISE.test(text)) continue;
    const who = speakerName(u?.speaker);
    const line = `${who} — ${text}`;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    if (DECIDE.test(text)) {
      seen.add(key);
      if (decisions.length < 10) decisions.push(line);
    } else if (COMMIT.test(text)) {
      seen.add(key);
      if (actions.length < 15) actions.push(line);
      marks.push({ text, owner: who, at: Math.round(Number(u?.start) || 0) });
    }
  }
  return { actions, decisions, marks };
}

// ---- Optional: let a model write the notes properly -----------------------
// Only runs when a key exists. Its output REPLACES the extraction above; if
// anything goes wrong the extraction is still there, so notes never vanish.

async function refine(
  transcript: string,
  base: Notes,
  hint: string,
  people: string[]
): Promise<Notes> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || transcript.length < 200) return base;
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  // FIELD 2026-08-18: this used to hardcode "anthropic/claude-3.5-sonnet".
  // The vendor retired it, the key stayed valid, the setup check stayed
  // green, and every model-backed feature returned a 404 nobody could read.
  // Ask the provider what it actually has, then take the best of ours.
  const chosen = await chooseModel({ openrouter, key, wanted: process.env.NOTES_MODEL });
  const model = chosen.id;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: notesPrompt(transcript, hint, people) }],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });
    if (!r.ok) return base;
    const j: any = await r.json();
    // parseNotes never throws and never returns less than it was given: a
    // model that answers with an apology leaves the extracted notes intact.
    return parseNotes(String(j?.choices?.[0]?.message?.content || ""), base);
  } catch {
    return base;
  }
}

// ---- Rendering ------------------------------------------------------------

function esc(x: string) {
  return String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
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

  // FIELD 2026-08-17 — every step below used to swallow its own failure, so a
  // host who got no notes and no email had no way to find out why. Each one
  // now records what happened, in the same words the "check my setup" button
  // uses, and the answer travels with the recording forever.
  const steps: Step[] = [];
  const say = (key: Step["key"], label: string, ok: boolean, detail: string) =>
    steps.push({ key, label, ok, detail });

  let notes: Notes = { ...EMPTY_NOTES };
  let marks: Marked[] = [];
  let timedLines: Array<{ start: number; speaker: number; transcript: string }> = [];
  let heard = false;
  try {
    if (!signed.data?.signedUrl) {
      say("transcribe", "Turn speech into text", false,
          "The audio couldn't be read back out of storage, so there was nothing to transcribe.");
    }
    const dg = signed.data?.signedUrl ? await listen(signed.data.signedUrl) : null;
    if (!dg && signed.data?.signedUrl) {
      // Ask the same question the pre-flight asks, so the reason is specific:
      // no key, a rejected key, and a bad day at Deepgram all read differently.
      const why = await checkTranscribe();
      say("transcribe", "Turn speech into text", false,
          why.ok
            ? "Deepgram accepted the key but returned nothing for this recording — usually silence, a muted microphone, or a recording only a second or two long."
            : why.detail);
    }
    if (dg) {
      const alt = dg?.results?.channels?.[0]?.alternatives?.[0];
      notes.transcript = alt?.paragraphs?.transcript || alt?.transcript || "";
      notes.overview = dg?.results?.summary?.short || "";
      // Deepgram's own topic labels are one or two words ("billing",
      // "hiring"). Useful as a fallback heading, useless as notes — so they
      // become a single topic block only if the model never runs.
      const segs: any[] = dg?.results?.topics?.segments || [];
      const labels = Array.from(
        new Set(segs.flatMap((s) => (s?.topics || []).map((t: any) => String(t?.topic || ""))))
      ).filter(Boolean).slice(0, 8);
      // The timed lines, kept so a question can be answered with a moment
      // rather than a paragraph. Capped: a three-hour meeting is ~4k lines and
      // the sidecar has to stay a file somebody can download.
      timedLines = (dg?.results?.utterances || []).slice(0, 4000).map((u: any) => ({
        start: Math.round(Number(u?.start) || 0),
        speaker: typeof u?.speaker === "number" ? u.speaker : -1,
        transcript: String(u?.transcript || ""),
      }));
      notes.speakers = Array.from(
        new Set((dg?.results?.utterances || []).map((u: any) =>
          typeof u?.speaker === "number" ? `Speaker ${u.speaker + 1}` : ""))
      ).filter(Boolean) as string[];
      if (labels.length) notes.topics = [{ title: "Mentioned", points: labels }];
      const found = extract(dg);
      notes.actions = found.actions;
      notes.decisions = found.decisions;
      marks = found.marks;
      heard = Boolean(notes.transcript.trim());
      say("transcribe", "Turn speech into text", heard,
          heard
            ? `Transcribed ${notes.transcript.split(/\s+/).filter(Boolean).length} words.`
            : "Deepgram ran but heard no words — usually silence or a muted microphone.");
      const before = JSON.stringify([notes.overview, notes.topics, notes.actions, notes.decisions]);
      notes = await refine(notes.transcript, notes, String(body.title || ""),
                           Array.isArray(body.people) ? body.people.map(String).slice(0, 40) : []);
      const changed = JSON.stringify([notes.overview, notes.topics, notes.actions, notes.decisions]) !== before;
      if (heard) {
        const why = changed ? null : await checkNotes();
        say("notes", "Write the summary and action items", true,
            changed
              ? `A model wrote these notes — ${notes.topics.length} topic(s), ${notes.actions.length} action item(s), ${notes.decisions.length} decision(s).`
              : `${why?.detail || "Written by reading the transcript directly."} Found ${notes.actions.length} action item(s), ${notes.decisions.length} decision(s).`);
      }
    }
  } catch (e: any) {
    // Still not fatal — but no longer invisible.
    say("transcribe", "Turn speech into text", false,
        `The transcription step stopped with an error: ${e?.message || e}. The recording itself is safe.`);
  }
  // FIELD 2026-08-17 — the fallback that should always have existed.
  //
  // If the meeting was captioned live, every word is already here: it went
  // past on everyone's screen. Reporting "no transcript" because one API key
  // is missing, or because the upload was rejected, is the app choosing to
  // know less than it does — and the person is left with a recording and
  // nothing to read.
  //
  // Only used when the real transcription produced nothing. Captions are a
  // live convenience and the recording's own transcript is the better record;
  // this is what happens when there isn't one.
  const ccLines: Array<{ start: number; speaker: number; transcript: string; who?: string }> =
    Array.isArray(body.captions) ? body.captions.slice(0, 4000) : [];
  const ccText = String(body.captionText || "");
  if (!heard && (ccText.trim() || ccLines.length)) {
    notes.transcript = ccText.trim() || ccLines.map((l) => l.transcript).join("\n");
    timedLines = ccLines.map((l) => ({
      start: Math.max(0, Math.round(Number(l.start) || 0)),
      speaker: Number(l.speaker) >= 0 ? Number(l.speaker) : -1,
      transcript: String(l.transcript || ""),
    }));
    marks = ccLines
      .filter((l) => COMMIT.test(String(l.transcript || "")))
      .map((l) => ({
        text: String(l.transcript || ""),
        owner: String(l.who || "Someone"),
        at: Math.max(0, Math.round(Number(l.start) || 0)),
      }));
    heard = true;
    // Replace the failure rather than adding a success beside it. Two
    // "Turn speech into text" rows, one red and one green, is a report that
    // makes a person work out what happened — the whole point of this list is
    // that they don't have to.
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].key === "transcribe") steps.splice(i, 1);
    say("transcribe", "Turn speech into text", true,
        `The recording couldn't be transcribed, so these notes were written from the ${ccLines.length} live caption line(s) instead. Captions are less accurate than the transcript — treat anything surprising as worth checking against the recording.`);
    const people = Array.isArray(body.people) ? body.people.map(String).slice(0, 40) : [];
    const before = JSON.stringify([notes.overview, notes.topics, notes.actions]);
    notes = await refine(notes.transcript, notes, String(body.title || ""), people);
    const changed = JSON.stringify([notes.overview, notes.topics, notes.actions]) !== before;
    say("notes", "Write the summary and action items", true,
        changed
          ? `Written from the live captions — ${notes.topics.length} topic(s), ${notes.actions.length} action item(s).`
          : "Written from the live captions by reading them directly.");
  }

  if (!steps.some((s) => s.key === "notes")) {
    say("notes", "Write the summary and action items", false,
        heard
          ? "No notes were produced."
          : "There was no transcript to write notes from, and captions weren't on during the meeting — turn them on next time and the notes can be written from those even when transcription fails.");
  }

  const summaryPath = videoPath.replace(/\.[a-z0-9]+$/i, "") + SUMMARY_SUFFIX;
  const payload = {
    room,
    videoPath,
    audioPath: audioPath || null,
    // The host page shows this field, so it carries the whole set of notes.
    summary: notesText(notes),
    // …and the STRUCTURE travels beside it, so the notes page can render
    // sections rather than re-parsing a wall of text back into headings.
    notes,
    title: notes.title,
    summaryText: notes.overview,
    actions: notes.actions,
    decisions: notes.decisions,
    followups: notes.followups,
    topics: notes.topics,
    transcript: notes.transcript,
    // What "ask this meeting a question" reads. Without the timings an answer
    // can still be right, but it can't be checked — and an answer nobody can
    // check is the thing that makes people stop trusting the feature.
    utterances: timedLines,
    people: Array.isArray(body.people) ? body.people.map(String).slice(0, 40) : [],
    fromCaptions: !ccLines.length ? false : notes.transcript === (ccText.trim() || ccLines.map((l) => l.transcript).join("\n")),
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

  // ---- The commitments become ROWS -----------------------------------------
  // This is the line between "a pile of notes" and "a thing that tracks work".
  // A sentence inside a summary file cannot be ticked off, cannot be counted,
  // and cannot come back next Monday still open. A row can.
  try {
    const { data: meeting } = await sb
      .from("meetings")
      .select("id, title, project, started_at")
      .eq("room_name", room)
      .maybeSingle();
    // Prefer the model's cleaned-up actions when it produced them (they read
    // as tasks, not as speech) but keep the raw marks for the timestamps.
    // The model's items are the rows; the raw utterances only lend them their
    // timestamps. See lib/digest.ts — saving the utterances themselves produced
    // fifteen fragments and not one task.
    const picked = pickActionItems(notes.actions, marks);
    const rows = picked.map((m) => ({
      user_id: user.id,
      meeting_id: meeting?.id ?? null,
      room_name: room,
      project: meeting?.project ?? null,
      meeting_title: meeting?.title ?? null,
      text: m.text.slice(0, 500),
      // A plain column, not an expression index: PostgREST's on_conflict can
      // only name columns, so `md5(text)` in the index would have made every
      // re-run insert duplicates instead of updating.
      fingerprint: m.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200),
      owner: m.owner || null,
      ts_seconds: m.at,
      video_path: videoPath,
      met_at: meeting?.started_at || new Date().toISOString(),
    }));
    if (rows.length) {
      // Re-running a recording's notes must update, never duplicate.
      const { error } = await sb
        .from("action_items")
        .upsert(rows, { onConflict: "user_id,room_name,fingerprint", ignoreDuplicates: true });
      say("items", "Track the action items", !error,
          error
            ? `Couldn't save the action items: ${error.message}. Has the action_items table been created?`
            : `Saved ${rows.length} action item(s) — they'll appear in your weekly digest until you tick them off.`);
    } else if (heard) {
      say("items", "Track the action items", true,
          "Nobody committed to anything in this one — nothing to track.");
    }
  } catch (e: any) {
    say("items", "Track the action items", false,
        `Couldn't save the action items: ${e?.message || e}`);
  }

  // The email carries the notes and a link — never the file. A recording is
  // tens of megabytes and mail servers reject it.
  const watch = await sb.storage.from("recordings").createSignedUrl(videoPath, 60 * 60 * 24 * 7);
  const link = watch.data?.signedUrl || "";
  let emailed: string | false = false;
  try {
    const ok = await email(
      user.email || "",
      notesSubject(notes, room),
      notesHtml(notes, {
        room,
        watchUrl: link,
        appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "",
        when: new Date().toLocaleDateString("en-US", {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
        }),
      })
    );
    emailed = ok ? user.email || "" : false;
    if (ok) {
      say("email", "Email you the notes and a link", true, `Sent to ${user.email}.`);
    } else {
      // "It didn't send" is not an answer. Find out which kind of not-sending
      // this was, and say that instead.
      const why = await checkEmail();
      say("email", "Email you the notes and a link", false,
          why.ok
            ? "Resend accepted the key but refused this message. The most common cause is a From address on a domain Resend hasn't verified."
            : why.detail);
    }
  } catch (e: any) {
    emailed = false;
    say("email", "Email you the notes and a link", false,
        `The email step stopped with an error: ${e?.message || e}. Your notes are still on the host page.`);
  }

  // Re-save the sidecar now that every step has reported. The notes outlive
  // this response; so must the explanation of what did and didn't happen.
  try {
    await sb.storage
      .from("recordings")
      .upload(summaryPath, new Blob([JSON.stringify({ ...payload, steps, health: headline(steps) })],
        { type: "application/json" }),
        { contentType: "application/json", upsert: true });
  } catch {
    /* the notes are already saved; this is the annotation */
  }

  return Response.json({
    ok: true,
    title: notes.title,
    summary: notes.overview,
    actions: notes.actions.length,
    decisions: notes.decisions.length,
    topics: notes.topics.length,
    hasTranscript: Boolean(notes.transcript),
    emailed,
    steps,
    health: headline(steps),
  });
}
