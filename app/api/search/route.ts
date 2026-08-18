// Search across every meeting this person has ever recorded.
//
// FIELD 2026-08-18: Ask answered questions about ONE recording, which means
// you had to already know which meeting held the answer before you could ask
// for it. The question people actually have — "what did we decide about the
// billing provider?" — does not come with that.
//
// Two stages, and the order is the whole design:
//
//   1. RANK, here, in code. BM25 over every passage the person owns. No
//      network, no key, no cost, milliseconds. See lib/search.ts.
//   2. READ, optionally. The model sees only the passages that already won,
//      and its job is narrow: turn evidence into a sentence with citations.
//
// Which means search still works with no model key at all — ranked, quoted,
// timestamped results are useful on their own. And the cost of a search does
// not grow with the size of the archive, so the feature gets better the longer
// you use the product instead of more expensive.
//
// Ownership is structural: this route never accepts a path. It lists what is
// under this user's own prefix and searches that. There is no id in the
// request body that could point somewhere else.

import { createClient } from "@supabase/supabase-js";
import { parseQuery, isEmptyQuery, toDoc, rank, searchPrompt, parseSearchAnswer, type MeetingDoc } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SUMMARY = /\.summary\.json$/i;
const VIDEO = /\.(mp4|webm)$/i;
const AUDIO = /\.(m4a|audio\.webm)$/i;

/** How many meetings one search will read. Not a secret: when it bites, the
 *  response says so. A search that quietly read 60 of your 200 meetings and
 *  reported "nothing found" is not a search — it is the app telling you
 *  something untrue in a confident voice. */
const MAX_MEETINGS = 120;
const FETCH_WIDTH = 8;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function stem(name: string) {
  return name.replace(SUMMARY, "").replace(AUDIO, "").replace(VIDEO, "");
}

type Found = { id: string; room: string; when: string; videoPath?: string; audioPath?: string };

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
  try { body = await req.json(); } catch { body = {}; }
  const raw = String(body?.q || "").trim();
  if (!raw) return Response.json({ error: "Type something to search for." }, { status: 400 });
  if (raw.length > 300) {
    return Response.json({ error: "That's a long search — try a few words." }, { status: 400 });
  }
  const q = parseQuery(raw);
  if (isEmptyQuery(q)) {
    return Response.json(
      { error: `"${raw}" is all common words — try a name, a product, a number, or "an exact phrase".` },
      { status: 400 }
    );
  }
  const wantAnswer = body?.answer !== false;

  // ---- find every meeting that belongs to this person ----------------------
  const found: Found[] = [];
  let listError = "";
  try {
    const rooms = await sb.storage.from("recordings").list(user.id, { limit: 1000 });
    if (rooms.error) throw new Error(rooms.error.message);
    const folders = (rooms.data || []).filter((f: any) => !f.id).map((f: any) => f.name);
    for (let i = 0; i < folders.length; i += FETCH_WIDTH) {
      const batch = folders.slice(i, i + FETCH_WIDTH);
      const lists = await Promise.all(
        batch.map((name) => sb.storage.from("recordings").list(`${user.id}/${name}`, { limit: 500 }))
      );
      lists.forEach((res, k) => {
        const room = batch[k];
        const by = new Map<string, Found>();
        for (const f of res.data || []) {
          const key = stem(f.name);
          const rec: Found = by.get(key) || { id: "", room, when: key };
          const full = `${user.id}/${room}/${f.name}`;
          if (SUMMARY.test(f.name)) rec.id = full;
          else if (AUDIO.test(f.name)) rec.audioPath = full;
          else if (VIDEO.test(f.name)) rec.videoPath = full;
          by.set(key, rec);
        }
        by.forEach((rec) => rec.id && found.push(rec));
      });
    }
  } catch (e: any) {
    listError = e?.message || String(e);
  }
  if (listError && !found.length) {
    return Response.json({ error: `Couldn't read your meetings: ${listError}` }, { status: 502 });
  }

  // Newest first, so if the cap bites it keeps what you are most likely to
  // want — and then says out loud that it bit.
  found.sort((a, b) => (a.when < b.when ? 1 : -1));
  const total = found.length;
  const take = found.slice(0, MAX_MEETINGS);

  // ---- read them --------------------------------------------------------
  const docs: MeetingDoc[] = [];
  let unreadable = 0;
  for (let i = 0; i < take.length; i += FETCH_WIDTH) {
    const batch = take.slice(i, i + FETCH_WIDTH);
    const blobs = await Promise.all(
      batch.map((m) =>
        sb.storage.from("recordings").download(m.id).then(
          (r) => (r.error || !r.data ? null : r.data.text()),
          () => null
        )
      )
    );
    blobs.forEach((text, k) => {
      if (!text) { unreadable++; return; }
      try {
        docs.push(toDoc(JSON.parse(text), batch[k]));
      } catch { unreadable++; }
    });
  }

  const result = rank(q, docs, { perMeeting: 4, meetings: 20 });

  // Every way this answer could be less than complete, said plainly.
  const notes: string[] = [];
  if (total > take.length) {
    notes.push(`You have ${total} meetings and this searched the ${take.length} most recent.`);
  }
  if (unreadable) {
    notes.push(`${unreadable} meeting${unreadable === 1 ? "" : "s"} had no readable notes file and couldn't be searched.`);
  }
  if (listError) notes.push(`Part of your storage didn't respond: ${listError}`);
  if (result.truncated) notes.push(result.truncated);

  const out: any = {
    q: raw,
    hits: result.hits,
    scanned: result.scanned,
    matched: result.matched,
    suggestion: result.suggestion,
    note: notes.join(" "),
    answer: null,
    answerNote: "",
  };

  if (!wantAnswer || !result.hits.length) return Response.json(out);

  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    // The ranked results are already on their way. Say what the missing key
    // costs — a sentence, not the search — rather than failing the request.
    out.answerNote =
      "The moments below came straight from your meetings. Writing them up into an answer needs a model key (OPENROUTER_API_KEY in Vercel → Settings → Environment Variables).";
    return Response.json(out);
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
        temperature: 0,       // retrieval, not writing
        max_tokens: 900,
        messages: [{ role: "user", content: searchPrompt(raw, result.hits) }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      out.answerNote = `The model answered ${r.status}, so there's no written answer — the moments below are still your meetings' own words. ${detail.slice(0, 160)}`;
      return Response.json(out);
    }
    const j: any = await r.json();
    out.answer = parseSearchAnswer(
      String(j?.choices?.[0]?.message?.content || ""),
      new Set(result.hits.map((h) => h.id))
    );
  } catch (e: any) {
    out.answerNote = `Couldn't reach the model (${e?.message || e}), so there's no written answer. The moments below are still real.`;
  }
  return Response.json(out);
}
