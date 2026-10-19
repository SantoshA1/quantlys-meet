// Live captions through our server: one short utterance in, its text out.
//
// Used when DEEPGRAM_API_KEY can't mint a browser key (no `keys:write`, no
// /v1/auth/grant). The key never leaves the server. Same gate as the other
// in-room routes: the caller must hold the LiveKit token for this room, and
// it fails closed when rooms aren't configured. Rate limited per caller, size
// capped, audio types only, and the only client input that reaches Deepgram's
// query string is the re-sanitised glossary.

import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { requireRoomToken } from "@/lib/room-auth";
import { sanitizeGlossary, MAX_GLOSSARY_TERMS, MAX_NAMES } from "@/lib/keyterms";
import { relayQuery, relayContentType, relayText, RELAY_MAX_BYTES, RELAY_MIN_BYTES } from "@/lib/caption-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const limited = await rateLimit(req, "captions-relay", LIMITS.relay);
  if (limited) return limited;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ error: "Captions relay is not configured." }, { status: 503 });

  const url = new URL(req.url);
  const room = String(url.searchParams.get("room") || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });
  const denied = await requireRoomToken(req, room);
  if (denied) return denied;

  const type = relayContentType(req.headers.get("content-type"));
  if (!type) return Response.json({ error: "Send audio." }, { status: 415 });
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > RELAY_MAX_BYTES) return Response.json({ error: "Too long for one caption." }, { status: 413 });

  let audio: ArrayBuffer;
  try {
    audio = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Couldn't read the audio." }, { status: 400 });
  }
  if (audio.byteLength > RELAY_MAX_BYTES) return Response.json({ error: "Too long for one caption." }, { status: 413 });
  if (audio.byteLength < RELAY_MIN_BYTES) return Response.json({ text: "" });

  const terms = sanitizeGlossary(
    String(url.searchParams.get("terms") || "").slice(0, 4000).split(","),
    MAX_GLOSSARY_TERMS + MAX_NAMES
  );

  try {
    const r = await fetch(`https://api.deepgram.com/v1/listen?${relayQuery(terms)}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": type },
      body: audio,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      return Response.json({ error: `Deepgram couldn't transcribe that (${r.status}).` }, { status: 502 });
    }
    return Response.json({ text: relayText(await r.json()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Couldn't reach Deepgram." }, { status: 502 });
  }
}
