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
  assessment_error?: string; model?: string; model_note?: string; at?: string;
};

export default function Prd({ projects }: { projects: string[] }) {
  const [project, setProject] = useState("");
  const [data, setData] = useState<Prd | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDoc, setShowDoc] = useState(false);

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

  useEffect(() => { loadSaved(project); }, [project, loadSaved]);

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
              {data.open_questions.map((q) => (
                <div key={q.key} className="qp-q">
                  <b>{q.question}</b>
                  <div className="qp-qopts">{q.options.map((o, i) => <span key={i}>{o}</span>)}</div>
                  <em>{q.why}</em>
                </div>
              ))}
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
.qp-doc { margin:0; max-height:420px; overflow:auto; white-space:pre-wrap; word-break:break-word;
  background:#0b0e14; border:1px solid #1c2430; border-radius:9px; padding:13px;
  color:#cfd6e4; font-size:12px; line-height:1.6; }
`;
