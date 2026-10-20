"use client";

// Public shareable PRD — open the link, read the document, copy or download.
// No account. Revoked / missing links say so plainly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import ExportMenu, { EXPORT_CSS } from "@/app/host/Export";

type PublicPrd = {
  project: string;
  artifact: string;
  gate: string;
  score: number;
  present_count: number;
  total: number;
  ready: boolean;
  summary: string;
  markdown: string;
  filename: string;
  at: string;
  meetings_used: number;
};

export default function SharedPrdPage() {
  const params = useParams();
  const id = String((params as any)?.id || "").trim().toLowerCase();
  const [data, setData] = useState<PublicPrd | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  // The Export menu is for the PRD's HOST only: a reader with the link gets
  // copy and download, never a push into somebody's tracker.
  const [owner, setOwner] = useState<{ project: string; shareUrl: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setError(""); setData(null);
      if (!/^[a-f0-9]{24}$/.test(id)) {
        if (alive) { setError("That share link is not valid."); setBusy(false); }
        return;
      }
      try {
        const r = await fetch(`/api/prd/share?id=${encodeURIComponent(id)}`);
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j || j.error) {
          setError(j?.error || "That share link is gone or was turned off.");
          setBusy(false);
          return;
        }
        setData(j as PublicPrd);
      } catch {
        if (alive) setError("Couldn't reach the server. Try again.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    setOwner(null);
    if (!data) return;
    (async () => {
      try {
        const t = (await supabaseBrowser().auth.getSession()).data?.session?.access_token;
        if (!t) return;
        const r = await fetch("/api/integrations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
          body: JSON.stringify({ action: "share-owner", shareId: id }),
        });
        const j = await r.json().catch(() => null);
        if (alive && r.ok && j?.owner && j.project) setOwner({ project: String(j.project), shareUrl: String(j.shareUrl || "") });
      } catch { /* not signed in, or not the host: no Export menu */ }
    })();
    return () => { alive = false; };
  }, [data, id]);

  function copy() {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2200); },
      () => setError("Your browser blocked the clipboard — select the document and copy by hand.")
    );
  }

  function download() {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || "prd.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="qml">
      <nav className="qml-nav">
        <Link href="/">Home</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/example-prd">Example PRD</Link>
        <span className="qml-nav-spacer" />
        <Link className="qml-btn qml-btn-primary qml-nav-host" href="/host">
          Host a meeting
        </Link>
      </nav>

      <section className="qml-hero" style={{ paddingBottom: 12 }}>
        <p className="qml-kicker">Shared project PRD</p>
        <h1>{data ? `${data.artifact} — ${data.project}` : "Shared PRD"}</h1>
        {data ? (
          <p className="qml-lede">
            {data.present_count} of {data.total} · score {data.score.toFixed(2)}
            {data.meetings_used ? ` · built from ${data.meetings_used} recorded meeting${data.meetings_used === 1 ? "" : "s"}` : ""}
            {data.ready ? ` · ${data.gate}` : ""}. Anyone with this link can read it.
          </p>
        ) : (
          <p className="qml-lede">
            A project PRD shared from Quantlys Meeting. No account needed to read it.
          </p>
        )}
      </section>

      <section className="qml-block">
        {busy ? <p className="qml-muted">Loading…</p> : null}
        {!busy && error ? (
          <div className="qml-card">
            <h3>Link unavailable</h3>
            <p className="qml-muted">{error}</p>
            <p className="qml-muted">
              Ask the host to share it again from their host page, or{" "}
              <Link href="/example-prd">read the example PRD</Link>.
            </p>
          </div>
        ) : null}
        {data ? (
          <article className="qml-prd">
            <div className="qml-prd-bar">
              <i />
              Shared PRD · {data.project}
            </div>
            <div className="qml-prd-body">
              {data.summary ? <p style={{ color: "#cfd6e4", lineHeight: 1.6 }}>{data.summary}</p> : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 16px" }}>
                <button className="qml-btn qml-btn-primary" type="button" onClick={copy}>
                  {copied ? "Copied" : `Copy the ${data.artifact}`}
                </button>
                <button className="qml-btn qml-btn-ghost" type="button" onClick={download}>
                  Download .md
                </button>
              </div>
              {owner ? (
                <div className="qx-shared" style={{ margin: "0 0 16px" }}>
                  <style>{EXPORT_CSS + SHARED_EXPORT_CSS}</style>
                  <ExportMenu project={owner.project} markdown={data.markdown} filename={data.filename || "prd.md"}
                    artifact={data.artifact} backlink={owner.shareUrl || (typeof window !== "undefined" ? window.location.href : "")} />
                </div>
              ) : null}
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "#e9edf5",
                  background: "#0b0e14",
                  border: "1px solid #1c2430",
                  borderRadius: 10,
                  padding: "14px 16px",
                  margin: 0,
                }}
              >
                {data.markdown}
              </pre>
            </div>
          </article>
        ) : null}
      </section>

      <footer className="qml-foot">
        <Link href="/">Quantlys Meeting</Link>
        <span>·</span>
        <Link href="/privacy">Privacy</Link>
        <span>·</span>
        <Link href="/example-prd">Example PRD</Link>
      </footer>
    </div>
  );
}

// The host console's control styles, scoped to the Export menu on this page.
const SHARED_EXPORT_CSS = `
.qx-shared .qh-btn, .qx-shared .qh-ghost { background:transparent; border:1px solid #1e2937; color:#c3cddb;
  padding:9px 14px; font-family:'IBM Plex Mono', monospace; font-size:11px; letter-spacing:.12em; cursor:pointer; }
.qx-shared .qh-ghost:hover, .qx-shared .qh-btn:hover { border-color:#00A99D; color:#7ff0e8; }
.qx-shared .qh-ghost:disabled, .qx-shared .qh-btn:disabled { opacity:.5; cursor:default; }
.qx-shared .qh-input { background:#070a0f; border:1px solid #1e2937; color:#e8eef5; font:inherit; min-width:0; }
.qx-shared .qh-fine { font-family:'IBM Plex Mono', monospace; font-size:10.5px; color:#6b7890; margin:0; line-height:1.6; }
.qx-shared .qp-note { margin:0; color:#f0d9a6; font-size:12.5px; }
.qx-shared .qp-inline { font:inherit; font-size:12px; color:#7fe0d6; background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }
`;
