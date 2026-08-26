// The PRD a project's meetings were already carrying.
//
// FIELD 2026-08-24: "Quantlys Meeting should have capability to produce PRD
// from the recordings by project."
//
// A project is not one meeting. The problem gets named in the first call, the
// users argued about in the second, and the thing that finally settles the
// scope is said forty minutes into the third by somebody who joined late. So
// this reads EVERY recorded meeting tagged with the project, oldest first,
// and assesses them together against the same rubric Quantlys Conclave uses
// to decide whether something is build-ready.
//
// The output is deliberately Conclave's own state shape — see lib/prd.ts for
// what that is and, more importantly, for the honest note about what cannot
// be automated: Conclave has no endpoint that accepts a PRD, so the handoff
// is a paste, and the app says so rather than pretending.

import { createClient } from "@supabase/supabase-js";
import { chooseModel } from "@/lib/model";
import {
  detectModeFor, rubricFor, metaFor, prdPrompt, prdSystemPrompt, extractJson,
  normalizeReport, fallbackReport, stitchTranscripts, handoffPlan, prdMarkdown,
  prdFilename, prdPath, answeredKeys, type MeetingSource,
} from "@/lib/prd";
import { readContext } from "../project/route";
import { describeWorkflow, toMermaid, type Workflow } from "@/lib/workflow";
import {
  myRooms, roomsForProject, resolveProject, roomFromPath, mayReadRecording, type MeetingRow,
} from "@/lib/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** A project with more meetings than this is read newest-first and the oldest
 *  are left out — and the count is RETURNED, because a PRD quietly built from
 *  half a project is worse than one that says which half. */
const MAX_MEETINGS = 25;

/** How many other people's recording folders to look inside. Only rooms this
 *  person hosts are ever opened, so this is a bound on the LISTING, not on
 *  what may be read. Generous enough for a real team. */
const MAX_OWNERS = 40;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function listAll(sb: any, prefix: string, cap: number) {
  const out: any[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const r = await sb.storage.from("recordings").list(prefix, { limit: 100, offset });
    if (r.error) return out;
    const page = r.data ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

const norm = (s: any) => String(s || "").trim().toLowerCase();

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
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }

  const project = String(body?.project || "").trim();
  const given: string[] = Array.isArray(body?.summaryPaths) ? body.summaryPaths.map(String) : [];
  if (!project && !given.length) {
    return Response.json({ error: "Which project? Tag your meetings with a project name and try again." }, { status: 400 });
  }

  // ── which meetings ──────────────────────────────────────────────────────
  //
  // FIELD 2026-08-26. This used to list ONLY `${user.id}/`, which is where
  // recordings live for whoever pressed Record. In the field there were five
  // summaries across FOUR owners for the same handful of meetings, so a host
  // building a PRD saw only the ones they personally recorded and silently
  // missed every one a colleague made. A meeting belongs to its HOST; who hit
  // the button is an accident of who was on the call.
  let meetings: MeetingRow[] = [];
  try {
    const q = await sb
      .from("meetings")
      .select("room_name, title, project, created_by, started_at")
      .eq("created_by", user.id)
      .limit(500);
    meetings = (q.data as MeetingRow[]) || [];
  } catch { /* the project column may not exist yet; the file's own tag still works */ }

  const hosted = myRooms(meetings, user.id);
  const wanted = project ? roomsForProject(meetings, user.id, project) : hosted;

  let paths: string[] = [];
  let ownersCapped = false;
  if (given.length) {
    const bad = given.find((p) => !p.endsWith(".summary.json") || !mayReadRecording(p, hosted, user.id));
    if (bad) return Response.json({ error: "Those recordings aren't yours." }, { status: 403 });
    paths = given.slice(0, MAX_MEETINGS * 2);
  } else {
    // Own prefix first, then everybody else's — but ONLY descending into
    // rooms this person hosts. Enumerating the bucket's top level is a
    // service-role read that never leaves the server, and a folder is only
    // opened when the requester owns the meeting inside it.
    const roots = await listAll(sb, "", 500);
    const others = roots.filter((f: any) => !f?.id && f?.name && f.name !== user.id).map((f: any) => f.name);
    if (others.length > MAX_OWNERS) ownersCapped = true;
    const owners = [user.id, ...others.slice(0, MAX_OWNERS)];

    for (const owner of owners) {
      const rooms = await listAll(sb, owner, 1000);
      for (const r of rooms) {
        if (r?.id) continue;                     // a stray file, not a meeting folder
        // Somebody else's folder is only opened for a room we host.
        if (owner !== user.id && !wanted.some((w) => w === r.name)) continue;
        const files = await listAll(sb, `${owner}/${r.name}`, 1000);
        for (const x of files) {
          if (/\.summary\.json$/i.test(x?.name || "")) paths.push(`${owner}/${r.name}/${x.name}`);
        }
      }
    }
    // The stem is an ISO timestamp, so sorting by it puts the oldest meeting
    // first — but only WITHIN a room. Sort by the stem across everything.
    paths.sort((a, b) => (a.split("/").pop() || "").localeCompare(b.split("/").pop() || ""));
  }

  // ── read them ───────────────────────────────────────────────────────────
  const all: Array<MeetingSource & { path: string; project: string; tagFrom?: string; workflow?: Workflow | null }> = [];
  for (const p of paths) {
    try {
      const { data } = await sb.storage.from("recordings").download(p);
      if (!data) continue;
      const j: any = JSON.parse(await data.text());
      // THE FALLBACK THAT RESCUES EVERY OLD RECORDING. Summaries only started
      // carrying `project` on 2026-08-25 12:48 UTC; everything before that has
      // no tag in the file, for ever. But the room is in the path, and the
      // meetings table knows that room's project.
      const resolved = resolveProject(j?.project, roomFromPath(p) || String(j?.room || ""), meetings);
      all.push({
        path: p,
        project: resolved.project,
        tagFrom: resolved.source,
        title: String(j?.title || j?.room || "").trim(),
        room: String(j?.room || "").trim(),
        at: String(j?.at || j?.finishedAt || "").trim() || p.split("/").pop()?.slice(0, 10) || "",
        transcript: String(j?.transcript || "").trim(),
        workflow: (j?.workflow && typeof j.workflow === "object") ? (j.workflow as Workflow) : null,
      });
    } catch { /* one unreadable summary must not cost the whole project */ }
  }

  // When paths were named explicitly, they ARE the selection. Otherwise the
  // project tag is.
  let sources = given.length ? all : all.filter((m) => norm(m.project) === norm(project));

  if (!sources.length) {
    // FIELD 2026-08-26: this said "None of your recordings carry a project tag
    // yet" while the dropdown beside it was offering that very project. Both
    // were reading real data; the message was describing the FILES and the
    // dropdown was describing the MEETINGS. Say which, and say what is
    // actually true.
    const tagged = all.filter((m) => m.project).length;
    const names = Array.from(new Set(all.map((m) => m.project).filter(Boolean)));
    const hostedTagged = wanted.length;
    return Response.json({
      error: hostedTagged
        ? `You host ${hostedTagged} meeting(s) tagged "${project}", but none of them have a saved recording yet — a PRD is built from what was recorded, not from the invite.`
        : tagged
          ? `No recordings found for "${project}". The ones you can see are on: ${names.join(", ")}. Check the spelling of the project name.`
          : all.length
            ? `Found ${all.length} recording(s), but none of them belongs to a project. Put a project name in the Project box when you START a meeting — tagging it afterwards does not reach a recording that is already saved, though older ones are matched by room where the meeting still carries the tag.`
            : "No recordings of your meetings yet. Record one and its PRD builds from there.",
      recordings: all.length,
      hosted_rooms: hosted.length,
      projects_seen: names,
    }, { status: 404 });
  }

  const withText = sources.filter((s) => String(s.transcript || "").trim());
  if (!withText.length) {
    return Response.json({
      error: `Found ${sources.length} meeting${sources.length === 1 ? "" : "s"} for "${project}", but none of them have a transcript — a PRD is built from what was said, so there is nothing to read yet. Captions or a Deepgram key give the recording its words.`,
    }, { status: 422 });
  }

  const newest = withText.slice(-MAX_MEETINGS);
  const droppedForCount = withText.length - newest.length;

  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({
      error: "Building a PRD needs a model key. Set OPENROUTER_API_KEY in Vercel → Settings → Environment Variables and redeploy — your recordings and transcripts are already saved either way.",
    }, { status: 503 });
  }

  // ── which rubric ────────────────────────────────────────────────────────
  // Mode is detected the way Conclave detects it, from the project's own
  // words, so a game project is scored on its core loop and not on its data
  // model. An explicit mode from the caller wins, because a person who has
  // told us what they are building has told us.
  const explicit = String(body?.mode || "").trim();
  const stitched = stitchTranscripts(newest, 120000);
  // The most recent whiteboard that actually contained a flow. Later wins,
  // same as the transcripts — a team that redraws the diagram has changed
  // its mind about the diagram.
  const drawn = [...newest].reverse().find((m: any) => m?.workflow?.found)?.workflow as Workflow | undefined;
  // What the team wrote down about this project — the brief, and any question
  // they answered in the console between meetings. Both are deliberate
  // statements, so both outrank anything inferred from a transcript, and the
  // brief in particular is a far better mode signal than a project NAME: a
  // project called "Apollo" is a `build` by default rather than by evidence.
  const ctx = await readContext(sb, user.id, project);
  const mode = explicit && rubricFor(explicit) !== rubricFor("__none__")
    ? explicit
    : detectModeFor({
        brief: ctx.brief,
        project,
        transcript: `${newest.map((m) => m.title).join(" ")} ${stitched.text}`,
      });
  const dims = rubricFor(mode);
  const meta = metaFor(mode);

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const chosen = await chooseModel({ openrouter, key, wanted: process.env.NOTES_MODEL });

  let report;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen.id,
        temperature: 0,           // this is assessment, not writing
        max_tokens: 8000,         // a real PRD plus eight assessments
        messages: [
          { role: "system", content: prdSystemPrompt(meta.artifact, meta.gate) },
          {
            role: "user",
            content: drawn
              ? `${prdPrompt(stitched.text, dims, meta, ctx)}\n\n---\n\n${describeWorkflow(drawn)}`
              : prdPrompt(stitched.text, dims, meta, ctx),
          },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      // The provider's own words and status, never a mask — a masked error
      // turns a field failure into a guessing game.
      report = fallbackReport(`The model answered ${r.status}. ${detail.slice(0, 200)}`, mode);
    } else {
      const j: any = await r.json();
      const parsed = extractJson(String(j?.choices?.[0]?.message?.content || ""));
      report = parsed?.dimensions
        ? normalizeReport(parsed, mode, chosen.id)
        : fallbackReport("The model's reply couldn't be read as an assessment.", mode);
    }
  } catch (e: any) {
    report = fallbackReport(`Couldn't reach the model: ${e?.message || String(e)}`, mode);
  }

  const out = {
    ...report,
    project,
    // Echoed back so the panel can show what the assessment was actually
    // given, and mark the questions that have already been answered.
    brief: ctx.brief,
    decisions: ctx.decisions,
    answered: answeredKeys(ctx),
    meetings: newest.map((m) => ({ title: m.title, at: m.at, room: m.room, path: m.path })),
    meetings_used: stitched.used,
    meetings_dropped: stitched.dropped + droppedForCount,
    // The diagram travels WITH the document. A PRD that describes a flow in
    // prose while the picture of it sits in a recording nobody opens is a PRD
    // that lost the clearest thing the meeting produced.
    markdown: drawn
      ? `${prdMarkdown(report, project, newest)}\n\n---\n\n## The workflow the team drew\n\n\`\`\`mermaid\n${toMermaid(drawn, project)}\n\`\`\`\n`
      : prdMarkdown(report, project, newest),
    workflow: drawn || null,
    filename: prdFilename(project, report.artifact),
    handoff: handoffPlan(report, project),
    model_note: chosen.exact ? "" : chosen.why,
    at: new Date().toISOString(),
  };

  // Saved so the host console can show it again without paying for it twice,
  // and so the agent in the NEXT meeting knows what is still open.
  try {
    await sb.storage.from("recordings").upload(
      prdPath(user.id, project),
      new Blob([JSON.stringify(out)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
  } catch { /* the assessment is the product; the cache is a convenience */ }

  return Response.json(out);
}

/** Read back the last assessment without paying for a new one. */
export async function GET(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

  const project = String(new URL(req.url).searchParams.get("project") || "").trim();
  if (!project) return Response.json({ error: "Which project?" }, { status: 400 });
  try {
    const { data } = await sb.storage.from("recordings").download(prdPath(user.id, project));
    if (!data) return Response.json({ error: "No PRD yet for that project." }, { status: 404 });
    return Response.json(JSON.parse(await data.text()));
  } catch {
    return Response.json({ error: "No PRD yet for that project." }, { status: 404 });
  }
}
