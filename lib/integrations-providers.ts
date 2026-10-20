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
export type TargetList = { targets: Target[]; note?: string; unchecked?: number };
/** Called the moment each item exists on the other side (created or
 *  updated), so a push that fails partway has already remembered what it
 *  made, and a retry updates those instead of creating duplicates. */
export type RecordItem = (item: PushedItem) => Promise<void> | void;

export type ErrorExtra = {
  /** GitHub's x-accepted-github-permissions header, e.g. "issues=write". */
  accepted?: string;
  /** A provider error code (Notion's `code`, Linear's extension type). */
  code?: string;
  rateLimited?: boolean;
  /** The message is already plain English for the host; show it as is. */
  friendly?: boolean;
};

export class ProviderError extends Error {
  status: number;
  accepted?: string;
  code?: string;
  rateLimited?: boolean;
  friendly?: boolean;
  constructor(status: number, message: string, extra: ErrorExtra = {}) {
    super(message); this.status = status;
    this.accepted = extra.accepted; this.code = extra.code; this.rateLimited = extra.rateLimited; this.friendly = extra.friendly;
  }
}
const friendly = (status: number, message: string) => new ProviderError(status, message, { friendly: true });

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

async function call(ctx: Ctx, url: string, init: RequestInit): Promise<{ status: number; json: any; headers: Headers }> {
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
    throw new ProviderError(r.status, sanitize(m), {
      accepted: r.headers.get("x-accepted-github-permissions") || undefined,
      code: typeof json?.code === "string" ? json.code : undefined,
      rateLimited: r.headers.get("x-ratelimit-remaining") === "0" || r.status === 429,
    });
  }
  return { status: r.status, json, headers: r.headers };
}

const authMsg = (status: number, what: string) =>
  status === 401 || status === 403 ? `${what} refused the credentials (${status}). Check the token and its permissions.` : "";

/** Run `fn` over `xs` with at most `n` in flight; results keep their order. */
async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  const worker = async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]); } };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, worker));
  return out;
}

// ── plain-English permission errors ───────────────────────────────────────

const GH_PERM_NAMES: Record<string, string> = {
  issues: "Issues", metadata: "Metadata", contents: "Contents", pull_requests: "Pull requests",
  administration: "Administration", projects: "Projects",
};

/** "issues=write" → "Issues: Read and write". GitHub separates alternative
 *  permission sets with ";" and the permissions inside one set with ",";
 *  the set that mentions Issues is the one worth showing. */
export function githubPermissionText(accepted: string): string {
  const sets = String(accepted || "").split(";").map((x) => x.trim()).filter(Boolean);
  const set = sets.find((x) => /\bissues=/.test(x)) || sets[0] || "issues=write";
  return set.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [k, v = "read"] = x.split("=");
    const name = GH_PERM_NAMES[k] || k.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
    return `${name}: ${v === "write" ? "Read and write" : v === "admin" ? "Admin" : "Read-only"}`;
  }).join(" and ");
}

/** Turn a provider's 401 / 403 / 404 into what to do about it. `target` is
 *  the repo, team, project or page the call was about, when there was one. */
export function explainError(provider: Provider, e: any, target = ""): any {
  if (!(e instanceof ProviderError) || e.friendly) return e;
  const s = e.status;
  if (provider === "github") {
    if (s === 401) return friendly(401, "GitHub refused this token (401). It may have expired or been revoked. Disconnect, then connect a new one.");
    if (e.rateLimited) return friendly(429, "GitHub's rate limit for this token is used up. Try again in a few minutes.");
    if (s === 403) {
      const need = githubPermissionText(e.accepted || "issues=write");
      return friendly(403, `This token needs ${need}${target ? ` on ${target}` : ""}. On GitHub: Settings → Developer settings → Personal access tokens → this token → Repository permissions.`);
    }
    if (s === 404 && target) return friendly(404, `This token can't see ${target}. Add it under Repository access on the token's settings page (a classic token needs the repo scope), and check the name.`);
    if (s === 410 && target) return friendly(410, `Issues are turned off on ${target}. Turn them on in the repo's Settings → General → Features.`);
    return e;
  }
  if (provider === "linear") {
    if (s === 401) return friendly(401, "Linear refused this API key (401). It may have been revoked. Disconnect, then connect a new one.");
    if (s === 403) return friendly(403, "This Linear API key isn't allowed to create issues in that team. In Linear: Settings → Security & access → Personal API keys, give the key write access to the team.");
    if (s === 404 && target) return friendly(404, "This Linear API key can't see that team. Check the key's team access, or pick another team.");
    return e;
  }
  if (provider === "jira") {
    if (s === 401) return friendly(401, "Jira refused the email and API token (401). Check both, or make a new token at id.atlassian.com → Security → API tokens.");
    if (s === 403) return friendly(403, `Your Jira account can't create issues${target ? ` in ${target}` : ""}. A Jira admin needs to give you the Create issues permission in that project.`);
    if (s === 404 && target) return friendly(404, `Jira can't find project ${target}, or your account can't see it.`);
    return e;
  }
  // notion
  if (s === 401) return friendly(401, "Notion refused this integration token (401). It may have been regenerated. Disconnect, then connect the new one.");
  if (s === 403 || e.code === "restricted_resource") return friendly(403, "This Notion integration isn't allowed to add content. At notion.so/my-integrations, turn on Insert content under Capabilities.");
  if (s === 404 || e.code === "object_not_found") return friendly(404, "Notion can't see that page. Open it in Notion, click ••• → Connections, and add your integration.");
  return e;
}

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

/** Fine-grained tokens can't be asked what they may do, so each repo is
 *  probed with an issue POST that has no title. GitHub checks permission
 *  first: 403/404 means no access, 422 ("title wasn't supplied") means this
 *  token could create an issue there. Nothing is ever created. Bounded to
 *  the most recently updated repos so one click costs a fixed number of
 *  calls. */
export const GITHUB_PROBE_MAX = 30;
const GITHUB_PROBE_CONCURRENCY = 6;

async function githubCanCreate(api: ReturnType<typeof gh>, full: string): Promise<boolean> {
  try {
    await api("POST", `/repos/${full}/issues`, {});
    return true;
  } catch (e: any) {
    if (!(e instanceof ProviderError)) return false;
    if (e.status === 401) throw e;
    if (e.status === 422) return true;
    if (e.status === 403 || e.status === 404 || e.status === 410) return false;
    return true; // a hiccup isn't proof of no access; the push will say so if it is
  }
}

async function githubTargets(ctx: Ctx, token: string): Promise<TargetList> {
  const api = gh(ctx, token);
  const { json, headers } = await api("GET", "/user/repos?per_page=100&sort=updated");
  const repos = (Array.isArray(json) ? json : []).filter((r: any) => r && r.full_name && r.has_issues !== false && !r.archived);
  const label = (r: any) => `${r.full_name}${r.private ? " (private)" : ""}`;
  const scopeHeader = headers.get("x-oauth-scopes");
  if (!token.startsWith("github_pat_") && scopeHeader !== null) {
    // Classic token: its scopes are on every response.
    const scopes = scopeHeader.split(",").map((x) => x.trim());
    const usable = repos.filter((r: any) => scopes.includes("repo") || (!r.private && scopes.includes("public_repo")));
    return { targets: usable.map((r: any) => ({ id: String(r.full_name), label: label(r) })) };
  }
  const checked = repos.slice(0, GITHUB_PROBE_MAX);
  const can = await mapLimit(checked, GITHUB_PROBE_CONCURRENCY, (r: any) => githubCanCreate(api, String(r.full_name)));
  const unchecked = repos.length - checked.length;
  return {
    targets: checked.filter((_: any, i: number) => can[i]).map((r: any) => ({ id: String(r.full_name), label: label(r) })),
    unchecked,
    note: unchecked ? `Only the ${GITHUB_PROBE_MAX} most recently updated repos were checked. To use another one, type it as owner/repo.` : undefined,
  };
}

const github = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "github" }>) {
    const { json } = await gh(ctx, c.token)("GET", "/user");
    const t = await githubTargets(ctx, c.token);
    if (!t.targets.length && !t.unchecked) {
      throw friendly(403, c.token.startsWith("github_pat_")
        ? "This token can't create issues in any repository. On GitHub, open the token's settings, add the repo under Repository access, and set Issues to Read and write."
        : "This token can't create issues in any repository. A classic token needs the repo scope (or public_repo for public repos).");
    }
    return { label: String(json?.login || "GitHub user") };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "github" }>): Promise<TargetList> {
    return githubTargets(ctx, c.token);
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "github" }>, target: string, plan: ExportPlan, existing: Record<string, ExistingRef>, record?: RecordItem): Promise<PushResult> {
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
    const epicPushed: PushedItem = { key: "epic", action: epic.action, id: String(epic.number), url: epic.url, title: epicItem.title };
    await record?.(epicPushed);
    // A parent made on this push (first push, or the old one was deleted)
    // has no sub-issues yet, so every story gets linked to it, including
    // ones that already existed and were only updated.
    const freshParent = epic.action === "created";
    let relinkFailed = 0;
    const refs: ChildRef[] = [];
    for (const it of plan.items.slice(1)) {
      const r = await upsert(it.key, it.title, storyMarkdown(it.story!, `#${epic.number}`, plan.backlink, GITHUB_BODY_MAX));
      const pushed: PushedItem = { key: it.key, action: r.action, id: String(r.number), url: r.url, title: it.title };
      await record?.(pushed);
      refs.push({ title: it.title, ref: `#${r.number}`, url: r.url });
      items.push(pushed);
      if (r.action === "created" || freshParent) {
        // Native sub-issues where the repo supports them; the checklist in
        // the parent body works everywhere, so a refusal for a new story is
        // fine. An existing story may still point at a deleted parent, so
        // it is moved over with replace_parent.
        const link = r.action === "created" ? { sub_issue_id: r.id } : { sub_issue_id: r.id, replace_parent: true };
        try { await api("POST", `${p}/${epic.number}/sub_issues`, link); } catch { if (r.action !== "created") relinkFailed++; }
      }
    }
    if (relinkFailed) warnings.push(`Couldn't link ${relinkFailed} existing stor${relinkFailed === 1 ? "y" : "ies"} as sub-issues of the new PRD issue; its checklist still lists them.`);
    if (refs.length) await api("PATCH", `${p}/${epic.number}`, githubIssuePayload(epicItem.title, parentMarkdown(plan, refs, GITHUB_BODY_MAX, true)));
    items.unshift(epicPushed);
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
    const text = `${type} ${e?.message || ""}`;
    const status = /forbidden|permission|not allowed|insufficient/i.test(text) ? 403
      : /auth/i.test(type) ? 401 : /not.?found|entity/i.test(text) ? 404 : 400;
    throw new ProviderError(status, sanitize(e?.extensions?.userPresentableMessage || e?.message || "Linear refused the request."), { code: type || undefined });
  }
  return json?.data;
}

const ISSUE_FIELDS = "success issue { id identifier url }";
const linear = {
  async verify(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>) {
    const d = await lgql(ctx, c.token, "query { viewer { name email } teams(first: 1) { nodes { id } } }");
    if (!(d?.teams?.nodes || []).length) throw friendly(403, "This Linear API key can't see any teams. In Linear: Settings → Security & access → Personal API keys, give it access to at least one team.");
    return { label: String(d?.viewer?.name || d?.viewer?.email || "Linear user") };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>): Promise<TargetList> {
    const d = await lgql(ctx, c.token, "query { teams(first: 100) { nodes { id key name } } }");
    return { targets: (d?.teams?.nodes || []).map((t: any) => ({ id: String(t.id), label: `${t.name} (${t.key})` })) };
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "linear" }>, teamId: string, plan: ExportPlan, existing: Record<string, ExistingRef>, record?: RecordItem): Promise<PushResult> {
    const warnings: string[] = [];
    let freshParent = false;
    const upsert = async (key: string, title: string, description: string, parentId?: string) => {
      const prev = existing[key];
      if (prev?.external_id) {
        try {
          // A story whose parent was just recreated is moved under the new one.
          const input: Record<string, string> = { title: linearIssueInput(teamId, title, description).title, description };
          if (parentId && freshParent) input.parentId = parentId;
          const d = await lgql(ctx, c.token, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { ${ISSUE_FIELDS} } }`,
            { id: prev.external_id, input });
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
    freshParent = epic.action === "created";
    items.push({ key: "epic", action: epic.action, id: String(epic.id), url: String(epic.url), title: epicItem.title });
    await record?.(items[0]);
    for (const it of plan.items.slice(1)) {
      const r = await upsert(it.key, it.title, storyMarkdown(it.story!, String(epic.identifier || ""), plan.backlink, LINEAR_BODY_MAX), String(epic.id));
      const pushed: PushedItem = { key: it.key, action: r.action, id: String(r.id), url: String(r.url), title: it.title };
      items.push(pushed);
      await record?.(pushed);
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
    const api = jr(ctx, c);
    const { json } = await api("GET", "/rest/api/3/myself");
    // Without a project, Jira answers whether the account can create issues
    // in at least one project on the site.
    let canCreate = true;
    try {
      const { json: mp } = await api("GET", "/rest/api/3/mypermissions?permissions=CREATE_ISSUES");
      if (mp?.permissions?.CREATE_ISSUES && mp.permissions.CREATE_ISSUES.havePermission === false) canCreate = false;
    } catch (e: any) { if (e instanceof ProviderError && e.status === 401) throw e; /* older sites: don't block on the check */ }
    if (!canCreate) throw friendly(403, "Your Jira account can't create issues in any project on this site. A Jira admin needs to give you the Create issues permission.");
    return { label: String(json?.displayName || json?.emailAddress || c.email) };
  },
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>): Promise<TargetList> {
    // action=create lists only the projects this account can create issues in.
    const { json } = await jr(ctx, c)("GET", "/rest/api/3/project/search?maxResults=100&action=create");
    return { targets: (json?.values || []).map((p: any) => ({ id: String(p.key), label: `${p.name} (${p.key})` })) };
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "jira" }>, projectKey: string, plan: ExportPlan, existing: Record<string, ExistingRef>, record?: RecordItem): Promise<PushResult> {
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
    let freshParent = false;
    const upsert = async (key: string, fields: any) => {
      const prev = existing[key];
      if (prev?.external_id) {
        try {
          const update: any = { summary: fields.summary, description: fields.description };
          // A story whose Epic was just recreated is moved under the new one.
          if (fields.parent && freshParent) update.parent = fields.parent;
          await api("PUT", `/rest/api/3/issue/${encodeURIComponent(prev.external_id)}`, { fields: update });
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
    freshParent = epic.action === "created";
    const items: PushedItem[] = [{ key: "epic", action: epic.action, id: epic.key, url: browse(epic.key), title: epicItem.title }];
    await record?.(items[0]);
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
      const pushed: PushedItem = { key: it.key, action: r.action, id: r.key, url: browse(r.key), title: it.title };
      items.push(pushed);
      await record?.(pushed);
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
  async targets(ctx: Ctx, c: Extract<Creds, { provider: "notion" }>): Promise<TargetList> {
    const { json } = await nt(ctx, c.token)("POST", "/search", { filter: { property: "object", value: "page" }, page_size: 50 });
    return { targets: (json?.results || []).filter((p: any) => p?.object === "page" && !p.archived).map((p: any) => ({ id: String(p.id), label: notionTitle(p) })) };
  },
  async push(ctx: Ctx, c: Extract<Creds, { provider: "notion" }>, parentId: string, plan: ExportPlan, existing: Record<string, ExistingRef>, record?: RecordItem): Promise<PushResult> {
    const api = nt(ctx, c.token);
    const warnings: string[] = [];
    const prev = existing.epic;
    const { title, blocks } = mdToNotionBlocks(plan.markdown, plan.backlink);
    const { json: page } = await api("POST", "/pages", {
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: "text", text: { content: clip(title || plan.title, 200) } }] } },
      children: blocks.slice(0, 100),
    });
    try {
      for (let i = 100; i < blocks.length; i += 100) {
        await api("PATCH", `/blocks/${page.id}/children`, { children: blocks.slice(i, i + 100) });
      }
    } catch (e) {
      // Half a page is worse than none: move it to the trash so a retry
      // doesn't leave it beside the previous export.
      try { await api("PATCH", `/pages/${page.id}`, { archived: true }); } catch { /* best effort */ }
      throw e;
    }
    const pushed: PushedItem = { key: "epic", action: prev?.external_id ? "replaced" : "created", id: String(page.id), url: String(page.url || ""), title: title || plan.title };
    // Remembered before the old page is trashed: if that step fails, a
    // retry replaces THIS page instead of writing yet another one.
    await record?.(pushed);
    // Notion can't swap a page's content in one call, so a re-push writes a
    // fresh page FIRST and only then moves the previous export to Notion's
    // trash (restorable) — a failed push never loses the old one.
    let replaced = false;
    if (prev?.external_id && prev.external_id !== String(page.id)) {
      try { await api("PATCH", `/pages/${prev.external_id}`, { archived: true }); replaced = true; }
      catch { warnings.push("Couldn't move the previous export to Notion's trash; you may want to delete it by hand."); }
    }
    if (replaced) warnings.push("The previous export was moved to Notion's trash and replaced.");
    return { items: [{ ...pushed, action: replaced ? "replaced" : "created" }], warnings };
  },
};

export const PROVIDER_API: Record<Provider, {
  verify: (ctx: Ctx, c: any) => Promise<{ label: string }>;
  targets: (ctx: Ctx, c: any) => Promise<TargetList>;
  push: (ctx: Ctx, c: any, target: string, plan: ExportPlan, existing: Record<string, ExistingRef>, record?: RecordItem) => Promise<PushResult>;
}> = { github, linear, jira, notion };

export { authMsg };
