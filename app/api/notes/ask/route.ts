// Ask the meeting a question.
//
// FIELD 2026-08-17: "AI intelligence is needed for users to adopt."
//
// Notes answer the questions we thought to ask. The question somebody actually
// has is narrower and arrives three weeks later — "what did we decide about
// the billing provider?", "did anyone commit to a date?", "who said the margin
// number was wrong?" — and until now the only way to answer it was to play a
// fifty-minute recording and hope.
//
// The design rule that makes this worth trusting: it answers from the
// transcript ONLY, and every answer carries the moments it came from. An
// answer with a timestamp can be checked in ten seconds. An answer without one
// is a claim about a meeting you now have to re-listen to anyway — which is
// the exact problem it was supposed to remove.

import { createClient } from "@supabase/supabase-js";
import { askPrompt, parseAnswer, timedTranscript } from "@/lib/notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }

  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }

  const question = String(body?.question || "").trim();
  const summaryPath = String(body?.summaryPath || "").trim();
  if (!question) return Response.json({ error: "Ask something first." }, { status: 400 });
  if (question.length > 500) {
    return Response.json({ error: "That's a long question — try it in a sentence or two." }, { status: 400 });
  }
  if (!summaryPath) return Response.json({ error: "Which meeting?" }, { status: 400 });

  // Ownership, the same way every other route in this app does it: the path
  // must live under this person's own prefix. Never an id from the request.
  if (!summaryPath.startsWith(`${user.id}/`) || !summaryPath.endsWith(".summary.json")) {
    return Response.json({ error: "Those notes aren't yours." }, { status: 403 });
  }

  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json(
      {
        error:
          "Asking questions needs a model key. Set OPENROUTER_API_KEY in Vercel → Settings → Environment Variables and redeploy — the transcript and notes are already saved either way.",
      },
      { status: 503 }
    );
  }

  let payload: any;
  try {
    const { data, error } = await sb.storage.from("recordings").download(summaryPath);
    if (error || !data) {
      return Response.json({ error: "Couldn't open those notes." }, { status: 404 });
    }
    payload = JSON.parse(await data.text());
  } catch {
    return Response.json({ error: "Those notes couldn't be read." }, { status: 502 });
  }

  // Prefer the timed utterances — a citation is only useful if it points at a
  // second. Fall back to the flat transcript, in which case the answer is
  // still grounded but can't be scrubbed to.
  const people: string[] = Array.isArray(payload?.people) ? payload.people : [];
  const timed = Array.isArray(payload?.utterances) && payload.utterances.length
    ? timedTranscript(payload.utterances, people)
    : String(payload?.transcript || "");
  if (!timed.trim()) {
    return Response.json({
      answer: "There's no transcript for this recording, so there's nothing to search.",
      cites: [],
      grounded: false,
    });
  }

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = openrouter
    ? process.env.NOTES_MODEL || "anthropic/claude-3.5-sonnet"
    : process.env.NOTES_MODEL || "gpt-4o-mini";

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,          // this is retrieval, not writing
        max_tokens: 900,
        messages: [{ role: "user", content: askPrompt(question, timed, people) }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return Response.json(
        { error: `The model answered ${r.status}. ${detail.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const j: any = await r.json();
    const out = parseAnswer(String(j?.choices?.[0]?.message?.content || ""));
    return Response.json(out);
  } catch (e: any) {
    return Response.json(
      { error: `Couldn't reach the model: ${e?.message || String(e)}` },
      { status: 502 }
    );
  }
}
