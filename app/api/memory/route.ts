// Memory package from Memory-mode sessions — oral historian / podcast producer.
//
// Mirrors /api/prd: stitch project recordings (preferring sessionMode memory),
// call a model, store under user/memory/{slug}.memory.json. Does NOT force
// PRD schema.

import { createClient } from "@supabase/supabase-js";
import { chooseModel, modelLikelyVision } from "@/lib/model";
import { extractJson, stitchTranscripts, type MeetingSource } from "@/lib/prd";
import {
  acceptMemoryIntent, memoryPath, memoryFilename, memorySystemPrompt,
  memoryUserPrompt, normalizeMemoryPackage, fallbackMemoryPackage,
  acceptSessionMode, type MemoryIntent,
} from "@/lib/memory";
import { describeWorkflow, toMermaid, whiteboardNotes, type Workflow } from "@/lib/workflow";
import {
  myRooms, roomsForProject, resolveProject, roomFromPath, mayReadRecording, type MeetingRow,
} from "@/lib/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_MEETINGS = 25;
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
  if (!project) {
    return Response.json({ error: "Which project? Tag your meetings with a project name and try again." }, { status: 400 });
  }
  const intent: MemoryIntent = acceptMemoryIntent(body?.intent);

  let meetings: MeetingRow[] = [];
  try {
    const q = await sb
      .from("meetings")
      .select("room_name, title, project, created_by, started_at")
      .eq("created_by", user.id)
      .limit(500);
    meetings = (q.data as MeetingRow[]) || [];
  } catch { /* project column may not exist yet */ }

  const hosted = myRooms(meetings, user.id);
  const wanted = roomsForProject(meetings, user.id, project);

  const roots = await listAll(sb, "", 500);
  const others = roots.filter((f: any) => !f?.id && f?.name && f.name !== user.id).map((f: any) => f.name);
  const owners = [user.id, ...others.slice(0, MAX_OWNERS)];

  const paths: string[] = [];
  for (const owner of owners) {
    const rooms = await listAll(sb, owner, 1000);
    for (const r of rooms) {
      if (r?.id) continue;
      if (owner !== user.id && !wanted.some((w) => w === r.name)) continue;
      const files = await listAll(sb, `${owner}/${r.name}`, 1000);
      for (const x of files) {
        if (/\.summary\.json$/i.test(x?.name || "")) {
          const p = `${owner}/${r.name}/${x.name}`;
          if (mayReadRecording(p, hosted, user.id)) paths.push(p);
        }
      }
    }
  }
  paths.sort((a, b) => (a.split("/").pop() || "").localeCompare(b.split("/").pop() || ""));

  type Row = MeetingSource & {
    path: string;
    project: string;
    sessionMode: string;
    boardSnapshotPath?: string | null;
    workflow?: Workflow | null;
    strokes?: any[] | null;
  };
  const all: Row[] = [];
  for (const p of paths) {
    try {
      const { data } = await sb.storage.from("recordings").download(p);
      if (!data) continue;
      const j: any = JSON.parse(await data.text());
      const resolved = resolveProject(j?.project, roomFromPath(p) || String(j?.room || ""), meetings);
      const transcript = String(j?.transcript || "").trim();
      if (!transcript) continue;
      all.push({
        path: p,
        project: resolved.project,
        title: String(j?.meetingTitle || j?.title || j?.room || "").trim(),
        room: String(j?.room || roomFromPath(p) || "").trim(),
        at: String(j?.at || j?.createdAt || "").trim() || p.split("/").pop()?.slice(0, 10) || "",
        transcript,
        sessionMode: acceptSessionMode(j?.sessionMode),
        boardSnapshotPath: typeof j?.boardSnapshotPath === "string" ? j.boardSnapshotPath : null,
        workflow: (j?.workflow && typeof j.workflow === "object") ? (j.workflow as Workflow) : null,
        strokes: Array.isArray(j?.strokes) ? j.strokes : null,
      });
    } catch { /* one bad sidecar must not cost the project */ }
  }

  const forProject = all.filter((m) => norm(m.project) === norm(project));
  const memoryOnly = forProject.filter((m) => m.sessionMode === "memory");
  const pool = memoryOnly.length ? memoryOnly : forProject;

  if (!pool.length) {
    const hostedTagged = wanted.length;
    return Response.json({
      error: hostedTagged
        ? `You host ${hostedTagged} meeting(s) tagged "${project}", but none have a saved transcript yet — run a Memory-mode session with captions, End, then build again.`
        : "No recordings for that project yet. Host a Memory-mode session, tag the project, record with captions, then End.",
    }, { status: 404 });
  }

  const newest = pool.slice(-MAX_MEETINGS);
  const droppedForCount = Math.max(0, pool.length - newest.length);
  const stitched = stitchTranscripts(newest);

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      ...fallbackMemoryPackage(
        "Building a Memory package needs a model key. Set OPENROUTER_API_KEY in Vercel → Settings → Environment Variables and redeploy — your recordings are already saved.",
        intent
      ),
      project,
      meetings_used: stitched.used,
      meetings_dropped: stitched.dropped + droppedForCount,
      memory_sessions_used: memoryOnly.length,
      filename: memoryFilename(project),
      sessionMode: "memory",
    });
  }

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const chosen = await chooseModel({ openrouter, key: apiKey });

  let drawn: Workflow | null = null;
  let boardStrokeNotes = "";
  let visionUsed = false;
  let visionNote = "";
  const boardTextParts: string[] = [];

  for (const m of newest) {
    if (m.workflow && !drawn) {
      try {
        drawn = m.workflow as Workflow;
        boardTextParts.push(describeWorkflow(drawn));
      } catch { /* ignore */ }
    }
    if (m.strokes?.length && !boardStrokeNotes) {
      try {
        boardStrokeNotes = whiteboardNotes(m.strokes as any);
        if (boardStrokeNotes) boardTextParts.push(boardStrokeNotes);
      } catch { /* ignore */ }
    }
  }

  let userContent: any = memoryUserPrompt(
    stitched.text,
    intent,
    boardTextParts.length ? boardTextParts.join("\n\n") : undefined
  );

  const snapPath = newest.map((m) => m.boardSnapshotPath).find(Boolean);
  if (snapPath && modelLikelyVision(chosen.id)) {
    try {
      const { data } = await sb.storage.from("recordings").download(String(snapPath));
      if (data) {
        const buf = Buffer.from(await data.arrayBuffer());
        const b64 = buf.toString("base64");
        userContent = [
          { type: "text", text: typeof userContent === "string" ? userContent : String(userContent) },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ];
        visionUsed = true;
        visionNote = "Whiteboard snapshot sent to a vision-capable model.";
      }
    } catch {
      visionNote = "Board snapshot could not be loaded — used transcript only.";
    }
  } else if (snapPath && !modelLikelyVision(chosen.id)) {
    visionNote = `Board snapshot saved but model ${chosen.id} is not treated as vision-capable — used stroke/workflow text only.`;
  }

  let report = fallbackMemoryPackage("The model did not return a package.", intent);
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen.id,
        temperature: 0.35,
        max_tokens: 6000,
        messages: [
          { role: "system", content: memorySystemPrompt(intent) },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      report = fallbackMemoryPackage(`The model answered ${r.status}. ${detail.slice(0, 200)}`, intent);
    } else {
      const j: any = await r.json();
      const parsed = extractJson(String(j?.choices?.[0]?.message?.content || ""));
      report = parsed
        ? normalizeMemoryPackage(parsed, intent, chosen.id)
        : fallbackMemoryPackage("The model's reply couldn't be read as a Memory package.", intent);
    }
  } catch (e: any) {
    report = fallbackMemoryPackage(`Couldn't reach the model: ${e?.message || String(e)}`, intent);
  }

  let markdown = report.markdown;
  if (drawn) {
    markdown += `\n\n---\n\n## Board notes (from the room)\n\n\`\`\`mermaid\n${toMermaid(drawn, project)}\n\`\`\`\n`;
  } else if (boardStrokeNotes) {
    markdown += `\n\n---\n\n## Whiteboard notes\n\n${boardStrokeNotes}\n`;
  }

  const modeNote = memoryOnly.length
    ? ""
    : "No session was tagged Memory yet — built from this project's recordings anyway. Toggle Memory next time for a cleaner cut.";

  const out = {
    ...report,
    markdown,
    project,
    intent,
    sessionMode: "memory" as const,
    meetings: newest.map((m) => ({
      title: m.title, at: m.at, room: m.room, path: m.path, sessionMode: m.sessionMode,
    })),
    meetings_used: stitched.used,
    meetings_dropped: stitched.dropped + droppedForCount,
    memory_sessions_used: memoryOnly.length,
    filename: memoryFilename(project),
    board_vision: visionUsed,
    model_note: [chosen.exact ? "" : chosen.why, visionNote, modeNote].filter(Boolean).join(" "),
    at: new Date().toISOString(),
  };

  try {
    await sb.storage.from("recordings").upload(
      memoryPath(user.id, project),
      new Blob([JSON.stringify(out)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
  } catch { /* cache is convenience */ }

  return Response.json(out);
}

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
    const { data } = await sb.storage.from("recordings").download(memoryPath(user.id, project));
    if (!data) return Response.json({ error: "No Memory package yet for that project." }, { status: 404 });
    return Response.json(JSON.parse(await data.text()));
  } catch {
    return Response.json({ error: "No Memory package yet for that project." }, { status: 404 });
  }
}
