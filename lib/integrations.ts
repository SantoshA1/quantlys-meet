// PRD → GitHub Issues · Linear · Jira · Notion.
//
// Santosh, 2026-10-19: "prioritize Integrations first: push the PRD into
// GitHub issues, Linear, Jira and Notion. That's how a tool gets embedded in
// a team's workflow instead of being tried once."
//
// This file is the PURE half: reading the PRD markdown into stories and
// acceptance criteria, mapping it onto each tracker's payload, validating
// everything a host types, and building the no-setup prefilled links. No
// network, no crypto, no env — so every rule here is unit-testable offline
// (lib/integrations.test.mjs). The HTTP half is lib/integrations-providers.ts.
//
// ZERO-IMPORT on purpose.

export const PROVIDERS = ["github", "linear", "jira", "notion"] as const;
export type Provider = (typeof PROVIDERS)[number];
export function isProvider(p: any): p is Provider {
  return (PROVIDERS as readonly string[]).includes(String(p));
}
export const PROVIDER_LABEL: Record<Provider, string> = {
  github: "GitHub Issues", linear: "Linear", jira: "Jira Cloud", notion: "Notion",
};

/** Child issues per push. A PRD with more stories than this is a backlog,
 *  not a PRD — and the cap keeps one push inside a serverless time budget. */
export const MAX_CHILDREN = 25;

// ── markdown → blocks ─────────────────────────────────────────────────────

export type MdBlock =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "li"; text: string; depth: number; ordered: boolean; checked: boolean | null }
  | { t: "quote"; text: string }
  | { t: "code"; text: string; lang: string }
  | { t: "hr" };

export function parseMarkdown(md: string): MdBlock[] {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { out.push({ t: "p", text: para.join(" ").trim() }); para = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) { body.push(lines[i]); i++; }
      out.push({ t: "code", text: body.join("\n"), lang: fence[2] || "" });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); out.push({ t: "h", level: h[1].length, text: h[2].trim() }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: "hr" }); continue; }
    const li = line.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (li) {
      flush();
      const indent = li[1].replace(/\t/g, "  ").length;
      out.push({
        t: "li", text: li[4].trim(), depth: Math.min(3, Math.floor(indent / 2)),
        ordered: /\d/.test(li[2]), checked: li[3] === undefined ? null : li[3].toLowerCase() === "x",
      });
      continue;
    }
    const q = line.match(/^\s{0,3}>\s?(.*)$/);
    if (q) { flush(); out.push({ t: "quote", text: q[1].trim() }); continue; }
    // A wrapped continuation of the list item just above it.
    const prev = out[out.length - 1];
    if (!para.length && prev && prev.t === "li" && /^\s{2,}\S/.test(line)) {
      prev.text = `${prev.text} ${line.trim()}`; continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

// ── inline spans (bold / italic / code / links) ───────────────────────────

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

export function safeHref(u: string): string {
  try {
    const url = new URL(String(u || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

export function inlineSpans(text: string): Span[] {
  const s = String(text || "");
  const out: Span[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ text: tok.slice(1, -1), code: true });
    else if (m[2]) out.push({ text: tok.slice(2, -2), bold: true });
    else if (m[3]) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = safeHref(mm[2]);
      out.push(href ? { text: mm[1], href } : { text: mm[1] });
    } else out.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.filter((x) => x.text.length > 0);
}

export function plainText(text: string): string {
  return inlineSpans(text).map((x) => x.text).join("").replace(/\s+/g, " ").trim();
}

export function clip(s: string, n: number): string {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
}

// ── the PRD, read for a tracker ───────────────────────────────────────────

export type Story = { title: string; text: string; criteria: string[] };
export type PrdParts = { title: string; stories: Story[]; criteria: string[] };

const isTbd = (s: string) => /^(tbd|n\/a|none|todo|\(?not (yet )?(decided|discussed|settled)\)?)\.?$/i.test(plainText(s));
const STORY_HEAD = /\buser stor(y|ies)\b|^stories$/i;
const AC_HEAD = /\bacceptance\b/i;

/** Pull the title, the user stories (each with any acceptance criteria
 *  nested under it) and the PRD-wide acceptance criteria out of whatever
 *  markdown the model wrote. Stories may be bullets ("- As an admin…", with
 *  criteria as nested bullets) or ### sub-headings with bullets beneath. */
export function extractPrd(markdown: string, project = ""): PrdParts {
  const blocks = parseMarkdown(markdown);
  const h1 = blocks.find((b) => b.t === "h" && b.level === 1) as { text: string } | undefined;
  const title = clip(plainText(h1?.text || "") || `PRD — ${String(project || "project").trim()}`, 200);
  const stories: Story[] = [];
  const criteria: string[] = [];
  let section: "" | "stories" | "ac" = "";
  let sectionLevel = 0;
  let cur: Story | null = null;
  let curFromHeading = false;
  let inStoryAc = false;
  for (const b of blocks) {
    if (b.t === "h") {
      if (section && b.level <= sectionLevel) { section = ""; cur = null; }
      if (!section || b.level <= sectionLevel) {
        if (STORY_HEAD.test(plainText(b.text))) { section = "stories"; sectionLevel = b.level; cur = null; continue; }
        if (AC_HEAD.test(plainText(b.text))) { section = "ac"; sectionLevel = b.level; continue; }
        continue;
      }
      if (section === "stories") {
        if (AC_HEAD.test(plainText(b.text)) && cur) { inStoryAc = true; continue; }
        if (b.level !== sectionLevel + 1) continue;
        const t = plainText(b.text).replace(/^(us|story)[-\s]?\d+[:.)]?\s*/i, "");
        cur = { title: clip(t, 200), text: "", criteria: [] };
        curFromHeading = true; inStoryAc = false;
        if (t && !isTbd(t)) stories.push(cur);
      }
      continue;
    }
    if (section === "ac" && b.t === "li") {
      const t = plainText(b.text);
      if (t && !isTbd(t)) criteria.push(t);
      continue;
    }
    if (section !== "stories") continue;
    if (b.t === "li") {
      const t = plainText(b.text).replace(/^(ac|acceptance( criteria)?)\s*[:\-–]\s*/i, "");
      if (!t || isTbd(t)) continue;
      if (curFromHeading && cur) {
        if (!inStoryAc && !cur.text && /^as an?\b/i.test(t)) cur.text = t;
        else cur.criteria.push(t);
      } else if (b.depth === 0) {
        cur = { title: clip(t, 200), text: t, criteria: [] };
        curFromHeading = false;
        stories.push(cur);
      } else if (cur) {
        cur.criteria.push(t);
      }
    } else if (b.t === "p" && cur && curFromHeading && !cur.text) {
      const t = plainText(b.text);
      if (t && !isTbd(t)) cur.text = t;
    }
  }
  for (const s of stories) if (!s.text) s.text = s.title;
  return { title, stories, criteria };
}

/** Turn bullets under any "Acceptance criteria" heading into task-list
 *  checkboxes — GitHub and Linear both render `- [ ]` as a checklist. */
export function checklistify(markdown: string): string {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let acLevel = 0;
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (acLevel && level <= acLevel) acLevel = 0;
      if (AC_HEAD.test(h[2])) acLevel = level;
      return line;
    }
    if (!acLevel) return line;
    const li = line.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(?!\[[ xX]\])(.*)$/);
    return li ? `${li[1]}- [ ] ${li[3]}` : line;
  }).join("\n");
}

// ── the export plan: one parent + optional child per story ────────────────

export type PlanItem = { key: string; kind: "epic" | "story"; title: string; story?: Story };
export type ExportPlan = {
  project: string; title: string; markdown: string; backlink: string;
  parts: PrdParts; items: PlanItem[]; droppedStories: number;
};

export function buildPlan(input: {
  project: string; markdown: string; backlink: string; children: boolean;
}): ExportPlan {
  const parts = extractPrd(input.markdown, input.project);
  const items: PlanItem[] = [{ key: "epic", kind: "epic", title: parts.title }];
  let dropped = 0;
  if (input.children) {
    parts.stories.forEach((s, i) => {
      if (i >= MAX_CHILDREN) { dropped++; return; }
      items.push({ key: `story:${i + 1}`, kind: "story", title: clip(`Story: ${s.title}`, 240), story: s });
    });
  }
  return {
    project: String(input.project || "").trim(), title: parts.title, markdown: String(input.markdown || ""),
    backlink: String(input.backlink || ""), parts, items, droppedStories: dropped,
  };
}

export type ExistingRef = { external_id: string; external_url: string };

/** What a push WILL do, item by item, before anything is sent. */
export function previewPlan(plan: ExportPlan, existing: Record<string, ExistingRef>, provider: Provider) {
  const items = (provider === "notion" ? plan.items.slice(0, 1) : plan.items).map((it) => ({
    key: it.key, kind: provider === "notion" ? "page" : it.kind, title: it.title,
    criteria: it.story ? it.story.criteria.length : plan.parts.criteria.length,
    action: existing[it.key] ? (provider === "notion" ? "replace" : "update") : "create",
    url: existing[it.key]?.external_url || "",
  }));
  const live = new Set(items.map((i) => i.key));
  const untouched = Object.keys(existing).filter((k) => !live.has(k)).sort();
  return { items, untouched, droppedStories: plan.droppedStories, stories: plan.parts.stories.length };
}

const footer = (link: string) => link ? `\n\n---\n_Exported from Quantlys Meeting · full PRD: ${link}_` : "\n\n---\n_Exported from Quantlys Meeting_";

/** Cut a markdown body to `max` characters, ending on a line, with a
 *  pointer to the full document rather than a silent loss. */
export function truncateBody(body: string, max: number, link: string): string {
  const b = String(body || "");
  if (b.length <= max) return b;
  const note = `\n\n…truncated.${link ? ` Full PRD: ${link}` : ""}`;
  let cut = b.slice(0, Math.max(0, max - note.length));
  const nl = cut.lastIndexOf("\n");
  if (nl > cut.length * 0.6) cut = cut.slice(0, nl);
  return cut.trimEnd() + note;
}

export const GITHUB_BODY_MAX = 65000;
export const LINEAR_BODY_MAX = 60000;

export type ChildRef = { title: string; ref: string; url: string };

/** GitHub / Linear parent body: the PRD itself, criteria as a checklist,
 *  plus a checklist of the child issues once they exist. */
export function parentMarkdown(plan: ExportPlan, children: ChildRef[], max: number, refs: boolean): string {
  let body = checklistify(plan.markdown.trim());
  if (refs && children.length) {
    body += `\n\n## Stories\n\n${children.map((c) => `- [ ] ${c.ref} ${c.title.replace(/^Story:\s*/, "")}`).join("\n")}`;
  }
  return truncateBody(body + footer(plan.backlink), max, plan.backlink);
}

export function storyMarkdown(story: Story, parentRef: string, link: string, max: number): string {
  const lines = [story.text, ""];
  if (story.criteria.length) {
    lines.push("### Acceptance criteria", "", ...story.criteria.map((c) => `- [ ] ${c}`));
  } else {
    lines.push(`_The PRD gives no criteria specific to this story — see the checklist in the parent${parentRef ? ` (${parentRef})` : ""}._`);
  }
  if (parentRef) lines.push("", `Part of ${parentRef}`);
  return truncateBody(lines.join("\n") + footer(link), max, link);
}

// ── GitHub payloads ───────────────────────────────────────────────────────

export function githubIssuePayload(title: string, body: string) {
  return { title: clip(String(title || "PRD").replace(/[\r\n]+/g, " "), 256), body };
}

// ── Linear payloads ───────────────────────────────────────────────────────

export function linearIssueInput(teamId: string, title: string, description: string, parentId?: string) {
  const input: Record<string, string> = { teamId, title: clip(String(title || "PRD").replace(/[\r\n]+/g, " "), 255), description };
  if (parentId) input.parentId = parentId;
  return input;
}

// ── Jira: Atlassian Document Format ───────────────────────────────────────

export const JIRA_SOURCE_MAX = 24000;

function adfText(text: string): any[] {
  return inlineSpans(text).map((s) => {
    const marks: any[] = [];
    if (s.bold) marks.push({ type: "strong" });
    if (s.italic) marks.push({ type: "em" });
    if (s.code) marks.push({ type: "code" });
    if (s.href && !s.code) marks.push({ type: "link", attrs: { href: s.href } });
    return marks.length ? { type: "text", text: s.text, marks } : { type: "text", text: s.text };
  });
}
const adfPara = (text: string) => {
  const content = adfText(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Markdown → ADF v1. Criteria bullets get a ☐ so they read as a checklist
 *  (ADF task lists are not accepted in every Jira project's description). */
export function mdToAdf(markdown: string): any {
  const blocks = parseMarkdown(checklistify(markdown));
  const content: any[] = [];
  let stack: { depth: number; list: any }[] = [];
  const closeLists = () => { stack = []; };
  for (const b of blocks) {
    if (b.t !== "li") closeLists();
    if (b.t === "h") content.push({ type: "heading", attrs: { level: Math.min(6, b.level) }, content: adfText(b.text) });
    else if (b.t === "p") content.push(adfPara(b.text));
    else if (b.t === "quote") content.push({ type: "blockquote", content: [adfPara(b.text)] });
    else if (b.t === "hr") content.push({ type: "rule" });
    else if (b.t === "code") content.push({ type: "codeBlock", attrs: b.lang ? { language: b.lang } : {}, content: b.text ? [{ type: "text", text: b.text }] : [] });
    else if (b.t === "li") {
      const text = b.checked === null ? b.text : `${b.checked ? "☑" : "☐"} ${b.text}`;
      const item = { type: "listItem", content: [adfPara(text)] };
      while (stack.length && stack[stack.length - 1].depth > b.depth) stack.pop();
      const top = stack[stack.length - 1];
      const type = b.ordered ? "orderedList" : "bulletList";
      if (top && top.depth === b.depth && top.list.type === type) { top.list.content.push(item); continue; }
      if (top && top.depth === b.depth) stack.pop();
      const list = { type, content: [item] };
      const parent = stack[stack.length - 1];
      if (parent) {
        const lastItem = parent.list.content[parent.list.content.length - 1];
        lastItem.content.push(list);
      } else content.push(list);
      stack.push({ depth: parent ? Math.max(b.depth, parent.depth + 1) : b.depth, list });
    }
  }
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph" }] };
}

export function jiraIssueFields(o: {
  projectKey: string; issueTypeId: string; summary: string; markdown: string; link: string; parentKey?: string;
}) {
  const fields: any = {
    project: { key: o.projectKey },
    issuetype: { id: o.issueTypeId },
    summary: clip(String(o.summary || "PRD").replace(/[\r\n]+/g, " "), 255),
    description: mdToAdf(truncateBody(o.markdown, JIRA_SOURCE_MAX, o.link)),
  };
  if (o.parentKey) fields.parent = { key: o.parentKey };
  return fields;
}

// ── Notion blocks ─────────────────────────────────────────────────────────

const NOTION_TEXT_MAX = 2000;
const NOTION_CODE_LANGS = new Set(["javascript", "typescript", "json", "bash", "shell", "python", "sql", "markdown", "html", "css", "yaml", "mermaid", "go", "rust", "java"]);

export function notionRichText(text: string): any[] {
  const out: any[] = [];
  for (const s of inlineSpans(text)) {
    for (let i = 0; i < s.text.length; i += NOTION_TEXT_MAX) {
      const t: any = { type: "text", text: { content: s.text.slice(i, i + NOTION_TEXT_MAX) } };
      if (s.href && !s.code) t.text.link = { url: s.href };
      if (s.bold || s.italic || s.code) t.annotations = { bold: !!s.bold, italic: !!s.italic, code: !!s.code };
      out.push(t);
    }
  }
  return out.slice(0, 100);
}

/** Markdown → Notion blocks. The first H1 becomes the page title, so it is
 *  left out of the body. Criteria become to-do checkboxes. One level of
 *  list nesting is kept; deeper bullets fold up to that level. */
export function mdToNotionBlocks(markdown: string, link: string): { title: string; blocks: any[] } {
  const parsed = parseMarkdown(checklistify(markdown));
  const firstH1 = parsed.findIndex((b) => b.t === "h" && b.level === 1);
  const title = firstH1 >= 0 ? clip(plainText((parsed[firstH1] as any).text), 200) : "PRD";
  const blocks: any[] = [];
  if (link) {
    blocks.push({ object: "block", type: "callout", callout: {
      rich_text: notionRichText(`Exported from Quantlys Meeting · [full PRD](${link})`), icon: { type: "emoji", emoji: "📝" },
    } });
  }
  const mk = (type: string, body: any) => ({ object: "block", type, [type]: body });
  let lastTop: any = null;
  parsed.forEach((b, i) => {
    if (i === firstH1) return;
    if (b.t === "h") { lastTop = null; blocks.push(mk(`heading_${Math.min(3, b.level)}`, { rich_text: notionRichText(b.text) })); return; }
    if (b.t === "p") { lastTop = null; blocks.push(mk("paragraph", { rich_text: notionRichText(b.text) })); return; }
    if (b.t === "quote") { lastTop = null; blocks.push(mk("quote", { rich_text: notionRichText(b.text) })); return; }
    if (b.t === "hr") { lastTop = null; blocks.push(mk("divider", {})); return; }
    if (b.t === "code") {
      lastTop = null;
      const lang = NOTION_CODE_LANGS.has(b.lang.toLowerCase()) ? b.lang.toLowerCase() : "plain text";
      blocks.push(mk("code", { rich_text: notionRichText(b.text.slice(0, NOTION_TEXT_MAX * 50)).map((r: any) => ({ type: "text", text: { content: r.text.content } })), language: lang }));
      return;
    }
    if (b.t === "li") {
      const block = b.checked !== null
        ? mk("to_do", { rich_text: notionRichText(b.text), checked: b.checked })
        : mk(b.ordered ? "numbered_list_item" : "bulleted_list_item", { rich_text: notionRichText(b.text) });
      if (b.depth > 0 && lastTop) {
        const body = lastTop[lastTop.type];
        (body.children ||= []).push(block);
        if (body.children.length > 100) body.children.length = 100;
      } else { blocks.push(block); lastTop = block; }
    }
  });
  blocks.push(mk("paragraph", { rich_text: notionRichText(link ? `Full PRD: ${link}` : "Exported from Quantlys Meeting") }));
  return { title, blocks };
}

// ── validation of everything a host types ─────────────────────────────────

export function parseRepo(raw: string): { owner: string; repo: string; full: string } | null {
  let s = String(raw || "").trim();
  const gh = s.match(/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (gh) s = `${gh[1]}/${gh[2]}`;
  const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!m || m[2] === "." || m[2] === ".." || /\.git$/i.test(m[2])) return null;
  return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` };
}

/** Jira sites are ONLY https://<name>.atlassian.net — anything else would let
 *  a stranger point this server's outbound requests wherever they liked. */
export function normalizeJiraSite(raw: string): string | null {
  let s = String(raw || "").trim();
  if (!s || s.length > 200) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/.test(host)) return null;
  return `https://${host}`;
}

export function isJiraProjectKey(s: string): boolean { return /^[A-Z][A-Z0-9_]{1,9}$/.test(String(s || "")); }
export function isUuid(s: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "")); }

/** A Notion page id, from a bare id or a notion.so / notion.site URL. */
export function normalizeNotionId(raw: string): string | null {
  let s = String(raw || "").trim();
  if (/^https:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (!/(^|\.)notion\.(so|site)$/i.test(u.hostname)) return null;
      s = u.pathname;
    } catch { return null; }
  }
  const hex = s.replace(/-/g, "").match(/([0-9a-f]{32})$/i);
  if (!hex) return null;
  const h = hex[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isEmail(s: string): boolean { return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(s || "")) && String(s).length <= 254; }

export type Creds =
  | { provider: "github"; token: string }
  | { provider: "linear"; token: string }
  | { provider: "jira"; site: string; email: string; token: string }
  | { provider: "notion"; token: string };

/** Shape-check credentials before anything is sent anywhere. Returns a
 *  plain-English reason when it refuses. */
export function acceptCreds(provider: string, raw: any): { ok: true; creds: Creds } | { ok: false; why: string } {
  const token = String(raw?.token || "").trim();
  if (!isProvider(provider)) return { ok: false, why: "Unknown integration." };
  if (provider === "github") {
    if (!/^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{30,60})$/.test(token)) return { ok: false, why: "That doesn't look like a GitHub token (github_pat_… or ghp_…)." };
    return { ok: true, creds: { provider, token } };
  }
  if (provider === "linear") {
    if (!/^lin_api_[A-Za-z0-9]{20,100}$/.test(token)) return { ok: false, why: "That doesn't look like a Linear personal API key (lin_api_…)." };
    return { ok: true, creds: { provider, token } };
  }
  if (provider === "notion") {
    if (!/^(ntn_|secret_)[A-Za-z0-9]{20,100}$/.test(token)) return { ok: false, why: "That doesn't look like a Notion integration token (ntn_… or secret_…)." };
    return { ok: true, creds: { provider, token } };
  }
  const site = normalizeJiraSite(raw?.site);
  const email = String(raw?.email || "").trim();
  if (!site) return { ok: false, why: "Use your Jira Cloud address, like https://yourteam.atlassian.net." };
  if (!isEmail(email)) return { ok: false, why: "Enter the email of the Atlassian account the token belongs to." };
  if (!/^[A-Za-z0-9_=+\/.-]{16,300}$/.test(token)) return { ok: false, why: "That doesn't look like an Atlassian API token." };
  return { ok: true, creds: { provider, site, email, token } };
}

/** Validate a push target for a provider; returns the canonical id. */
export function acceptTarget(provider: Provider, raw: string): string | null {
  const s = String(raw || "").trim();
  if (provider === "github") return parseRepo(s)?.full || null;
  if (provider === "linear") return isUuid(s) ? s.toLowerCase() : null;
  if (provider === "jira") return isJiraProjectKey(s.toUpperCase()) ? s.toUpperCase() : null;
  return normalizeNotionId(s);
}

export function projectSlug(name: string): string {
  return String(name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

// ── Tier 1: prefilled create links, no setup ──────────────────────────────

/** Browsers and servers start refusing URLs past ~8 KB. */
export const URL_MAX = 8000;

/** Fit `body` into `build(body)` under `max` characters of URL, cutting it
 *  with a pointer back to the full PRD when it does not fit. */
export function fitUrl(build: (body: string) => string, body: string, link: string, max = URL_MAX): string {
  const full = build(body);
  if (full.length <= max) return full;
  const note = `\n\n…truncated.${link ? ` Full PRD: ${link}` : ""}`;
  let lo = 0, hi = body.length, best = build(note.trim());
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const u = build(body.slice(0, mid).trimEnd() + note);
    if (u.length <= max) { best = u; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

export function githubNewIssueUrl(repo: string, title: string, markdown: string, link: string, max = URL_MAX): string | null {
  const r = parseRepo(repo);
  if (!r) return null;
  const t = encodeURIComponent(clip(title, 200));
  return fitUrl((b) => `https://github.com/${r.owner}/${r.repo}/issues/new?title=${t}&body=${encodeURIComponent(b)}`,
    checklistify(markdown) + footer(link), link, max);
}

export function linearNewIssueUrl(title: string, markdown: string, link: string, max = URL_MAX): string {
  const t = encodeURIComponent(clip(title, 200));
  return fitUrl((b) => `https://linear.app/new?title=${t}&description=${encodeURIComponent(b)}`,
    checklistify(markdown) + footer(link), link, max);
}

/** Jira has no reliable prefill URL across project types — the create screen
 *  needs numeric project and issue-type ids — so Tier 1 opens the create
 *  dialog on the host's own site and the markdown goes on the clipboard. */
export function jiraCreateUrl(site: string): string | null {
  const s = normalizeJiraSite(site);
  return s ? `${s}/secure/CreateIssue!default.jspa` : null;
}

export const NOTION_NEW_URL = "https://www.notion.so/new";
