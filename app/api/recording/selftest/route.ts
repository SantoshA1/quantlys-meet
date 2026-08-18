// "Will my next meeting actually produce notes in my inbox?" — answered
// BEFORE the meeting, in about two seconds, instead of discovered afterwards
// by an email that never arrives.
//
// This is the cheapest possible version of the lesson that keeps costing the
// most: a feature that depends on a key somebody has to paste into a
// dashboard will, sooner or later, be missing that key — and the failure
// arrives hours later, silently, to the one person who can't debug it.

import { checkTranscribe, checkNotes, checkEmail, checkStorage, headline } from "@/lib/notes-health";
import { checkMeeting, checkRecording, dataLeaving, privacyHeadline, hostingKind, realtimeUrl } from "@/lib/hosting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  // Signed-in hosts only: these answers name your provider accounts.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    const who = jwt ? await sb.auth.getUser(jwt) : null;
    if (!who?.data?.user) {
      return Response.json({ error: "Please sign in first." }, { status: 401 });
    }
  }

  const [meeting, recording, transcribe, notes, mail] = await Promise.all([
    checkMeeting(),
    checkRecording(),
    checkTranscribe(),
    checkNotes(),
    checkEmail(),
  ]);
  // Meeting first: if nobody can join, nothing downstream matters.
  const steps = [meeting, recording, checkStorage(), transcribe, notes, mail];

  // PHASE 0, 2026-08-18. Self-hosting the media server stops the video leaving
  // the building. It does not stop the words. Anyone who went to the trouble
  // deserves the list rather than the impression.
  const leaving = dataLeaving();
  const hosting = hostingKind(realtimeUrl());

  return Response.json({
    ok: steps.every((s) => s.ok),
    headline: headline(steps),
    steps,
    hosting,
    privacy: { headline: privacyHeadline(leaving, hosting), leaving },
  });
}
