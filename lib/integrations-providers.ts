// The HTTP half of PRD export: GitHub, Linear, Jira Cloud, Notion.
//
// Every call is SERVER-SIDE with the host's own credentials, so the browser
// never holds a token after it is saved and the CSP needs no new origins.
// Outbound hosts are fixed per provider; the only host a person can choose
// is a Jira site, and lib/integrations.ts only accepts *.atlassian.net.
// Redirects are refused, so a provider can't bounce a request elsewhere.
//
// `fetch` is injected so the suites can run every provider against a mock.

import {
  type Creds, type ExportPlan, type ExistingRef, type Provider, type ChildRef,
  parseRepo, parentMarkdown, storyMarkdown, githubIssuePayload, linearIssueInput,
  jiraIssueFields, mdToNotionBlocks, GITHUB_BODY_MAX, LINEAR_BODY_MAX, clip,
} from "./integrations.ts";

export type Fetch = typeof fetch;
export type Ctx = { fetch: Fetch; testBase?: string; timeoutMs?: number };
export type Target = { id: string; label: string };
export type PushedItem = { key: string; action: "created" | "updated" | "replaced"; id: string; url: string; title: string };
export type PushResult = { items: PushedItem[]; warnings: string[] };

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Never let a provider's error text carry anything that looks like a key. */
export function sanitize(msg: any): string {
  return clip(String(msg || "")
    .replace(/(github_pat_|ghp_|lin_api_|ntn_|secret_)[A-Za-z0-9_]+/g, "$1***")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic ***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\s+/g, " ").trim(), 220);
}

function base(ctx: Ctx, provider: Provider, real: string): string {
  return ctx.testBase ? `${ctx.testBase.replace(/\/$/, "")}/${provider}` : real;
}

async function call(ctx: Ctx, url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  let r: Response;
  try {
    r = await ctx.fetch(url, {
      ...init, redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 20_000),
    } as RequestInit);
  } catch (e: any) {
    throw new ProviderError(502, e?.name === "TimeoutError" ? "The service took too long to answer." : "Couldn't reach the service.");
  }
  const text = await r.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) {
    const m = json?.message || json?.errorMessages?.[0] || (json?.errors && typeof json.errors === "object" ? Object.values(json.errors)[0] : "") || json?.error || `HTTP ${r.status}`;
    throw new ProviderError(r.status, sanitize(m));
  }
  return { status: r.status, json };
}

const authMsg = (status: number, what: string) =>
  status === 401 || status === 403 ? `${what} refused the credentials (${status}). Check the token and its permissions.` : "";

// ── GitHub ────────────────────────────────────────────────────────────────

function gh(ctx: Ctx, token: string) {
  const root = base(ctx, "github", "https://api.github.com");
  const headers = {
    Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "quantlys-meeting",
  };
  return (method: string, path: string, body?: any) =>
    call(ctx, `${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const github = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "github" }>) {
    const { json } = await gh(ctx, c.token)("GET", "/user");
    return { label: String(json?.login || "GitHub user") };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "github" }>): Promise<Target[]> {
    const { json } = await gh(ctx, c.token)("GET", "/user/repos?per_page=100&sort=updated");
    return (Array.isArray(json) ? json : [])
      .filter((r: any) => r && r.full_name && r.has_issues !== false && !r.archived)
      .map((r: any) => ({ id: String(r.full_name), label: `${r.full_name}${r.private ? " (private)" : ""}` }));
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "github" }>, target: string, plan: ExportPlan, existing: Record<string, ExistingRef>): Promise<PushResult> {
    const repo = parseRepo(target);
    if (!repo) throw new ProviderError(400, "Pick a repository as owner/name.");
    const api = gh(ctx, c.token);
    const p = `/repos/${repo.owner}/${repo.repo}/issues`;
    const warnings: string[] = [];
    const upsert = async (key: string, title: string, body: string) => {
      const prev = existing[key];
      if (prev && /^\d+$/.test(prev.external_id)) {
        try {
          const { json } = await api("PATCH", `${p}/${prev.external_id}`, githubIssuePayload(title, body));
          return { action: "updated" as const, number: Number(json.number), id: Number(json.id), url: String(json.html_url) };
        } catch (e: any) {
          if (!(e instanceof ProviderError) || (e.status !== 404 && e.status !== 410)) throw e;
          warnings.push(`${key === "epic" ? "The PRD issue" : title} was deleted on GitHub, so it was created again.`);
        }
      }
      const { json } = await api("POST", p, githubIssuePayload(title, body));
      return { action: "created" as const, number: Number(json.number), id: Number(json.id), url: String(json.html_url) };
    };
    const items: PushedItem[] = [];
    const epicItem = plan.items[0];
    const epic = await upsert("epic", epicItem.title, parentMarkdown(plan, [], GITHUB_BODY_MAX, true));
    const refs: ChildRef[] = [];
    for (const it of plan.items.slice(1)) {
      const r = await upsert(it.key, it.title, storyMarkdown(it.story!, `#${epic.number}`, plan.backlink, GITHUB_BODY_MAX));
      refs.push({ title: it.title, ref: `#${r.number}`, url: r.url });
      items.push({ key: it.key, action: r.action, id: String(r.number), url: r.url, title: it.title });
      if (r.action === "created") {
        // Native sub-issues where the repo supports them; the checklist in
        // the parent body works everywhere, so a refusal here is fine.
        try { await api("POST", `${p}/${epic.number}/sub_issues`, { sub_issue_id: r.id }); } catch { /* optional */ }
      }
    }
    if (refs.length) await api("PATCH", `${p}/${epic.number}`, githubIssuePayload(epicItem.title, parentMarkdown(plan, refs, GITHUB_BODY_MAX, true)));
    items.unshift({ key: "epic", action: epic.action, id: String(epic.number), url: epic.url, title: epicItem.title });
    return { items, warnings };
  },
};

// ── Linear ────────────────────────────────────────────────────────────────

async function lgql(ctx: Ctx, token: string, query: string, variables: any = {}) {
  const url = base(ctx, "linear", "https://api.linear.app") + "/graphql";
  const { json } = await call(ctx, url, {
    method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (json?.errors?.length) {
    const e = json.errors[0];
    const type = String(e?.extensions?.type || e?.extensions?.code || "");
    const status = /auth/i.test(type) ? 401 : /not.?found|entity/i.test(`${type} ${e?.message}`) ? 404 : 400;
    throw new ProviderError(status, sanitize(e?.extensions?.userPresentableMessage || e?.message || "Linear refused the request."));
  }
  return json?.data;
}

const ISSUE_FIELDS = "success issue { id identifier url }";
const linear = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>) {
    const d = await lgql(ctx, c.token, "query { viewer { name email } }");
    return { label: String(d?.viewer?.name || d?.viewer?.email || "Linear user") };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>): Promise<Target[]> {
    const d = await lgql(ctx, c.token, "query { teams(first: 100) { nodes { id key name } } }");
    return (d?.teams?.nodes || []).map((t: any) => ({ id: String(t.id), label: `${t.name} (${t.key})` }));
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>, teamId: string, plan: ExportPlan, existing: Record<string, ExistingRef>): Promise<PushResult> {
    const warnings: string[] = [];
    const upsert = async (key: string, title: string, description: string, parentId?: string) => {
      const prev = existing[key];
      if (prev?.external_id) {
        try {
          const d = await lgql(ctx, c.token, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { ${ISSUE_FIELDS} } }`,
            { id: prev.external_id, input: { title: linearIssueInput(teamId, title, description).title, description } });
          if (d?.issueUpdate?.success && d.issueUpdate.issue) return { action: "updated" as const, ...d.issueUpdate.issue };
        } catch (e: any) {
          if (!(e instanceof ProviderError) || e.status !== 404) throw e;
          warnings.push(`${title} was deleted in Linear, so it was created again.`);
        }
      }
      const d = await lgql(ctx, c.token, `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { ${ISSUE_FIELDS} } }`,
        { input: linearIssueInput(teamId, title, description, parentId) });
      if (!d?.issueCreate?.success || !d.issueCreate.issue) throw new ProviderError(502, "Linear didn't create the issue.");
      return { action: "created" as const, ...d.issueCreate.issue };
    };
    const items: PushedItem[] = [];
    const epicItem = plan.items[0];
    const epic = await upsert("epic", epicItem.title, parentMarkdown(plan, [], LINEAR_BODY_MAX, false));
    items.push({ key: "epic", action: epic.action, id: String(epic.id), url: String(epic.url), title: epicItem.title });
    for (const it of plan.items.slice(1)) {
      const r = await upsert(it.key, it.title, storyMarkdown(it.story!, String(epic.identifier || ""), plan.backlink, LINEAR_BODY_MAX), String(epic.id));
      items.push({ key: it.key, action: r.action, id: String(r.id), url: String(r.url), title: it.title });
    }
    return { items, warnings };
  },
};

// ── Jira Cloud ────────────────────────────────────────────────────────────

function jr(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>) {
  const root = ctx.testBase ? base(ctx, "jira", "") : c.site;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`,
    Accept: "application/json", "Content-Type": "application/json",
  };
  return (method: string, path: string, body?: any) =>
    call(ctx, `${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const jira = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>) {
    const { json } = await jr(ctx, c)("GET", "/rest/api/3/myself");
    return { label: String(json?.displayName || json?.emailAddress || c.email) };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>): Promise<Target[]> {
    const { json } = await jr(ctx, c)("GET", "/rest/api/3/project/search?maxResults=100");
    return (json?.values || []).map((p: any) => ({ id: String(p.key), label: `${p.name} (${p.key})` }));
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>, projectKey: string, plan: ExportPlan, existing: Record<string, ExistingRef>): Promise<PushResult> {
    const api = jr(ctx, c);
    const warnings: string[] = [];
    const { json: tm } = await api("GET", `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`);
    const types: any[] = (tm?.issueTypes || tm?.values || []).filter((t: any) => t && !t.subtask);
    const byName = (re: RegExp) => types.find((t) => re.test(String(t.name || "")));
    const story = byName(/^story$/i) || byName(/^task$/i) || types[0];
    if (!story) throw new ProviderError(400, "That Jira project has no issue type this can create.");
    let epicType = byName(/^epic$/i);
    const browse = (key: string) => `${c.site}/browse/${key}`;
    const create = async (fields: any) => (await api("POST", "/rest/api/3/issue", { fields })).json;
    const upsert = async (key: string, fields: any) => {
      const prev = existing[key];
      if (prev?.external_id) {
        try {
          await api("PUT", `/rest/api/3/issue/${encodeURIComponent(prev.external_id)}`, { fields: { summary: fields.summary, description: fields.description } });
          return { action: "updated" as const, key: prev.external_id };
        } catch (e: any) {
          if (!(e instanceof ProviderError) || e.status !== 404) throw e;
          warnings.push(`${fields.summary} was deleted in Jira, so it was created again.`);
        }
      }
      return { action: "created" as const, key: String((await create(fields)).key) };
    };
    const epicItem = plan.items[0];
    const parentFields = (typeId: string) => jiraIssueFields({
      projectKey, issueTypeId: typeId, summary: epicItem.title,
      markdown: parentMarkdown(plan, [], 1e9, false), link: plan.backlink,
    });
    let epic;
    try {
      epic = await upsert("epic", parentFields(String((epicType || story).id)));
    } catch (e: any) {
      // Older company-managed projects make Epic Name required; fall back.
      if (!(e instanceof ProviderError) || e.status !== 400 || !epicType) throw e;
      warnings.push("Jira refused an Epic here, so the PRD went in as a Story.");
      epicType = undefined;
      epic = await upsert("epic", parentFields(String(story.id)));
    }
    const items: PushedItem[] = [{ key: "epic", action: epic.action, id: epic.key, url: browse(epic.key), title: epicItem.title }];
    let linkParent = !!epicType;
    if (!epicType && plan.items.length > 1) warnings.push("This project has no Epic type, so stories are not nested under the PRD issue.");
    for (const it of plan.items.slice(1)) {
      const fields = jiraIssueFields({
        projectKey, issueTypeId: String(story.id), summary: it.title,
        markdown: storyMarkdown(it.story!, epic.key, plan.backlink, 1e9), link: plan.backlink,
        parentKey: linkParent ? epic.key : undefined,
      });
      let r;
      try { r = await upsert(it.key, fields); } catch (e: any) {
        if (!(e instanceof ProviderError) || e.status !== 400 || !fields.parent) throw e;
        linkParent = false;
        warnings.push("Jira wouldn't nest stories under the PRD issue here; they were created unlinked.");
        delete fields.parent;
        r = await upsert(it.key, fields);
      }
      items.push({ key: it.key, action: r.action, id: r.key, url: browse(r.key), title: it.title });
    }
    return { items, warnings };
  },
};

// ── Notion ────────────────────────────────────────────────────────────────

function nt(ctx: Ctx, token: string) {
  const root = base(ctx, "notion", "https://api.notion.com") + "/v1";
  const headers = { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
  return (method: string, path: string, body?: any) =>
    call(ctx, `${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function notionTitle(page: any): string {
  const props = page?.properties || {};
  for (const k of Object.keys(props)) {
    if (props[k]?.type === "title") return (props[k].title || []).map((t: any) => t?.plain_text || "").join("") || "Untitled";
  }
  return "Untitled";
}

const notion = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "notion" }>) {
    const { json } = await nt(ctx, c.token)("GET", "/users/me");
    return { label: String(json?.name || json?.bot?.workspace_name || "Notion integration") };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "notion" }>): Promise<Target[]> {
    const { json } = await nt(ctx, c.token)("POST", "/search", { filter: { property: "object", value: "page" }, page_size: 50 });
    return (json?.results || []).filter((p: any) => p?.object === "page" && !p.archived).map((p: any) => ({ id: String(p.id), label: notionTitle(p) }));
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "notion" }>, parentId: string, plan: ExportPlan, existing: Record<string, ExistingRef>): Promise<PushResult> {
    const api = nt(ctx, c.token);
    const warnings: string[] = [];
    const prev = existing.epic;
    const { title, blocks } = mdToNotionBlocks(plan.markdown, plan.backlink);
    const { json: page } = await api("POST", "/pages", {
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: "text", text: { content: clip(title || plan.title, 200) } }] } },
      children: blocks.slice(0, 100),
    });
    for (let i = 100; i < blocks.length; i += 100) {
      await api("PATCH", `/blocks/${page.id}/children`, { children: blocks.slice(i, i + 100) });
    }
    // Notion can't swap a page's content in one call, so a re-push writes a
    // fresh page FIRST and only then moves the previous export to Notion's
    // trash (restorable) — a failed push never loses the old one.
    let replaced = false;
    if (prev?.external_id && prev.external_id !== String(page.id)) {
      try { await api("PATCH", `/pages/${prev.external_id}`, { archived: true }); replaced = true; }
      catch { warnings.push("Couldn't move the previous export to Notion's trash; you may want to delete it by hand."); }
    }
    if (replaced) warnings.push("The previous export was moved to Notion's trash and replaced.");
    return { items: [{ key: "epic", action: replaced ? "replaced" : "created", id: String(page.id), url: String(page.url || ""), title: title || plan.title }], warnings };
  },
};

export const PROVIDER_API: Record<Provider, {
  verify: (ctx: Ctx, c: any) => Promise<{ label: string }>;
  targets: (ctx: Ctx, c: any) => Promise<Target[]>;
  push: (ctx: Ctx, c: any, target: string, plan: ExportPlan, existing: Record<string, ExistingRef>) => Promise<PushResult>;
}> = { github, linear, jira, notion };

export { authMsg };
