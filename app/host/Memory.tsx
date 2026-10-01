"use client";

// Host Memory panel — build / share a Memory package (story / manuscript outline).
// Mirrors Prd.tsx without forcing PRD schema or Conclave handoff.

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Dim = {
  key: string; label: string; status: string; evidence: string;
  question: string; options: string[]; why: string;
};
type Mem = {
  project: string; artifact: string; gate: string; title: string;
  summary: string; markdown: string; filename: string;
  intent?: string; sessionMode?: string;
  score: number; present_count: number; total: number; ready: boolean;
  dimensions: Dim[];
  chapters?: Array<{ heading: string; at?: string; body: string }>;
  quotes?: string[];
  open_threads?: string[];
  meetings?: Array<{ title: string; at: string; room: string }>;
  meetings_used?: number; memory_sessions_used?: number;
  assessment_error?: string; model?: string; model_note?: string; at?: string;
};

export default function Memory({ projects }: { projects: string[] }) {
  const [project, setProject] = useState("");
  const [data, setData] = useState<Mem | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [intent, setIntent] = useState<"story" | "podcast" | "book">("story");
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!project && projects.length) setProject(projects[0]);
  }, [projects, project]);

  const token = async () => (await supabaseBrowser().auth.getSession()).data?.session?.access_token || "";

  const loadShare = useCallback(async (p: string) => {
    if (!p) { setShareUrl(""); return; }
    try {
      const t = await token();
      if (!t) { setShareUrl(""); return; }
      const r = await fetch("/api/memory/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project: p, action: "status" }),
      });
      const j = await r.json().catch(() => null);
      setShareUrl(r.ok && j?.sharing && j?.url ? String(j.url) : "");
    } catch { setShareUrl(""); }
  }, []);

  const loadSaved = useCallback(async (p: string) => {
    if (!p) return;
    setData(null); setNote(""); setShareUrl("");
    try {
      const t = await token();
      if (!t) return;
      const r = await fetch(`/api/memory?project=${encodeURIComponent(p)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j && !j.error) {
        setData(j);
        if (j.intent === "podcast" || j.intent === "book" || j.intent === "story") setIntent(j.intent);
        setNote("");
        await loadShare(p);
      }
    } catch { /* no saved package is normal */ }
  }, [loadShare]);

  useEffect(() => { loadSaved(project); }, [project, loadSaved]);

  async function build() {
    if (!project || busy) return;
    setBusy(true); setNote("");
    try {
      const t = await token();
      if (!t) { setNote("Please sign in."); setBusy(false); return; }
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, intent }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.error) {
        setNote(j?.error || "Could not build the Memory package.");
        setBusy(false);
        return;
      }
      setData(j);
      setShowDoc(true);
      await loadShare(project);
    } catch (e: any) {
      setNote(e?.message || "Could not build the Memory package.");
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!data?.markdown) return;
    navigator.clipboard.writeText(data.markdown).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2200); },
      () => setNote("Clipboard blocked — select the document and copy by hand.")
    );
  }

  function download() {
    if (!data?.markdown) return;
    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || "memory.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function enableShare() {
    if (!project || shareBusy) return;
    setShareBusy(true); setNote("");
    try {
      const t = await token();
      const r = await fetch("/api/memory/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, action: "enable" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.url) {
        setNote(j?.error || "Could not create the share link.");
      } else {
        setShareUrl(String(j.url));
      }
    } catch (e: any) {
      setNote(e?.message || "Could not create the share link.");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShare() {
    if (!project || shareBusy) return;
    setShareBusy(true);
    try {
      const t = await token();
      await fetch("/api/memory/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, action: "revoke" }),
      });
      setShareUrl("");
    } catch { /* ignore */ }
    setShareBusy(false);
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(
      () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2200); },
      () => setNote("Clipboard blocked.")
    );
  }

  return (
    <section className="qh-panel" id="memory-panel">
      <div className="qh-panelhead">
        <span className="qh-eyebrow">MEMORY PACKAGE</span>
        <span className="qh-fine">STORY · PODCAST · BOOK OUTLINE — NOT A PRD</span>
      </div>
      <p className="qh-dim" style={{ marginTop: 0 }}>
        Same recordings and captions as Meeting mode. Build a Memory package —
        title, for-readers summary, chapters, quotes, open threads — after a
        Memory-mode session. Leave with a story, not a PRD.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select className="qh-input" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          {!projects.length ? <option value="">No projects yet</option> : null}
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          className="qh-input qh-tiny"
          value={intent}
          onChange={(e) => setIntent(e.target.value as any)}
          aria-label="Soft intent"
          title="Optional lean — one Memory agent covers all three"
        >
          <option value="story">Story</option>
          <option value="podcast">Podcast</option>
          <option value="book">Book</option>
        </select>
        <button className="qh-primary qh-btn" onClick={build} disabled={busy || !project}>
          {busy ? "Building…" : data ? "Rebuild Memory package" : "Build Memory package"}
        </button>
      </div>

      {note ? <p className="qh-note">{note}</p> : null}

      {data ? (
        <div className="qp-body">
          <p className="qh-dim" style={{ margin: "0 0 8px" }}>
            <strong>{data.title || data.artifact}</strong>
            {" · "}{data.present_count} of {data.total} · score {Number(data.score || 0).toFixed(2)}
            {data.ready ? ` · ${data.gate}` : ""}
            {data.memory_sessions_used != null ? ` · ${data.memory_sessions_used} Memory session(s)` : ""}
            {data.model ? ` · ${data.model}` : ""}
          </p>
          {data.model_note ? <p className="qp-note">{data.model_note}</p> : null}
          {data.assessment_error ? <p className="qh-note">{data.assessment_error}</p> : null}
          {data.summary ? <p className="qh-dim">{data.summary}</p> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
            <button className="qh-ghost qh-btn" onClick={copy}>{copied ? "Copied" : "Copy markdown"}</button>
            <button className="qh-ghost qh-btn" onClick={download}>Download .md</button>
            <button className="qh-ghost qh-btn" onClick={() => setShowDoc((v) => !v)}>
              {showDoc ? "Hide package" : "Show package"}
            </button>
          </div>

          <div className="qp-share" style={{ marginBottom: 12 }}>
            {shareUrl ? (
              <>
                <input className="qh-input" readOnly value={shareUrl} aria-label="Shareable Memory link" />
                <button className="qh-ghost qh-btn" onClick={copyLink}>{linkCopied ? "Copied link" : "Copy shareable link"}</button>
                <button className="qh-ghost qh-btn" disabled={shareBusy} onClick={revokeShare}>Turn sharing off</button>
              </>
            ) : (
              <button className="qh-ghost qh-btn" disabled={shareBusy || !data.markdown} onClick={enableShare}>
                {shareBusy ? "…" : "Turn on shareable Memory link"}
              </button>
            )}
          </div>

          {Array.isArray(data.dimensions) && data.dimensions.length ? (
            <ul className="qp-dims" style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
              {data.dimensions.map((d) => (
                <li key={d.key} style={{ marginBottom: 6 }}>
                  <span className={`qp-pill is-${d.status}`}>{d.status}</span>{" "}
                  <strong>{d.label}</strong>
                  {d.evidence ? <span className="qh-dim"> — {d.evidence}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {showDoc && data.markdown ? (
            <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12.5, lineHeight: 1.5, color: "#e9edf5",
              background: "#0b0e14", border: "1px solid #1c2430",
              borderRadius: 10, padding: "12px 14px", maxHeight: 420, overflow: "auto",
            }}>{data.markdown}</pre>
          ) : null}
        </div>
      ) : (
        <p className="qh-dim">
          Nothing built yet. In the room, toggle <strong>Memory</strong>, talk with captions on,
          End the session, then build here.
        </p>
      )}
      <style>{`
        .qp-pill { display:inline-block; font-size:10px; letter-spacing:.06em; text-transform:uppercase;
          padding:2px 6px; border-radius:999px; border:1px solid #2a3344; color:#9aa6b8; }
        .qp-pill.is-present { border-color:#1d4f4c; color:#7dcdc4; }
        .qp-pill.is-partial { border-color:#5a4a1d; color:#e0c56a; }
        .qp-pill.is-missing { border-color:#4a2a2a; color:#d09090; }
        .qp-note { font-size:12.5px; color:#9aa6b8; }
        .qp-share { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      `}</style>
    </section>
  );
}
