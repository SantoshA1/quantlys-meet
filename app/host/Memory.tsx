"use client";

// Host Memory panel — build / share a Memory package (story / manuscript outline),
// list episodes as chapters, reorder them, and download audio clips.

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { encodeWavPCM, slicePcm, slugClipLabel, formatClock } from "@/lib/memory-chapters";

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
  meetings?: Array<{ title: string; at: string; room: string; path?: string }>;
  meetings_used?: number; memory_sessions_used?: number;
  assessment_error?: string; model?: string; model_note?: string; at?: string;
  buildScope?: string; episodeId?: string | null;
};

type Episode = {
  id: string; path: string; room: string; title: string; at: string;
  sessionMode: string; audioPath?: string | null; durationSec?: number | null; order: number;
};

type ClipRow = {
  id: string; kind: string; label: string; startSec: number; endSec: number;
  audioPath?: string | null; ready: boolean; limit?: string; url?: string;
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

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [chaptersNote, setChaptersNote] = useState("");
  const [buildScope, setBuildScope] = useState<"show" | "chapter">("show");
  const [focusId, setFocusId] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [clipBusy, setClipBusy] = useState(false);
  const [clipNote, setClipNote] = useState("");
  const [clips, setClips] = useState<ClipRow[]>([]);

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

  const loadChapters = useCallback(async (p: string) => {
    if (!p) { setEpisodes([]); setChaptersNote(""); return; }
    try {
      const t = await token();
      if (!t) return;
      const r = await fetch(`/api/memory/chapters?project=${encodeURIComponent(p)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        const eps = Array.isArray(j.episodes) ? j.episodes : [];
        setEpisodes(eps);
        setChaptersNote(String(j.note || ""));
        setFocusId((cur) => cur && eps.some((e: Episode) => e.id === cur) ? cur : (eps[0]?.id || ""));
      }
    } catch { /* no chapters yet is fine */ }
  }, []);

  const loadSaved = useCallback(async (p: string) => {
    if (!p) return;
    setData(null); setNote(""); setShareUrl(""); setClips([]); setClipNote("");
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
    await loadChapters(p);
  }, [loadShare, loadChapters]);

  useEffect(() => { loadSaved(project); }, [project, loadSaved]);

  async function saveOrder(next: Episode[]) {
    if (!project || orderBusy) return;
    setOrderBusy(true); setNote("");
    setEpisodes(next.map((e, i) => ({ ...e, order: i })));
    try {
      const t = await token();
      const r = await fetch("/api/memory/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ project, order: next.map((e) => e.id) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setNote(j?.error || "Could not save chapter order.");
      else if (Array.isArray(j?.episodes)) setEpisodes(j.episodes);
    } catch (e: any) {
      setNote(e?.message || "Could not save chapter order.");
    } finally {
      setOrderBusy(false);
    }
  }

  function moveEpisode(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= episodes.length) return;
    const next = episodes.slice();
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    saveOrder(next);
  }

  async function build() {
    if (!project || busy) return;
    if (buildScope === "chapter" && !focusId) {
      setNote("Pick a chapter to build from, or switch to whole show.");
      return;
    }
    setBusy(true); setNote("");
    try {
      const t = await token();
      if (!t) { setNote("Please sign in."); setBusy(false); return; }
      const body: any = { project, intent };
      if (buildScope === "chapter") body.chapterPath = focusId;
      const r = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(body),
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
      await loadChapters(project);
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

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function decodeAudio(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch audio for clipping.");
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      return await ctx.decodeAudioData(buf.slice(0));
    } finally {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  }

  async function downloadClipFile(clip: ClipRow) {
    if (!clip.url) throw new Error(clip.limit || "No audio URL.");
    // Full episode → original container (m4a / audio.webm). Timed cuts → WAV.
    if (clip.kind === "episode") {
      const res = await fetch(clip.url);
      if (!res.ok) throw new Error("Could not download episode audio.");
      const blob = await res.blob();
      const ext = (clip.audioPath || "").match(/\.(m4a|webm|mp3|wav)$/i)?.[1] || "webm";
      triggerDownload(blob, `${slugClipLabel(clip.label)}.${ext}`);
      return;
    }
    const audio = await decodeAudio(clip.url);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    const end = clip.endSec > clip.startSec ? clip.endSec : audio.duration;
    const sliced = slicePcm(channels, audio.sampleRate, clip.startSec, end);
    const wav = encodeWavPCM(sliced, audio.sampleRate);
    triggerDownload(
      new Blob([wav], { type: "audio/wav" }),
      `${slugClipLabel(clip.label)}-${formatClock(clip.startSec).replace(/:/g, "")}.wav`
    );
  }

  async function loadAndDownloadClips(opts?: { episodeId?: string; onlyReady?: boolean }) {
    if (!project || clipBusy) return;
    setClipBusy(true); setClipNote(""); setClips([]);
    try {
      const t = await token();
      if (!t) { setClipNote("Please sign in."); setClipBusy(false); return; }
      const r = await fetch("/api/memory/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          project,
          episodeId: opts?.episodeId || (buildScope === "chapter" ? focusId : "") || undefined,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) {
        setClipNote(j?.error || "Could not build the clip plan.");
        setClipBusy(false);
        return;
      }
      const list: ClipRow[] = Array.isArray(j.clips) ? j.clips : [];
      setClips(list);
      const limits = Array.isArray(j.limits) ? j.limits.filter(Boolean) : [];
      const ready = list.filter((c) => c.ready && c.url);
      if (!ready.length) {
        setClipNote(
          limits.slice(0, 2).join(" ") ||
            "No downloadable clips yet — need audio sidecars and (for chapter/quote cuts) mm:ss cues or timed transcript lines."
        );
        setClipBusy(false);
        return;
      }
      let ok = 0;
      for (const c of ready) {
        try {
          await downloadClipFile(c);
          ok++;
        } catch (e: any) {
          setClipNote(e?.message || "One clip failed to download.");
        }
      }
      const skipped = list.length - ready.length;
      setClipNote(
        `Downloaded ${ok} clip(s)` +
          (skipped ? ` · ${skipped} skipped (see limits below)` : "") +
          (limits.length ? ` · ${limits[0]}` : "")
      );
    } catch (e: any) {
      setClipNote(e?.message || "Could not download clips.");
    } finally {
      setClipBusy(false);
    }
  }

  async function downloadEpisodeAudio(ep: Episode) {
    await loadAndDownloadClips({ episodeId: ep.id });
  }

  return (
    <section className="qh-panel" id="memory-panel">
      <div className="qh-panelhead">
        <span className="qh-eyebrow">MEMORY PACKAGE</span>
        <span className="qh-fine">STORY · PODCAST · BOOK — CHAPTERS + CLIPS</span>
      </div>
      <p className="qh-dim" style={{ marginTop: 0 }}>
        Same recordings and captions as Meeting mode. Group Memory sessions as
        chapters/episodes, build the whole show or one chapter, and download
        audio clips when timestamps exist.
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
        <select
          className="qh-input qh-tiny"
          value={buildScope}
          onChange={(e) => setBuildScope(e.target.value as any)}
          aria-label="Build scope"
        >
          <option value="show">Whole show / book</option>
          <option value="chapter">One chapter</option>
        </select>
        {buildScope === "chapter" ? (
          <select
            className="qh-input"
            value={focusId}
            onChange={(e) => setFocusId(e.target.value)}
            aria-label="Chapter"
          >
            {!episodes.length ? <option value="">No chapters yet</option> : null}
            {episodes.map((ep, i) => (
              <option key={ep.id} value={ep.id}>
                {i + 1}. {ep.title || ep.room}
              </option>
            ))}
          </select>
        ) : null}
        <button className="qh-primary qh-btn" onClick={build} disabled={busy || !project}>
          {busy ? "Building…" : data ? "Rebuild Memory package" : "Build Memory package"}
        </button>
        <button
          className="qh-ghost qh-btn"
          onClick={() => loadAndDownloadClips()}
          disabled={clipBusy || !project}
          title="Full episode audio plus chapter/quote cuts when timestamps exist"
        >
          {clipBusy ? "Preparing clips…" : "Download clips"}
        </button>
      </div>

      {note ? <p className="qh-note">{note}</p> : null}
      {clipNote ? <p className="qh-dim">{clipNote}</p> : null}

      <div className="qm-chapters" style={{ marginBottom: 14 }}>
        <div className="qh-panelhead" style={{ marginBottom: 6 }}>
          <span className="qh-eyebrow">CHAPTERS / EPISODES</span>
          <span className="qh-fine">{episodes.length ? `${episodes.length} in this project` : "NONE YET"}</span>
        </div>
        {chaptersNote ? <p className="qh-dim" style={{ marginTop: 0 }}>{chaptersNote}</p> : null}
        {!episodes.length ? (
          <p className="qh-dim">
            Memory-tagged recordings for this project appear here as orderable chapters.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {episodes.map((ep, i) => (
              <li key={ep.id} className="qm-chapter-row">
                <span className="qm-chapter-meta">
                  <strong>{i + 1}. {ep.title || ep.room}</strong>
                  <span className="qh-dim">
                    {" · "}{ep.at ? ep.at.slice(0, 16).replace("T", " ") : ep.room}
                    {ep.sessionMode === "memory" ? " · Memory" : " · Meeting"}
                    {ep.durationSec ? ` · ${formatClock(ep.durationSec)}` : ""}
                  </span>
                </span>
                <span className="qm-chapter-actions">
                  <button className="qh-ghost qh-btn" disabled={orderBusy || i === 0} onClick={() => moveEpisode(i, -1)}>
                    Move up
                  </button>
                  <button className="qh-ghost qh-btn" disabled={orderBusy || i === episodes.length - 1} onClick={() => moveEpisode(i, 1)}>
                    Move down
                  </button>
                  <button
                    className="qh-ghost qh-btn"
                    disabled={clipBusy || !ep.audioPath}
                    onClick={() => downloadEpisodeAudio(ep)}
                    title={ep.audioPath ? "Per-chapter audio + timed cuts when available" : "No audio sidecar"}
                  >
                    Per-chapter audio
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {clips.length ? (
        <details style={{ marginBottom: 12 }}>
          <summary className="qh-dim">Clip plan ({clips.filter((c) => c.ready).length}/{clips.length} ready)</summary>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {clips.map((c) => (
              <li key={c.id} style={{ marginBottom: 4, fontSize: 12.5 }}>
                <span className={`qp-pill is-${c.ready ? "present" : "missing"}`}>{c.kind}</span>{" "}
                <strong>{c.label}</strong>
                {c.ready ? (
                  <span className="qh-dim"> — {formatClock(c.startSec)}–{formatClock(c.endSec || c.startSec)}</span>
                ) : (
                  <span className="qh-dim"> — {c.limit}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {data ? (
        <div className="qp-body">
          <p className="qh-dim" style={{ margin: "0 0 8px" }}>
            <strong>{data.title || data.artifact}</strong>
            {" · "}{data.present_count} of {data.total} · score {Number(data.score || 0).toFixed(2)}
            {data.ready ? ` · ${data.gate}` : ""}
            {data.memory_sessions_used != null ? ` · ${data.memory_sessions_used} Memory session(s)` : ""}
            {data.buildScope === "chapter" ? " · one chapter" : ""}
            {data.model ? ` · ${data.model}` : ""}
          </p>
          {data.model_note ? <p className="qp-note">{data.model_note}</p> : null}
          {data.assessment_error ? <p className="qh-note">{data.assessment_error}</p> : null}
          {data.summary ? <p className="qh-dim">{data.summary}</p> : null}

          {Array.isArray(data.chapters) && data.chapters.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
              {data.chapters.map((c, i) => (
                <li key={i} className="qh-dim" style={{ marginBottom: 4 }}>
                  <strong>{c.heading}</strong>
                  {c.at ? ` (${c.at})` : " (no clock cue)"}
                </li>
              ))}
            </ul>
          ) : null}

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
          End the session, then build here (whole show or one chapter).
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
        .qm-chapter-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;
          padding:8px 0; border-bottom:1px solid #1c2430; }
        .qm-chapter-actions { display:flex; flex-wrap:wrap; gap:6px; }
        .qm-chapter-meta { flex:1; min-width:180px; }
      `}</style>
    </section>
  );
}
