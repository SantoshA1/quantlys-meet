// What the team says the project IS, and what they have decided since.
//
// FIELD 2026-08-25: "How do users enter the project goals so readiness has a
// context and asks the right follow-up questions?"
//
// They could not. The only thing anybody typed about a project was its name.
// This is the two places they now can:
//
//   · the BRIEF — two or three sentences of "what are we building, and why",
//     written once. It sharpens which rubric applies (a project called
//     "Apollo" is a `build` by DEFAULT, not by evidence; "Apollo, a game where
//     you dodge waves" is a `game` by evidence), it gives the assessment a
//     stated intent to weigh the transcripts against, and it is the whole
//     difference between a first meeting's questions being about their product
//     and being about a checklist.
//
//   · DECISIONS — an open question answered in the host console between
//     meetings, instead of waiting for the next one. The PRD closes on the
//     days nobody is in a room together.
//
// Deliberately a SEPARATE file from the assessment. `<slug>.prd.json` is
// regenerated every time somebody presses Build; the sentences a person wrote
// must never be wiped by a rebuild.

import { createClient } from "@supabase/supabase-js";
import {
  acceptBrief, acceptDecision, mergeDecisions, projectPath, type ProjectContext,
} from "@/lib/prd";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function gate(req: Request, project: string): Promise<{ err?: Response; sb?: any; user?: any }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { err: Response.json({ error: "Server storage is not configured." }, { status: 503 }) };
  }
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return { err: Response.json({ error: "Please sign in." }, { status: 401 }) };
  if (!project) return { err: Response.json({ error: "Which project?" }, { status: 400 }) };
  return { sb, user };
}

/** Shared with /api/prd and /api/agent/question — one reader, so the three of
 *  them can never disagree about what a project's context is. */
export async function readContext(sb: any, userId: string, project: string): Promise<ProjectContext> {
  try {
    const { data } = await sb.storage.from("recordings").download(projectPath(userId, project));
    if (!data) return { brief: "", decisions: [] };
    const j: any = JSON.parse(await data.text());
    return {
      brief: String(j?.brief || ""),
      decisions: Array.isArray(j?.decisions) ? j.decisions : [],
    };
  } catch {
    // No file is the normal state of a new project, not an error.
    return { brief: "", decisions: [] };
  }
}

async function writeContext(sb: any, userId: string, project: string, ctx: ProjectContext) {
  await sb.storage.from("recordings").upload(
    projectPath(userId, project),
    new Blob([JSON.stringify({ ...ctx, project, updatedAt: new Date().toISOString() })], { type: "application/json" }),
    { upsert: true, contentType: "application/json" }
  );
}

export async function GET(req: Request) {
  const project = String(new URL(req.url).searchParams.get("project") || "").trim();
  const g = await gate(req, project);
  if (g.err) return g.err;
  const ctx = await readContext(g.sb, g.user.id, project);
  return Response.json({ project, ...ctx });
}

export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }
  const project = String(body?.project || "").trim();
  const g = await gate(req, project);
  if (g.err) return g.err;
  const sb = g.sb, user = g.user;

  const action = String(body?.action || "").trim();
  const ctx = await readContext(sb, user.id, project);

  if (action === "brief") {
    const v = acceptBrief(String(body?.brief || ""));
    if (!v.ok) return Response.json({ error: v.why }, { status: 400 });
    const next: ProjectContext = { ...ctx, brief: v.value };
    try { await writeContext(sb, user.id, project, next); }
    catch (e: any) { return Response.json({ error: `Couldn't save that: ${e?.message || String(e)}` }, { status: 502 }); }
    return Response.json({ project, ...next, saved: true });
  }

  if (action === "decision") {
    const v = acceptDecision({
      key: body?.key, question: body?.question, answer: body?.answer,
      at: new Date().toISOString(),
    });
    if (!v.ok || !v.value) return Response.json({ error: v.why }, { status: 400 });
    const next: ProjectContext = { ...ctx, decisions: mergeDecisions(ctx.decisions, v.value) };
    try { await writeContext(sb, user.id, project, next); }
    catch (e: any) { return Response.json({ error: `Couldn't save that: ${e?.message || String(e)}` }, { status: 502 }); }
    return Response.json({ project, ...next, saved: true });
  }

  return Response.json({ error: "Say what to save: a brief, or an answer to a question." }, { status: 400 });
}
