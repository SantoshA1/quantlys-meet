import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs"; // livekit-server-sdk needs Node, not Edge

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN; // e.g. "team.com"

async function getUser(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  );
  const { data } = await supabase.auth.getUser(); // verifies the signed session server-side
  return data.user;
}

export async function POST(req: NextRequest) {
  const { room, name, guest } = await req.json();

  if (!room || !name) {
    return NextResponse.json({ error: "room and name are required" }, { status: 400 });
  }

  const displayName = String(name).slice(0, 60);
  let identity: string;
  let isGuest = false;

  const user = await getUser(req);

  if (user) {
    // Signed-in teammate — enforce the domain allowlist if configured.
    const domain = user.email?.split("@")[1];
    if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN) {
      return NextResponse.json(
        { error: `This app is for @${ALLOWED_DOMAIN} accounts only` },
        { status: 403 }
      );
    }
    // Stable identity per user so per-track recording maps to a known person.
    identity = user.id;
  } else if (guest === true && process.env.ALLOW_GUEST_JOIN === "true") {
    // Test-week guest path — no login, typed name only. Flag-gated so it can't
    // leak into normal operation once you turn it off.
    identity = `guest-${crypto.randomUUID()}`;
    isGuest = true;
  } else {
    // Not signed in AND guest join is off → no token is issued here.
    // (In the full app this returns 202 + an admissionId so the host can admit
    //  the straggler from inside the room. Bare-minimum version rejects.)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity, name: displayName, ttl: "3h" }
  );

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // needed for the record-badge broadcast + host controls
  });

  return NextResponse.json({ token: await at.toJwt(), isGuest });
}
