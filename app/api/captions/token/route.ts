// A key the browser is allowed to hold, for as long as one meeting.
//
// Live captions have to run in the browser — the microphone is there, and a
// round trip through our own server would add latency to the one feature
// people notice latency in. But the browser cannot be given DEEPGRAM_API_KEY:
// that key is in every network tab, it never expires, and it can spend money
// and read every project on the account.
//
// So this route mints a SCOPED, SHORT-LIVED key instead. It can transcribe and
// nothing else, it dies in an hour, and it belongs to the person who asked for
// it. If it leaks, it leaks a key that is already nearly dead.
//
// This is the pattern for every "the browser needs to talk to a paid API"
// problem, and the wrong answer — NEXT_PUBLIC_DEEPGRAM_API_KEY — looks like it
// works right up until somebody reads your JavaScript.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TTL_SECONDS = 3600;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    // Not an error. It means "use the other engine", and the caller is told
    // which one so it can say so on screen rather than silently doing nothing.
    return Response.json(
      {
        engine: "browser",
        reason:
          "No DEEPGRAM_API_KEY is set, so captions fall back to your browser's own speech recogniser.",
      },
      { status: 200 }
    );
  }

  // Anyone in a meeting may caption — including guests, who have no account.
  // What stops this being an open key-vending machine is that the caller must
  // name a meeting that exists and is running. A stranger with the URL and no
  // room code gets nothing.
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const room = String(body?.room || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { data: meeting } = await admin()
        .from("meetings")
        .select("room_name, active")
        .eq("room_name", room)
        .maybeSingle();
      if (!meeting) {
        return Response.json({ error: "No such meeting." }, { status: 404 });
      }
      if ((meeting as any).active === false) {
        return Response.json({ error: "That meeting has ended." }, { status: 409 });
      }
    } catch {
      /* the lookup failing is not a reason to refuse captions to a real room */
    }
  }

  try {
    // Which project the key belongs to — Deepgram scopes keys per project.
    const pr = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    if (!pr.ok) {
      return Response.json(
        {
          engine: "browser",
          reason: `Deepgram rejected the key (${pr.status}), so captions fall back to your browser's own recogniser.`,
        },
        { status: 200 }
      );
    }
    const pj: any = await pr.json();
    const projectId = pj?.projects?.[0]?.project_id;
    if (!projectId) {
      return Response.json(
        { engine: "browser", reason: "That Deepgram key has no project on it." },
        { status: 200 }
      );
    }

    const kr = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: `Quantlys Meeting live captions · ${room}`,
        // Transcription and nothing else. Not member management, not billing,
        // not reading the other keys.
        scopes: ["usage:write"],
        time_to_live_in_seconds: TTL_SECONDS,
      }),
    });
    if (!kr.ok) {
      const detail = await kr.text().catch(() => "");
      return Response.json(
        {
          engine: "browser",
          reason:
            kr.status === 403
              ? "This Deepgram key isn't allowed to create temporary keys (it needs the 'keys:write' scope), so captions fall back to your browser's own recogniser."
              : `Deepgram wouldn't issue a caption key (${kr.status}). ${detail.slice(0, 160)}`,
        },
        { status: 200 }
      );
    }
    const kj: any = await kr.json();
    if (!kj?.key) {
      return Response.json({ engine: "browser", reason: "Deepgram returned no key." }, { status: 200 });
    }
    return Response.json({
      engine: "deepgram",
      token: kj.key,
      expiresIn: TTL_SECONDS,
    });
  } catch (e: any) {
    return Response.json(
      {
        engine: "browser",
        reason: `Couldn't reach Deepgram (${e?.message || e}), so captions fall back to your browser's own recogniser.`,
      },
      { status: 200 }
    );
  }
}
