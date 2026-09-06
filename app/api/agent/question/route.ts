// The agent's one question.
//
// FIELD 2026-08-24: "build an AI agent for asking questions during the
// meeting… so live meetings are prompted with questions based on the project
// — for example Conclave follow-up questions to ensure the PRD is 100%
// complete."
//
// WHERE THE WORK IS SPLIT, and it matters for both cost and trust:
//
//   · WHETHER to ask is decided in the browser, by lib/agent.ts, against the
//     live captions. It is pure, it costs nothing, and it can be argued with
//     in a test. It refuses far more often than it agrees — a warm-up, a
//     minimum gap, a minimum of new speech, a real pause, a cap per meeting
//     and a cap per dimension.
//   · WHAT to ask is decided here, by a model, once — only after that gate
//     has already opened. A 45-minute meeting therefore costs at most eight
//     calls, not one every few seconds.
//
// The model is Sonnet by name, because the task is comprehension under time
// pressure: read four minutes of people talking over each other and produce
// one sentence that lands. AGENT_MODEL overrides it; a provider that does not
// carry it falls through lib/model.ts's ladder rather than failing, and says
// which model it used instead.

import { createClient } from "@supabase/supabase-js";
import { chooseModel } from "@/lib/model";
import { rubricFor, metaFor, detectModeFor, suggestionsFor, prdPath, contextBlock, answeredKeys } from "@/lib/prd";
import { readContext } from "../../project/route";
import { agentQuestionPrompt, parseAgentQuestion, pickDimension, rankOpen, MAX_QUESTIONS, SPEC_MAX_QUESTIONS, SPEC_MAX_PER_DIMENSION, MAX_PER_DIMENSION } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Named, not inferred. The person asked for Sonnet and the reason holds:
 *  this is a comprehension task on messy live speech with a latency budget
 *  measured in seconds. */
const AGENT_MODEL = "anthropic/claude-sonnet-4.5";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let user: any = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && jwt) {
    const who = await admin().auth.getUser(jwt);
    user = who?.data?.user || null;
  }
  // The agent is the HOST's tool — they switch it on, and the questions it
  // asks are attributed to them in front of their team. An open model
  // endpoint in a room anybody can join is a bill anybody can run up.
  if (!user) return Response.json({ error: "Only a signed-in host can turn the agent on." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {
    return Response.json({ error: "Couldn't read that request." }, { status: 400 });
  }

  const project = String(body?.project || "").trim();
  const recent = String(body?.recent || "").trim();
  const spec = Boolean(body?.spec);
  const maxQ = spec ? SPEC_MAX_QUESTIONS : MAX_QUESTIONS;
  const maxPer = spec ? SPEC_MAX_PER_DIMENSION : MAX_PER_DIMENSION;
  const asked: string[] = Array.isArray(body?.asked) ? body.asked.map(String).slice(0, maxQ) : [];
  const askedKeys: string[] = Array.isArray(body?.askedKeys) ? body.askedKeys.map(String).slice(0, 80) : [];

  if (!recent && !spec) {
    return Response.json({ ask: false, reason: "Nothing has been said yet." });
  }

  // What is still open? The saved assessment from this project's previous
  // meetings is the real answer — an agent that starts every meeting from
  // zero asks the questions the team already answered last Tuesday, which is
  // the fastest way to get it switched off. When there is none, everything is
  // open, which is exactly right for a project's first meeting.
  let mode = String(body?.mode || "").trim();
  let open: Array<{ key: string; label: string; status: string }> = Array.isArray(body?.open)
    ? body.open.filter((d: any) => d?.key).map((d: any) => ({ key: String(d.key), label: String(d.label || d.key), status: String(d.status || "missing") }))
    : [];

  // THE FIRST MEETING'S FIX. Without a brief the agent knows a project NAME
  // and nothing else, so its opening questions are the generic ones for each
  // dimension — which is a checklist, not an assistant. Two sentences the team
  // wrote once change every question it asks from here on. Between-meeting
  // decisions (host console) travel the same path via contextBlock, and those
  // keys are excluded from open so the agent never re-asks a settled answer.
  let brief = "";
  let ctxBlock = "";
  let settled: string[] = [];
  if (user && process.env.SUPABASE_SERVICE_ROLE_KEY && project) {
    try {
      const ctx = await readContext(admin(), user.id, project);
      brief = ctx.brief;
      ctxBlock = contextBlock(ctx);
      settled = answeredKeys(ctx);
    } catch { /* a project with no brief is the normal first state */ }
  }

  if (!open.length && user && process.env.SUPABASE_SERVICE_ROLE_KEY && project) {
    try {
      const { data } = await admin().storage.from("recordings").download(prdPath(user.id, project));
      if (data) {
        const saved: any = JSON.parse(await data.text());
        mode = mode || String(saved?.mode || "");
        open = (saved?.dimensions || [])
          .filter((d: any) => d?.status && d.status !== "present")
          .map((d: any) => ({ key: String(d.key), label: String(d.label || d.key), status: String(d.status) }));
      }
    } catch { /* no prior assessment is the normal state of a first meeting */ }
  }

  if (!mode) mode = detectModeFor({ brief, project, transcript: recent });
  const dims = rubricFor(mode);
  const meta = metaFor(mode);
  if (!open.length) {
    open = dims.map((d) => ({ key: d.key, label: d.label, status: "missing" }));
  }
  if (settled.length) {
    const skip = new Set(settled);
    open = open.filter((d) => !skip.has(d.key));
  }

  // Rank by what the room is ALREADY talking about, then take the most
  // blocking one that has not been worn out. A question that follows from the
  // last thing said gets answered; one that arrives from nowhere gets ignored.
  const ranked = rankOpen(open, recent);
  const key = pickDimension(ranked, askedKeys.map((k) => ({ key: k, label: "", question: "", options: [], why: "", at: 0 })), maxPer);
  if (!key) {
    return Response.json({ ask: false, reason: "The open parts have all been raised already." });
  }
  const dim = dims.find((d) => d.key === key) || dims[0];
  const fallback = suggestionsFor(dim.key);

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // The agent still works, just less well: the rubric's own consumer-facing
    // question is a real question, and asking it beats saying nothing.
    return Response.json({
      ask: true, key: dim.key, label: dim.label,
      question: fallback.q || `Can you say more about the ${dim.label.toLowerCase()}?`,
      options: fallback.options, why: fallback.why,
      model_note: "No model key is set, so the agent is asking the standard question for this part of the PRD rather than one written for your conversation.",
    });
  }

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const endpoint = openrouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const chosen = await chooseModel({
    openrouter, key: apiKey,
    wanted: process.env.AGENT_MODEL || (openrouter ? AGENT_MODEL : ""),
  });

  const prompt = agentQuestionPrompt({
    projectName: project,
    artifact: meta.artifact,
    key: dim.key, label: dim.label, desc: dim.desc,
    // The last few minutes, not the whole meeting: the question has to land
    // in the conversation that is happening now.
    recent: recent.slice(-6000),
    alreadyAsked: asked,
    brief,
    context: ctxBlock,
    spec,
  });

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen.id,
        temperature: 0.3,     // one sentence, in a real conversation — not zero, not loose
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return Response.json({
        ask: true, key: dim.key, label: dim.label,
        question: fallback.q || `Can you say more about the ${dim.label.toLowerCase()}?`,
        options: fallback.options, why: fallback.why,
        model_note: `The model answered ${r.status}. ${detail.slice(0, 160)} — asked the standard question instead.`,
      });
    }
    const j: any = await r.json();
    const q = parseAgentQuestion(String(j?.choices?.[0]?.message?.content || ""), {
      question: fallback.q || `Can you say more about the ${dim.label.toLowerCase()}?`,
      options: fallback.options,
      why: fallback.why,
    });
    return Response.json({
      ask: true, key: dim.key, label: dim.label,
      question: q.question, options: q.options, why: q.why,
      model: chosen.id,
      model_note: chosen.exact ? "" : chosen.why,
    });
  } catch (e: any) {
    return Response.json({
      ask: true, key: dim.key, label: dim.label,
      question: fallback.q || `Can you say more about the ${dim.label.toLowerCase()}?`,
      options: fallback.options, why: fallback.why,
      model_note: `Couldn't reach the model (${e?.message || String(e)}) — asked the standard question instead.`,
    });
  }
}
