// Proof of membership in a live room: the LiveKit JWT the tab joined with.
// Same check as /api/captions/token (audit 2026-10-12), shared.

import { TokenVerifier } from "livekit-server-sdk";

export async function requireRoomToken(req: Request, room: string): Promise<Response | null> {
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;
  if (!lkKey || !lkSecret) return Response.json({ error: "Rooms are not configured." }, { status: 503 });
  const jwt = (req.headers.get("x-room-token") || req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return Response.json({ error: "Join the meeting first." }, { status: 401 });
  try {
    const claims: any = await new TokenVerifier(lkKey, lkSecret).verify(jwt);
    if (claims?.video?.room !== room || !claims?.video?.roomJoin) {
      return Response.json({ error: "That token is for a different meeting." }, { status: 403 });
    }
  } catch {
    return Response.json({ error: "Join the meeting first." }, { status: 401 });
  }
  return null;
}
