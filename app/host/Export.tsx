"use client";

// Export a finished PRD into the tools a team already lives in.
//
// Tier 1 (no setup, always on): copy as markdown, download .md, and prefilled
// create links for GitHub and Linear (cut to fit a URL, with a link back to
// the full PRD), plus open-and-paste for Jira and Notion.
//
// Tier 2 (direct push, host's own credentials): shown only when the server
// says it's set up (encryption key + migration). Tokens go to the server
// once, are stored encrypted, and only their last 4 characters ever come
// back. Preview first, then push; a re-push updates what it made last time.

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  PROVIDERS, PROVIDER_LABEL, type Provider, githubNewIssueUrl, linearNewIssueUrl, jiraCreateUrl,
  NOTION_NEW_URL, parseRepo, normalizeJiraSite, extractPrd,
} from "@/lib/integrations";

type Conn = { hint: string; label: string; site: string; at: string };
type Status = { available: boolean; reason?: string; connections?: Record<string, Conn> };
type Preview = { title: string; items: Array<{ key: string; kind: string; title: string; criteria: number; action: string; url: string }>; untouched: string[]; droppedStories: number; stories: number };
type Pushed = { items: Array<{ key: string; action: string; url: string; title: string; id: string }>; warnings: string[] };

const HELP: Record<Provider, string> = {
  github: "Fine-grained personal access token with Issues: read & write on the repos you choose (github.com → Settings → Developer settings).",
  linear: "Personal API key (Linear → Settings → Security & access → Personal API keys).",
  jira: "Your site, your Atlassian email, and an API token (id.atlassian.com → Security → API tokens).",
  notion: "Internal integration token (notion.so/my-integrations). Then share the parent page with that integration.",
};
const TARGET_WORD: Record<Provider, string> = { github: "repository", linear: "team", jira: "project", notion: "parent page" };

const lsGet = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function ExportMenu(props: {
  project: string; markdown: string; filename: string; artifact?: string; backlink: string;
}) {
  const { project, markdown, filename, backlink } = props;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");
  const [repo, setRepo] = useState("");
  const [site, setSite] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [prov, setProv] = useState<Provider>("github");
  const [cred, setCred] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Array<{ id: string; label: string }>>([]);
  const [target, setTarget] = useState("");
  const [children, setChildren] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pushed, setPushed] = useState<Pushed | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => { setRepo(lsGet("qm.export.githubRepo")); setSite(lsGet("qm.export.jiraSite")); }, []);
  const title = extractPrd(markdown, project).title;

  const token = async () => (await supabaseBrowser().auth.getSession()).data?.session?.access_token || "";
  const call = useCallback(async (body: any) => {
    const t = await token();
    if (!t) return { ok: false, j: { error: "Sign in first." } };
    const r = await fetch("/api/integrations", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ error: "The server didn't answer." }));
    return { ok: r.ok, j };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const { j } = await call({ action: "status" });
      setStatus(j && typeof j.available === "boolean" ? j : { available: false });
    } catch { setStatus({ available: false }); }
  }, [call]);
  useEffect(() => { if (open && !status) loadStatus(); }, [open, status, loadStatus]);
  useEffect(() => { setTargets([]); setTarget(lsGet(`qm.export.target.${prov}`)); setPreview(null); setPushed(null); setNote(""); }, [prov]);

  function flash(what: string) { setCopied(what); setTimeout(() => setCopied(""), 2200); }
  function copy(what = "md") {
    navigator.clipboard.writeText(markdown).then(() => flash(what), () => setNote("Your browser blocked the clipboard — use Download .md instead."));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename || "prd.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function openUrl(u: string | null) { if (u) window.open(u, "_blank", "noopener,noreferrer"); }

  const ghUrl = parseRepo(repo) ? githubNewIssueUrl(repo, title, markdown, backlink) : null;
  const jiraUrl = normalizeJiraSite(site) ? jiraCreateUrl(site) : null;
  const conn = status?.connections?.[prov];

  async function connect() {
    setBusy("connect"); setNote("");
    try {
      const { ok, j } = await call({ action: "connect", provider: prov, credentials: cred });
      if (!ok) { setNote(j.error || "Couldn't connect."); return; }
      setCred({});
      await loadStatus();
    } finally { setBusy(""); }
  }
  async function disconnect() {
    setBusy("disconnect"); setNote("");
    try {
      const { ok, j } = await call({ action: "disconnect", provider: prov });
      if (!ok) setNote(j.error || "Couldn't remove it.");
      setTargets([]); setPreview(null); setPushed(null);
      await loadStatus();
    } finally { setBusy(""); }
  }
  async function loadTargets() {
    setBusy("targets"); setNote("");
    try {
      const { ok, j } = await call({ action: "targets", provider: prov });
      if (!ok) { setNote(j.error || "Couldn't load the list."); return; }
      setTargets(j.targets || []);
      if (!(j.targets || []).length) setNote(prov === "notion" ? "No pages yet — share a page with your integration in Notion first." : `No ${TARGET_WORD[prov]}s visible to this token.`);
    } finally { setBusy(""); }
  }
  async function doPreview() {
    setBusy("preview"); setNote(""); setPushed(null);
    try {
      lsSet(`qm.export.target.${prov}`, target);
      const { ok, j } = await call({ action: "preview", provider: prov, project, target, children });
      if (!ok) { setNote(j.error || "Couldn't preview it."); setPreview(null); return; }
      setPreview(j);
    } finally { setBusy(""); }
  }
  async function doPush() {
    setBusy("push"); setNote("");
    try {
      const { ok, j } = await call({ action: "push", provider: prov, project, target, children });
      if (!ok) { setNote(j.error || "The push didn't go through."); return; }
      setPushed(j); setPreview(null);
    } finally { setBusy(""); }
  }

  return (
    <div className="qx">
      <button className="qh-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Close export" : "Export ▾"}
      </button>
      {open ? (
        <div className="qx-panel" role="region" aria-label="Export the PRD">
          <div className="qx-sec">
            <h4 className="qx-h">Quick export — no setup</h4>
            <div className="qx-row">
              <button className="qh-ghost" onClick={() => copy("md")}>{copied === "md" ? "Copied" : "Copy as Markdown"}</button>
              <button className="qh-ghost" onClick={download}>Download .md</button>
            </div>
            <div className="qx-row">
              <input className="qh-input qx-in" placeholder="owner/repo" value={repo} aria-label="GitHub repository"
                onChange={(e) => { setRepo(e.target.value); lsSet("qm.export.githubRepo", e.target.value.trim()); }} />
              <button className="qh-ghost" disabled={!ghUrl} onClick={() => openUrl(ghUrl)}>New GitHub issue ↗</button>
            </div>
            <div className="qx-row">
              <button className="qh-ghost" onClick={() => openUrl(linearNewIssueUrl(title, markdown, backlink))}>New Linear issue ↗</button>
            </div>
            <div className="qx-row">
              <input className="qh-input qx-in" placeholder="yourteam.atlassian.net" value={site} aria-label="Jira site"
                onChange={(e) => { setSite(e.target.value); lsSet("qm.export.jiraSite", e.target.value.trim()); }} />
              <button className="qh-ghost" disabled={!jiraUrl} onClick={() => { copy("jira"); openUrl(jiraUrl); }}>
                {copied === "jira" ? "Copied — paste it in Jira" : "Copy + open Jira ↗"}
              </button>
            </div>
            <div className="qx-row">
              <button className="qh-ghost" onClick={() => { copy("notion"); openUrl(NOTION_NEW_URL); }}>
                {copied === "notion" ? "Copied — paste into the page" : "Copy + open Notion ↗"}
              </button>
            </div>
            <p className="qh-fine">
              LONG PRDS ARE CUT TO FIT A LINK, WITH A POINTER BACK TO THE FULL ONE. NOTION AND JIRA TURN PASTED MARKDOWN INTO HEADINGS AND LISTS.
            </p>
          </div>

          {status?.available ? (
            <div className="qx-sec">
              <h4 className="qx-h">Push directly</h4>
              <div className="qx-tabs" role="tablist">
                {PROVIDERS.map((p) => (
                  <button key={p} role="tab" aria-selected={prov === p} className={`qx-tab${prov === p ? " qx-on" : ""}`} onClick={() => setProv(p)}>
                    {PROVIDER_LABEL[p]}{status.connections?.[p] ? " ✓" : ""}
                  </button>
                ))}
              </div>
              {!conn ? (
                <div className="qx-col">
                  <p className="qh-fine">{HELP[prov]}</p>
                  {prov === "jira" ? (
                    <>
                      <input className="qh-input qx-in" placeholder="https://yourteam.atlassian.net" value={cred.site || ""} onChange={(e) => setCred((c) => ({ ...c, site: e.target.value }))} />
                      <input className="qh-input qx-in" placeholder="you@company.com" value={cred.email || ""} onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))} />
                    </>
                  ) : null}
                  <input className="qh-input qx-in" type="password" autoComplete="off" placeholder="Token" value={cred.token || ""}
                    onChange={(e) => setCred((c) => ({ ...c, token: e.target.value }))} />
                  <div className="qx-row">
                    <button className="qh-btn" disabled={!cred.token || busy === "connect"} onClick={connect}>{busy === "connect" ? "Checking…" : "Connect"}</button>
                  </div>
                  <p className="qh-fine">STORED ENCRYPTED ON THE SERVER. ONLY THE LAST 4 CHARACTERS ARE EVER SHOWN AGAIN. REMOVE IT ANY TIME.</p>
                </div>
              ) : (
                <div className="qx-col">
                  <p className="qx-conn">Connected as <b>{conn.label}</b>{conn.site ? ` · ${conn.site.replace(/^https:\/\//, "")}` : ""} · token {conn.hint}
                    {" "}<button className="qp-inline" disabled={busy === "disconnect"} onClick={disconnect}>Disconnect &amp; delete token</button></p>
                  <div className="qx-row">
                    {targets.length ? (
                      <select className="qh-input qx-in" value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }}>
                        <option value="">Choose a {TARGET_WORD[prov]}…</option>
                        {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    ) : (
                      <input className="qh-input qx-in" placeholder={prov === "github" ? "owner/repo" : `${TARGET_WORD[prov]} id`} value={target}
                        onChange={(e) => { setTarget(e.target.value); setPreview(null); }} />
                    )}
                    <button className="qh-ghost" disabled={busy === "targets"} onClick={loadTargets}>{busy === "targets" ? "Loading…" : `List ${TARGET_WORD[prov]}s`}</button>
                  </div>
                  {prov !== "notion" ? (
                    <label className="qx-check">
                      <input type="checkbox" checked={children} onChange={(e) => { setChildren(e.target.checked); setPreview(null); }} />
                      {" "}Also create one {prov === "github" ? "issue" : prov === "jira" ? "Story" : "sub-issue"} per user story (acceptance criteria as a checklist)
                    </label>
                  ) : null}
                  <div className="qx-row">
                    <button className="qh-ghost" disabled={!target || !!busy} onClick={doPreview}>{busy === "preview" ? "Reading…" : "Preview"}</button>
                    <button className="qh-btn" disabled={!preview || !!busy} onClick={doPush}>{busy === "push" ? "Pushing…" : `Push to ${PROVIDER_LABEL[prov]}`}</button>
                  </div>
                  {preview ? (
                    <div className="qx-preview">
                      <p className="qh-fine">THIS WILL:</p>
                      <ul>
                        {preview.items.map((it) => (
                          <li key={it.key}>
                            <b>{it.action}</b> {it.kind === "epic" ? "parent" : it.kind} — {it.title}
                            {it.criteria ? ` · ${it.criteria} criteria` : ""}
                            {it.url ? <> · <a href={it.url} target="_blank" rel="noopener noreferrer">current</a></> : null}
                          </li>
                        ))}
                      </ul>
                      {prov !== "notion" && children && !preview.stories ? <p className="qh-fine">NO USER STORIES FOUND IN THE PRD — ONLY THE PARENT WILL BE CREATED.</p> : null}
                      {preview.untouched.length ? <p className="qh-fine">{preview.untouched.length} ITEM(S) FROM AN EARLIER PUSH ARE NO LONGER IN THE PRD AND WILL BE LEFT AS THEY ARE.</p> : null}
                      {preview.droppedStories ? <p className="qh-fine">{preview.droppedStories} STORIES OVER THE 25 LIMIT WILL BE LEFT OUT.</p> : null}
                    </div>
                  ) : null}
                  {pushed ? (
                    <div className="qx-preview" role="status">
                      <p className="qh-fine">DONE:</p>
                      <ul>
                        {pushed.items.map((it) => (
                          <li key={it.key}>{it.action} — <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a></li>
                        ))}
                      </ul>
                      {pushed.warnings.map((w, i) => <p key={i} className="qp-note">{w}</p>)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : status && status.reason ? (
            <p className="qh-fine">DIRECT PUSH TO GITHUB, LINEAR, JIRA AND NOTION IS OFF ON THIS SERVER UNTIL ITS OWNER SETS IT UP. THE QUICK EXPORT ABOVE WORKS NOW.</p>
          ) : null}
          {note ? <p className="qp-note" role="alert">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export const EXPORT_CSS = `
.qx { display:flex; flex-direction:column; gap:8px; width:100%; }
.qx > .qh-btn { align-self:flex-start; }
.qx-panel { display:flex; flex-direction:column; gap:12px; background:var(--sunk, #0e1219);
  border:1px solid var(--fieldline, #1c2430); padding:12px 14px; color:var(--text, #e9edf5); }
.qx-sec { display:flex; flex-direction:column; gap:8px; }
.qx-sec + .qx-sec { border-top:1px solid var(--fieldline, #1c2430); padding-top:12px; }
.qx-h { margin:0; color:var(--text, #e9edf5); font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
.qx-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.qx-col { display:flex; flex-direction:column; gap:8px; }
.qx-in { flex:1 1 220px; font-size:13px; padding:8px 10px; }
.qx-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.qx-tab { font:inherit; font-size:12px; cursor:pointer; color:var(--text2, #c3cddb); background:transparent;
  border:1px solid var(--fieldline, #1e2937); padding:6px 10px; }
.qx-on { border-color:var(--accent, #00A99D); color:var(--accentBright, #7ff0e8); }
.qx-conn { margin:0; color:var(--text2, #cfd6e4); font-size:13px; }
.qx-check { color:var(--text2, #cfd6e4); font-size:12.5px; }
.qx-preview { border:1px solid var(--fieldline, #1c2430); padding:10px 12px; color:var(--text2, #cfd6e4); font-size:12.5px; }
.qx-preview ul { margin:4px 0 0; padding-left:18px; display:flex; flex-direction:column; gap:3px; }
.qx-preview a { color:var(--accent, #00A99D); }
`;
