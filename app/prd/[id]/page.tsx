"use client";

// Public shareable PRD — open the link, read the document, copy or download.
// No account. Revoked / missing links say so plainly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
