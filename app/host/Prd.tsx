"use client";

// The PRD a project's meetings already wrote.
//
// FIELD 2026-08-24: "Quantlys Meeting should have capability to produce PRD
// from the recordings by project, similar to Conclave PRD which can be
// attached to build products in Quantlys Conclave."
//
// This panel is deliberately not a document viewer with a download button.
// The thing a person needs to see is the SCORE — how much of the PRD their
// meetings have actually settled, on the same eight dimensions Quantlys
// Conclave will score it on — and the specific questions still standing in
// the way. A finished-looking document that Conclave then rates 4/8 is worse
// than no document, because somebody has already started building from it.
//
// AND THE HONEST BIT. Conclave has no endpoint that accepts a PRD: its
// `export-prd` writes a file OUT, `state.prd` is written only by its own
// readiness pass, and creating a conversation takes no body. So there is no
// "Send to Conclave" button here, because that button would be a lie with a
// spinner on it. What there is instead is the three steps that actually work,
// with the document on the clipboard ready for step two.

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Dim = { key: string; label: string; status: string; evidence: string; question: string; options: string[]; why: string };
type Handoff = { n: number; what: string; detail: string };
type Prd = {
  project: string; artifact: string; gate: string; mode: string;
  score: number; present_count: number; total: number; ready: boolean;
  summary: string; prd: string; markdown: string; filename: string;
  dimensions: Dim[];
  open_questions: Array<{ key: string; label: string; question: string; options: string[]; why: string }>;
  meetings: Array<{ title: string; at: string; room: string }>;
  meetings_used: number; meetings_dropped: number;
  brief?: string; decisions?: Decision[]; answered?: string[];
  assessment_error?: string; model?: string; model_note?: string; at?: string;
};
type Decision = { key: string; question: string; answer: string; at: string };

export default function Prd({ projects }: { projects: string[] }) {
  const [project, setProject] = useState("");
  const [data, setData] = useState<Prd | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  // What the team says this project IS. Typed once; it decides which rubric
  // applies and gives every question the agent asks something to be about.
  const [brief, setBrief] = useState("");
  const [briefSaved, setBriefSaved] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  const [editBrief, setEditBrief] = useState(false);
  // Questions answered here, between meetings.
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [answering, setAnswering] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!project && projects.length) setProject(projects[0]);
  }, [projects, project]);

  const token = async () => (await supabaseBrowser().auth.getSession()).data?.session?.access_token || "";

  // Read back the last assessment for free before offering to pay for a new
  // one — a person opening this panel twice should not be billed twice.
  const loadSaved = useCallback(async (p: string) => {
    if (!p) return;
    setData(null); setNote("");
    try {
      const t = await token();
      if (!t) return;
      const r = await fetch(`/api/prd?project=${encodeURIComponent(p)}`, { headers: { Authorization: `Bearer ${t}` } });
      const j = await r.json().catch(() => null);
      if (r.ok && j && !j.error) { setData(j); setNote(""); }
    } catch { /* no saved assessment is the normal first state */ }
  }, []);

  const loadContext = useCallback(async (p: string) => {
    if (!p) return;
    setBrief(""); setBriefSaved(""); setDecisions([]); setEditBrief(false); setCustom({});
    try {
      const t = await token();
      if (!t) return;
      const r = await fetch(`/api/project?project=${encodeURIComponent(p)}`, { headers: { Authorization: `Bearer ${t}` } });
      const j = await r.json().catch(() => null);
      if (r.ok && j && !j.error) {
        setBrief(String(j.brief || ""));
        setBriefSaved(String(j.brief || ""));
        setDecisions(Array.isArray(j.decisions) ? j.decisions : []);
      }
    } catch { /* a project with no context is the normal first state */ }
  }, []);

  useEffect(() => { loadSaved(project); loadContext(project); }, [project, loadSaved, loadContext]);

  async function saveBrief() {
    if (!project || briefBusy) return;
    setBriefBusy(true); setNote("");
    try {
      const t = await token();
      const r = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, action: "brief", brief }),
      });
      const j = await r.json().catch(() => null);
      if (!j || j.error) { setNote(j?.error || "Couldn't save that."); return; }
      setBriefSaved(String(j.brief || ""));
      setBrief(String(j.brief || ""));
      setEditBrief(false);
    } finally { setBriefBusy(false); }
  }

  async function answer(key: string, question: string, text: string) {
    const a = String(text || "").trim();
    if (!project || !a) return;
    setAnswering(key); setNote("");
    try {
      const t = await token();
      const r = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, action: "decision", key, question, answer: a }),
      });
      const j = await r.json().catch(() => null);
      if (!j || j.error) { setNote(j?.error || "Couldn't save that answer."); return; }
      setDecisions(Array.isArray(j.decisions) ? j.decisions : []);
      setCustom((c) => ({ ...c, [key]: "" }));
    } finally { setAnswering(""); }
  }

  async function build() {
    if (!project || busy) return;
    setBusy(true); setNote("Reading every recorded meeting on this project…");
    try {
      const t = await token();
      if (!t) { setNote("Sign in first."); return; }
      const r = await fetch("/api/prd", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project }),
      });
      const j = await r.json().catch(() => null);
      if (!j) { setNote("The server didn't answer. Try again."); return; }
      if (j.error) { setNote(j.error); setData(null); return; }
      setData(j);
      setNote(j.assessment_error ? `Partly assessed: ${j.assessment_error}` : "");
    } catch (e: any) {
      setNote(`Couldn't build it: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2200); },
      () => setNote("Your browser blocked the clipboard — open the document below and copy it by hand.")
    );
  }

  function download() {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = data.filename || "prd.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const pct = data ? Math.round(data.score * 100) : 0;

  return (
    <section className="qh-panel qp">
      <div className="qp-head">
        <h2 className="qh-h2">PRD from your meetings</h2>
        <div className="qp-pick">
          <select className="qh-input qh-mid" value={project} onChange={(e) => setProject(e.target.value)}
                  disabled={!projects.length}>
            {projects.length
              ? projects.map((p) => <option key={p} value={p}>{p}</option>)
              : <option value="">No projects yet</option>}
          </select>
          <button className="qh-btn" onClick={build} disabled={!project || busy}>
            {busy ? "Reading…" : data ? "Rebuild" : "Build the PRD"}
          </button>
        </div>
      </div>

      {!projects.length ? (
        <p className="qh-fine">
          Put a project name in the Project box when you start a meeting. Every recorded meeting
          on the same project is read together, and the PRD builds from all of them.
        </p>
      ) : null}

      {note ? <p className="qp-note">{note}</p> : null}

      {/* THE PROJECT'S OWN WORDS. Without this the app knows a project NAME
          and nothing else, so the first meeting's questions are the generic
          ones for each dimension — a checklist, not an assistant. */}
      {project ? (
        <div className="qp-brief">
          {briefSaved && !editBrief ? (
            <>
              <div className="qp-briefhead">
                <span className="qp-blabel">What we&apos;re building</span>
                <button className="qp-inline" onClick={() => setEditBrief(true)}>Edit</button>
              </div>
              <p className="qp-brieftext">{briefSaved}</p>
            </>
          ) : (
            <>
              <div className="qp-briefhead">
                <span className="qp-blabel">What we&apos;re building</span>
                {briefSaved ? <button className="qp-inline" onClick={() => { setBrief(briefSaved); setEditBrief(false); }}>Cancel</button> : null}
              </div>
              <p className="qh-fine">
                TWO OR THREE SENTENCES, WRITTEN ONCE. IT DECIDES WHICH RUBRIC THIS PROJECT IS SCORED ON AND GIVES
                THE IN-MEETING AGENT SOMETHING TO ASK ABOUT FROM THE VERY FIRST MEETING.
              </p>
              <textarea
                className="qp-briefbox"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="A tool for the finance team that turns a photo of a receipt into a filed expense, so nobody keeps paper. Web first."
              />
              <div className="qp-briefrow">
                <button className="qh-btn" onClick={saveBrief} disabled={briefBusy || brief.trim() === briefSaved.trim()}>
                  {briefBusy ? "Saving…" : "Save"}
                </button>
                <span className="qh-fine">{brief.trim().length}/1200</span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="qp-score">
            <div className="qp-meter" aria-hidden>
              <span style={{ width: `${pct}%` }} className={data.ready ? "qp-fill qp-ok" : "qp-fill"} />
            </div>
            <p className="qp-scoreline">
              <b>{data.present_count} of {data.total}</b> settled · {data.gate}
              {data.ready ? <em className="qp-ok-t"> — ready</em> : <em> — {data.open_questions.length} still open</em>}
            </p>
          </div>
          {data.summary ? <p className="qp-summary">{data.summary}</p> : null}
          <p className="qh-fine">
            BUILT FROM {data.meetings_used} MEETING{data.meetings_used === 1 ? "" : "S"}
            {data.meetings_dropped ? ` · ${data.meetings_dropped} OLDER ONE(S) LEFT OUT FOR LENGTH` : ""}
            {data.model ? ` · ${data.model}` : ""}
          </p>
          {data.model_note ? <p className="qp-note">{data.model_note}</p> : null}

          <div className="qp-dims">
            {data.dimensions.map((d) => (
              <div key={d.key} className={`qp-dim qp-${d.status}`}>
                <span className="qp-dot" aria-hidden />
                <div className="qp-dimtext">
                  <b>{d.label}</b>
                  <span>{d.evidence || (d.status === "missing" ? "Not discussed in any recorded meeting." : "")}</span>
                </div>
              </div>
            ))}
          </div>

          {data.open_questions.length ? (
            <div className="qp-open">
              <h3 className="qp-h3">Ask these in the next meeting</h3>
              <p className="qh-fine">
                THE PRD AGENT ASKS THESE LIVE — SWITCH IT ON IN THE ROOM AND IT WORKS THROUGH THEM IN THE PAUSES
              </p>
              {data.open_questions.map((q) => {
                const done = decisions.find((d) => d.key === q.key);
                return (
                  <div key={q.key} className={`qp-q${done ? " qp-qdone" : ""}`}>
                    <b>{q.question}</b>
                    {done ? (
                      <>
                        <p className="qp-answered"><span>Answered</span> {done.answer}</p>
                        <button className="qp-inline" onClick={() => setDecisions((ds) => ds.filter((d) => d.key !== q.key))}>
                          Answer it differently
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Tappable, not decoration. Answering here means the
                            PRD closes on the days nobody is in a room
                            together — it does not have to wait for the next
                            meeting to come round. */}
                        <div className="qp-qopts">
                          {q.options.map((o, i) => (
                            <button key={i} className="qp-opt" disabled={answering === q.key}
                              onClick={() => answer(q.key, q.question, o)}>
                              {o}
                            </button>
                          ))}
                        </div>
                        <div className="qp-qown">
                          <input
                            className="qh-input qp-owninput"
                            placeholder="…or say it in your own words"
                            value={custom[q.key] || ""}
                            onChange={(e) => setCustom((c) => ({ ...c, [q.key]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && answer(q.key, q.question, custom[q.key] || "")}
                          />
                          <button className="qh-ghost" disabled={!((custom[q.key] || "").trim()) || answering === q.key}
                            onClick={() => answer(q.key, q.question, custom[q.key] || "")}>
                            {answering === q.key ? "Saving…" : "Answer"}
                          </button>
                        </div>
                      </>
                    )}
                    <em>{q.why}</em>
                  </div>
                );
              })}
              {decisions.length ? (
                <p className="qp-rebuild">
                  {decisions.length} answered here since the last build.{" "}
                  <button className="qp-inline" onClick={build} disabled={busy}>Rebuild the PRD</button>{" "}
                  to fold them in — they count as the current position, ahead of anything said in a meeting.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="qp-actions">
            <button className="qh-btn" onClick={copy}>{copied ? "Copied" : `Copy the ${data.artifact}`}</button>
            <button className="qh-ghost" onClick={download}>Download .md</button>
            <button className="qh-ghost" onClick={() => setShowDoc((v) => !v)}>
              {showDoc ? "Hide it" : "Read it"}
            </button>
          </div>

          <div className="qp-handoff">
            <h3 className="qp-h3">Taking it to Conclave</h3>
            <ol className="qp-steps">
              <li><b>Start a new Conclave</b><span>Open Quantlys Conclave and start a conversation for {data.project}.</span></li>
              <li>
                <b>Paste this as the first message</b>
                <span>
                  Conclave reads the first message to pick its crew, so the document itself is the right
                  thing to paste. The .md file works as an attachment too.
                </span>
              </li>
              <li>
                <b>{data.open_questions.length ? `Answer the ${data.open_questions.length} open question${data.open_questions.length === 1 ? "" : "s"}` : "Run readiness"}</b>
                <span>
                  {data.open_questions.length
                    ? "These are the same dimensions Conclave scores, so answering them here is answering them there."
                    : `Every dimension is present — Conclave should score this ${data.gate.toLowerCase()} on the first pass.`}
                </span>
              </li>
            </ol>
            <p className="qh-fine">
              THERE IS NO ONE-CLICK SEND: CONCLAVE HAS NO ENDPOINT THAT ACCEPTS A PRD, SO A BUTTON CLAIMING TO
              DO THIS WOULD BE PRETENDING. THE PASTE IS THE REAL HANDOFF.
            </p>
          </div>

          {showDoc ? <pre className="qp-doc">{data.markdown}</pre> : null}
        </>
      ) : null}
    </section>
  );
}

export const PRD_CSS = `
.qp { display:flex; flex-direction:column; gap:12px; }
.qp-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.qp-pick { display:flex; gap:8px; align-items:center; }
.qp-note { margin:0; color:#f0d9a6; font-size:12.5px; line-height:1.55; }
.qp-score { display:flex; flex-direction:column; gap:6px; }
.qp-meter { height:8px; border-radius:5px; background:#141922; overflow:hidden; }
.qp-fill { display:block; height:100%; background:#f0a44a; transition:width .4s ease; }
.qp-ok { background:#00a99d; }
.qp-ok-t { color:#7fe0d6; font-style:normal; }
.qp-scoreline { margin:0; color:#cfd6e4; font-size:13.5px; }
.qp-scoreline em { color:#8b93a5; font-style:normal; }
.qp-summary { margin:0; color:#e9edf5; font-size:14px; line-height:1.6; }
.qp-dims { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:8px; }
.qp-dim { display:flex; gap:9px; align-items:flex-start; background:#0e1219; border:1px solid #1c2430;
  border-radius:9px; padding:9px 10px; }
.qp-dot { width:8px; height:8px; border-radius:50%; margin-top:5px; flex:0 0 auto; background:#3b4356; }
.qp-present .qp-dot { background:#00a99d; }
.qp-partial .qp-dot { background:#f0a44a; }
.qp-missing .qp-dot { background:#5a2a2f; }
.qp-dimtext { display:flex; flex-direction:column; gap:2px; min-width:0; }
.qp-dimtext b { color:#e9edf5; font-size:12.5px; }
.qp-dimtext span { color:#8b93a5; font-size:11.5px; line-height:1.5; }
.qp-open { display:flex; flex-direction:column; gap:9px; border-top:1px solid #1c2430; padding-top:12px; }
.qp-h3 { margin:0; color:#e9edf5; font-size:13px; letter-spacing:.1em; text-transform:uppercase; }
.qp-q { display:flex; flex-direction:column; gap:5px; background:#0e1219; border:1px solid #1c2430;
  border-radius:9px; padding:10px 12px; }
.qp-q b { color:#e9edf5; font-size:13.5px; line-height:1.45; }
.qp-qopts { display:flex; gap:6px; flex-wrap:wrap; }
.qp-qopts span { font-size:11.5px; color:#cfe9e6; background:#123130; border:1px solid #1d4f4c;
  border-radius:7px; padding:4px 9px; }
.qp-q em { color:#8b93a5; font-size:11.5px; font-style:normal; }
.qp-actions { display:flex; gap:8px; flex-wrap:wrap; }
.qp-handoff { border-top:1px solid #1c2430; padding-top:12px; display:flex; flex-direction:column; gap:9px; }
.qp-steps { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; }
.qp-steps li { color:#8b93a5; font-size:12.5px; }
.qp-steps b { display:block; color:#e9edf5; font-size:13px; margin-bottom:2px; }
.qp-steps span { line-height:1.55; }
.qp-brief { display:flex; flex-direction:column; gap:7px; background:#0e1219; border:1px solid #1c2430;
  border-radius:10px; padding:12px 14px; }
.qp-briefhead { display:flex; justify-content:space-between; align-items:center; }
.qp-blabel { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#7fe0d6; }
.qp-brieftext { margin:0; color:#e9edf5; font-size:14.5px; line-height:1.6; }
.qp-briefbox { background:#0b0e14; color:#e9edf5; border:1px solid #2c3342; border-radius:8px;
  padding:9px 11px; font:inherit; font-size:14px; line-height:1.55; resize:vertical; width:100%; }
.qp-briefrow { display:flex; gap:10px; align-items:center; }
.qp-opt { font:inherit; font-size:12px; cursor:pointer; text-align:left; color:#cfe9e6;
  background:#123130; border:1px solid #1d4f4c; border-radius:7px; padding:5px 10px; line-height:1.4; }
.qp-opt:hover:not(:disabled) { background:#17403e; border-color:#2a6f6a; }
.qp-opt:disabled { opacity:.5; cursor:default; }
.qp-qown { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
.qp-owninput { flex:1 1 220px; font-size:12.5px; padding:6px 9px; }
.qp-qdone { border-color:#1d4f4c; }
.qp-answered { margin:0; color:#cfe9e6; font-size:13.5px; line-height:1.5; }
.qp-answered span { color:#7fe0d6; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; margin-right:7px; }
.qp-rebuild { margin:0; color:#f0d9a6; font-size:12.5px; line-height:1.6; }
.qp-inline { font:inherit; font-size:12px; color:#7fe0d6; background:none; border:0; padding:0;
  cursor:pointer; text-decoration:underline; }
.qp-inline:disabled { opacity:.5; cursor:default; }
.qp-doc { margin:0; max-height:420px; overflow:auto; white-space:pre-wrap; word-break:break-word;
  background:#0b0e14; border:1px solid #1c2430; border-radius:9px; padding:13px;
  color:#cfd6e4; font-size:12px; line-height:1.6; }
`;
