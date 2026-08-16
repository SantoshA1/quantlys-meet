// Token minting for the full room. Self-contained on purpose: it reads the
// LiveKit values straight from the environment and does not depend on any
// other route, so the existing room keeps working exactly as it does today.

import { AccessToken } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

function livekitUrl(): string {
  return (
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    process.env.LIVEKIT_URL ||
    process.env.LIVEKIT_WS_URL ||
    ""
  );
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const room = String(body.room || "").trim();
  const name = String(body.name || "").trim() || "Guest";
  if (!room) {
    return Response.json({ error: "A room name is required." }, { status: 400 });
  }

  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = livekitUrl();
  if (!key || !secret || !url) {
    return Response.json(
      { error: "This app's LiveKit settings are missing — connect LiveKit and relaunch." },
      { status: 503 }
    );
  }

  const identity = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const at = new AccessToken(key, secret, { identity, name, ttl: "4h" });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return Response.json({ token: await at.toJwt(), url });
}
