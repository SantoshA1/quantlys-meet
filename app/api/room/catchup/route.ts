// "What did I miss?" — a private recap of the last ~5 minutes of captions.
// Gated on the LiveKit room token (anyone in the room may ask, nobody outside
// may) and on the shared rate limiter. The answer goes back only to the caller.

import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { chooseModel } from "@/lib/model";
import { requireRoomToken } from "@/lib/room-auth";
import { catchupPrompt, parseCatchup, fallbackCatchup, CATCHUP_MAX_CHARS } from "@/lib/catchup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = await rateLimit(req, "catchup", LIMITS.llm);
  if (limited) return limited;
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const room = String(body?.room || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });
  const denied = await requireRoomToken(req, room);
  if (denied) return denied;

  const recent = String(body?.recent || "").slice(-CATCHUP_MAX_CHARS).trim();
  const project = String(body?.project || "").slice(0, 120).trim();
  const memory = body?.sessionMode === "memory";
  if (!recent) {
    return Response.json({ ...fallbackCatchup(""), empty: true });
  }

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ ...fallbackCatchup(recent), model_note: "No model key is set." });

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  try {
    const chosen = await chooseModel({ openrouter, key: apiKey, wanted: process.env.CATCHUP_MODEL || process.env.NOTES_MODEL || "" });
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen.id,
        temperature: 0.2,
        max_tokens: 600,
        messages: [{ role: "user", content: catchupPrompt(recent, { project, memory }) }],
      }),
    });
    if (!r.ok) return Response.json({ ...fallbackCatchup(recent), model_note: `The model answered ${r.status}.` });
    const j: any = await r.json();
    const parsed = parseCatchup(String(j?.choices?.[0]?.message?.content || ""));
    if (!parsed) return Response.json({ ...fallbackCatchup(recent), model_note: "The model's answer couldn't be read." });
    return Response.json({ ...parsed, model: chosen.id });
  } catch (e: any) {
    return Response.json({ ...fallbackCatchup(recent), model_note: `Couldn't reach the model (${e?.message || e}).` });
  }
}
