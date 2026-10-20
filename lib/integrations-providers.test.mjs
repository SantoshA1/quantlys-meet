/**
 * GUARD — PRD export against fake GitHub / Linear / Jira / Notion.
 * Idempotency, nesting, deleted-item recovery, auth errors, fixed hosts.
 * Run: node --experimental-strip-types lib/integrations-providers.test.mjs
 */
import { PROVIDER_API, ProviderError, sanitize, explainError, githubPermissionText, GITHUB_PROBE_MAX } from "./integrations-providers.ts";
import { buildPlan } from "./integrations.ts";
import { makeTrackers, TOKENS, LINEAR_TEAM, NOTION_PARENT } from "../audit/fake-trackers.mjs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const PRD = `# PRD — Billing\n\n## User stories\n\n- As an admin, I can preview the invoice.\n  - Matches within $0.01\n- As finance, I can audit changes.\n\n## Acceptance criteria\n\n- Audit row per change\n\n` +
  Array.from({ length: 130 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
const link = "https://quantlys-meeting.com/prd/abcdef0123456789abcdef01";
const plan = buildPlan({ project: "billing", markdown: PRD, backlink: link, children: true });
const asExisting = (items) => Object.fromEntries(items.map((i) => [i.key, { external_id: i.id, external_url: i.url }]));
const T = makeTrackers();
const ctx = { fetch: T.fetch, testBase: "http://mock" };
const creds = {
  github: { provider: "github", token: TOKENS.github },
  linear: { provider: "linear", token: TOKENS.linear },
  jira: { provider: "jira", site: "https://acme.atlassian.net", email: TOKENS.jiraEmail, token: TOKENS.jira },
  notion: { provider: "notion", token: TOKENS.notion },
};

// ── verify + targets ──
ok((await PROVIDER_API.github.verify(ctx, creds.github)).label === "santosh", "GitHub verify → login");
ok((await PROVIDER_API.github.targets(ctx, creds.github)).targets.map((t) => t.id).join() === "acme/app", "GitHub repos: archived hidden, only repos this token can create issues in");
ok((await PROVIDER_API.linear.targets(ctx, creds.linear)).targets[0].id === LINEAR_TEAM, "Linear teams");
ok((await PROVIDER_API.jira.targets(ctx, creds.jira)).targets[0].id === "ENG", "Jira projects");
ok((await PROVIDER_API.notion.targets(ctx, creds.notion)).targets[0].label === "Roadmap", "Notion pages");
for (const p of ["github", "linear", "jira", "notion"]) {
  let e = null;
  try { await PROVIDER_API[p].verify(ctx, { ...creds[p], token: creds[p].token.slice(0, -2) + "xx" }); } catch (x) { e = x; }
  ok(e instanceof ProviderError && e.status === 401, `${p}: a wrong token is a 401, not a crash`);
}

// ── GitHub ──
const g1 = await PROVIDER_API.github.push(ctx, creds.github, "acme/app", plan, {});
ok(g1.items.length === 3 && g1.items.every((i) => i.action === "created"), "GitHub: parent + 2 stories created");
const epic = T.state.gh.issues.get(Number(g1.items[0].id));
ok(epic.body.includes(`- [ ] #${g1.items[1].id}`) && epic.body.includes("- [ ] Audit row per change"), "GitHub parent lists child issues + criteria as checklists");
ok(T.state.gh.issues.get(Number(g1.items[1].id)).body.includes("- [ ] Matches within $0.01") && T.state.gh.issues.get(Number(g1.items[1].id)).body.includes(`Part of #${g1.items[0].id}`), "GitHub child: own criteria + Part of #parent");
ok(T.state.gh.subs.length === 2, "GitHub: native sub-issue link attempted for new children");
const before = T.state.gh.issues.size;
const g2 = await PROVIDER_API.github.push(ctx, creds.github, "acme/app", plan, asExisting(g1.items));
ok(T.state.gh.issues.size === before && g2.items.every((i) => i.action === "updated"), "GitHub re-push updates, no duplicates");
T.state.gh.issues.delete(Number(g1.items[2].id));
const g3 = await PROVIDER_API.github.push(ctx, creds.github, "acme/app", plan, asExisting(g2.items));
ok(g3.items[2].action === "created" && g3.warnings.length === 1, "GitHub: a child deleted upstream is recreated, with a warning");
let ge = null; try { await PROVIDER_API.github.push(ctx, creds.github, "../x", plan, {}); } catch (e) { ge = e; }
ok(ge instanceof ProviderError && ge.status === 400, "GitHub refuses a bad repo before any call");

// ── Linear ──
const l1 = await PROVIDER_API.linear.push(ctx, creds.linear, LINEAR_TEAM, plan, {});
ok(l1.items.length === 3 && T.state.lin.issues.get(l1.items[1].id).parentId === l1.items[0].id, "Linear: parent + sub-issues via parentId");
ok(T.state.lin.issues.get(l1.items[0].id).description.includes("- [ ] Audit row"), "Linear description is markdown with a checklist");
const l2 = await PROVIDER_API.linear.push(ctx, creds.linear, LINEAR_TEAM, plan, asExisting(l1.items));
ok(T.state.lin.issues.size === 3 && l2.items.every((i) => i.action === "updated"), "Linear re-push updates in place");

// ── Jira ──
const j1 = await PROVIDER_API.jira.push(ctx, creds.jira, "ENG", plan, {});
ok(j1.items.length === 3 && T.state.jira.issues.get(j1.items[0].id).issuetype.id === "1", "Jira: PRD as an Epic");
ok(T.state.jira.issues.get(j1.items[1].id).issuetype.id === "2" && T.state.jira.issues.get(j1.items[1].id).parent.key === j1.items[0].id, "Jira: Stories under the Epic");
ok(j1.items[0].url === `https://acme.atlassian.net/browse/${j1.items[0].id}`, "Jira links point at the host's own site");
ok(T.state.jira.issues.get(j1.items[0].id).description.type === "doc", "Jira description is ADF");
const j2 = await PROVIDER_API.jira.push(ctx, creds.jira, "ENG", plan, asExisting(j1.items));
ok(T.state.jira.issues.size === 3 && j2.items.every((i) => i.action === "updated"), "Jira re-push updates in place");

// ── Notion ──
const n1 = await PROVIDER_API.notion.push(ctx, creds.notion, NOTION_PARENT, plan, {});
const pg = T.state.notion.pages.get(n1.items[0].id);
ok(n1.items.length === 1 && pg.title === "PRD — Billing", "Notion: one page titled from the H1");
ok(pg.blocks.length > 100, "Notion: >100 blocks appended in chunks");
ok(pg.blocks.some((b) => b.type === "to_do"), "Notion: criteria as to-dos");
const n2 = await PROVIDER_API.notion.push(ctx, creds.notion, NOTION_PARENT, plan, asExisting(n1.items));
ok(n2.items[0].action === "replaced" && T.state.notion.pages.get(n1.items[0].id).archived === true && !T.state.notion.pages.get(n2.items[0].id).archived, "Notion re-push: new page first, old one to trash");

// ── fixed hosts, no redirects, no secrets in errors ──
const seen = [];
const spy = async (url, init) => { seen.push({ url: String(url), redirect: init.redirect }); return new Response("{}", { status: 401 }); };
for (const p of ["github", "linear", "jira", "notion"]) { try { await PROVIDER_API[p].verify({ fetch: spy }, creds[p]); } catch { /* expected */ } }
ok(seen[0].url.startsWith("https://api.github.com/") && seen[1].url.startsWith("https://api.linear.app/") && seen[2].url.startsWith("https://acme.atlassian.net/") && seen[3].url.startsWith("https://api.notion.com/"), "real hosts are fixed; Jira goes only to the validated site");
ok(seen.every((s) => s.redirect === "error"), "redirects refused on every call");
ok(!sanitize(`bad ${TOKENS.github} and Basic QUJD and Bearer ${TOKENS.notion}`).match(/T{10}|N{10}|QUJD/), "error text is scrubbed of tokens");

// ════ v1.2.1 ════════════════════════════════════════════════════════════

const fresh = () => { const t = makeTrackers(); return { t, c: { fetch: t.fetch, testBase: "http://mock" } }; };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const ghPosts = (t) => t.state.calls.filter((x) => x.method === "POST" && /\/issues$/.test(x.path)).length;

// ── 1. connect checks access; targets list only repos the token can create issues in ──
{
  const { t, c } = fresh();
  const tl = await PROVIDER_API.github.targets(c, creds.github);
  ok(tl.targets.map((x) => x.id).join() === "acme/app" && !tl.note, "fine-grained: a read-only repo (403) and an unseen one (404) are left out");
  ok(t.state.gh.issues.size === 0, "the access probe never creates an issue");
  ok(t.state.calls.filter((x) => x.method === "POST").every((x) => x.body && !x.body.title), "probes are title-less POSTs (GitHub answers 422 when allowed)");
  t.state.gh.repos.forEach((r) => { if (r.perm === "write") r.perm = "read"; });
  const e = await throws(() => PROVIDER_API.github.verify(c, creds.github));
  ok(e instanceof ProviderError && e.friendly && /Issues to Read and write/.test(e.message), "connect refuses a token that can't create issues anywhere, and says what to change");
}
{
  const { t, c } = fresh();
  t.state.gh.repos = Array.from({ length: 40 }, (_, i) => ({ full_name: `acme/r${i}`, private: true, has_issues: true, perm: "write" }));
  const before = ghPosts(t);
  const tl = await PROVIDER_API.github.targets(c, creds.github);
  ok(tl.targets.length === GITHUB_PROBE_MAX && ghPosts(t) - before === GITHUB_PROBE_MAX && /type it as owner\/repo/.test(tl.note || ""), `probing is capped at ${GITHUB_PROBE_MAX} repos, with a note`);
  t.state.gh.repos.forEach((r) => { r.perm = "read"; });
  ok(!(await throws(() => PROVIDER_API.github.verify(c, creds.github))), "connect doesn't refuse when some repos were left unchecked");
}
{
  const { t, c } = fresh();
  const classic = { provider: "github", token: TOKENS.githubClassic };
  t.state.gh.scopes = "public_repo, read:org";
  ok((await PROVIDER_API.github.targets(c, classic)).targets.map((x) => x.id).join() === "acme/docs,other/public", "classic token with public_repo: public repos only, no probes");
  ok(ghPosts(t) === 0, "classic tokens are judged by their scopes, not probed");
  t.state.gh.scopes = "repo";
  ok((await PROVIDER_API.github.targets(c, classic)).targets.length === 3, "classic token with repo: every live repo");
  t.state.gh.scopes = "read:org";
  const e = await throws(() => PROVIDER_API.github.verify(c, classic));
  ok(e?.friendly && /repo scope/.test(e.message), "classic token without repo scope is refused at connect");
}
{
  const { t, c } = fresh();
  ok((await PROVIDER_API.linear.verify(c, creds.linear)).label === "Santosh", "Linear verify still works with teams in view");
  t.state.lin.teams = [];
  const e = await throws(() => PROVIDER_API.linear.verify(c, creds.linear));
  ok(e?.friendly && /can't see any teams/.test(e.message), "Linear: a key with no team access is refused at connect");
}
{
  const { t, c } = fresh();
  await PROVIDER_API.jira.targets(c, creds.jira);
  ok(t.state.calls.some((x) => x.path === "/jira/rest/api/3/project/search" && /action=create/.test(x.query)), "Jira targets ask only for projects you can create issues in");
  ok((await PROVIDER_API.jira.verify(c, creds.jira)).label === "Santosh A", "Jira verify passes with Create issues");
  t.state.jira.canCreate = false;
  const e = await throws(() => PROVIDER_API.jira.verify(c, creds.jira));
  ok(e?.friendly && /Create issues permission/.test(e.message), "Jira: an account that can't create issues anywhere is refused at connect");
}

// ── 2. plain-English 401 / 403 / 404 ──
ok(githubPermissionText("issues=write") === "Issues: Read and write", "permission header → words");
ok(githubPermissionText("pull_requests=write; contents=read, issues=write") === "Contents: Read-only and Issues: Read and write", "the permission set that mentions Issues is the one shown");
{
  const { c } = fresh();
  const e403 = explainError("github", await throws(() => PROVIDER_API.github.push(c, creds.github, "acme/docs", plan, {})), "acme/docs");
  ok(e403.friendly && e403.message.startsWith("This token needs Issues: Read and write on acme/docs."), "GitHub 403 names the missing permission and the repo (from x-accepted-github-permissions)");
  const e404 = explainError("github", await throws(() => PROVIDER_API.github.push(c, creds.github, "other/public", plan, {})), "other/public");
  ok(e404.friendly && e404.message.startsWith("This token can't see other/public. Add it under Repository access"), "GitHub 404 says to add the repo under Repository access");
  const e401 = explainError("github", await throws(() => PROVIDER_API.github.verify(c, { ...creds.github, token: creds.github.token.slice(0, -2) + "xx" })));
  ok(e401.friendly && /expired or been revoked/.test(e401.message), "GitHub 401 says the token is expired or revoked");
  ok(explainError("github", new ProviderError(403, "API rate limit exceeded", { rateLimited: true })).status === 429, "a rate-limit 403 isn't mistaken for a permission problem");
}
{
  const { t, c } = fresh();
  t.state.faults.push({ path: /^\/linear\/graphql$/, when: (b) => /issueCreate/.test(b.query), status: 200, json: { errors: [{ message: "Forbidden", extensions: { type: "forbidden" } }] } });
  const e = explainError("linear", await throws(() => PROVIDER_API.linear.push(c, creds.linear, LINEAR_TEAM, plan, {})), LINEAR_TEAM);
  ok(e.friendly && e.status === 403 && /write access to the team/.test(e.message), "Linear forbidden → which setting to change");
}
{
  const { t, c } = fresh();
  t.state.faults.push({ method: "POST", path: /^\/jira\/rest\/api\/3\/issue$/, status: 403, json: { errorMessages: ["You do not have permission to create issues in this project."] } });
  const e = explainError("jira", await throws(() => PROVIDER_API.jira.push(c, creds.jira, "ENG", plan, {})), "ENG");
  ok(e.friendly && /can't create issues in ENG/.test(e.message), "Jira 403 names the project and the permission");
  const e404 = explainError("jira", new ProviderError(404, "nope"), "XYZ");
  ok(/can't find project XYZ/.test(e404.message), "Jira 404 names the project");
}
{
  const { c } = fresh();
  const e = explainError("notion", await throws(() => PROVIDER_API.notion.push(c, creds.notion, "11111111-2222-3333-4444-555555555555", plan, {})), "x");
  ok(e.friendly && /Connections, and add your integration/.test(e.message), "Notion 404 says to share the page with the integration");
  ok(/Insert content/.test(explainError("notion", new ProviderError(403, "x", { code: "restricted_resource" })).message), "Notion restricted_resource → turn on Insert content");
}

// ── 3. each item is remembered as it is made; a half-done push doesn't duplicate ──
const collect = () => { const got = {}; return { got, rec: (it) => { got[it.key] = it; } }; };
{
  const { t, c } = fresh();
  t.state.faults.push({ method: "POST", path: /^\/github\/repos\/acme\/app\/issues$/, skip: 2, status: 502, json: { message: "Server Error" } });
  const { got, rec } = collect();
  ok(!!(await throws(() => PROVIDER_API.github.push(c, creds.github, "acme/app", plan, {}, rec))), "GitHub: push fails on the 3rd issue");
  ok(Object.keys(got).join() === "epic,story:1" && t.state.gh.issues.size === 2, "…but the 2 it made were already recorded");
  const r = await PROVIDER_API.github.push(c, creds.github, "acme/app", plan, asExisting(Object.values(got)), rec);
  ok(t.state.gh.issues.size === plan.items.length && r.items.map((i) => i.action).join() === "updated,updated,created", "GitHub retry finishes without duplicates");
}
{
  const { t, c } = fresh();
  t.state.faults.push({ path: /^\/linear\/graphql$/, when: (b) => /issueCreate/.test(b.query), skip: 1, status: 200, json: { errors: [{ message: "Internal error", extensions: { type: "internal" } }] } });
  const { got, rec } = collect();
  await throws(() => PROVIDER_API.linear.push(c, creds.linear, LINEAR_TEAM, plan, {}, rec));
  ok(Object.keys(got).join() === "epic" && t.state.lin.issues.size === 1, "Linear: the parent made before the failure is recorded");
  await PROVIDER_API.linear.push(c, creds.linear, LINEAR_TEAM, plan, asExisting(Object.values(got)), rec);
  ok(t.state.lin.issues.size === plan.items.length, "Linear retry: no duplicate parent");
}
{
  const { t, c } = fresh();
  t.state.faults.push({ method: "POST", path: /^\/jira\/rest\/api\/3\/issue$/, skip: 2, status: 500, json: { errorMessages: ["boom"] } });
  const { got, rec } = collect();
  await throws(() => PROVIDER_API.jira.push(c, creds.jira, "ENG", plan, {}, rec));
  ok(Object.keys(got).join() === "epic,story:1", "Jira: items made before the failure are recorded");
  await PROVIDER_API.jira.push(c, creds.jira, "ENG", plan, asExisting(Object.values(got)), rec);
  ok(t.state.jira.issues.size === plan.items.length, "Jira retry: no duplicates");
}
{
  const { t, c } = fresh();
  const { got, rec } = collect();
  const first = await PROVIDER_API.notion.push(c, creds.notion, NOTION_PARENT, plan, {}, rec);
  ok(got.epic?.id === first.items[0].id, "Notion: the page is recorded once it's complete");
  t.state.faults.push({ method: "PATCH", path: /^\/notion\/v1\/blocks\/.+\/children$/, status: 502, json: { message: "bad gateway" } });
  const before = got.epic.id;
  await throws(() => PROVIDER_API.notion.push(c, creds.notion, NOTION_PARENT, plan, asExisting(Object.values(got)), rec));
  const live = [...t.state.notion.pages.values()].filter((pg) => !pg.archived);
  ok(got.epic.id === before && live.length === 1 && live[0].id === before, "Notion: a half-written page goes to the trash; the previous export stays the one remembered");
}
// ── 4. no duplicate story list in the parent ──
{
  const { t, c } = fresh();
  const r = await PROVIDER_API.github.push(c, creds.github, "acme/app", plan, {});
  const body = t.state.gh.issues.get(Number(r.items[0].id)).body;
  ok((body.match(/As an admin, I can preview the invoice/g) || []).length === 1, "GitHub parent lists each story once");
  ok(body.includes(`- [ ] #${r.items[1].id} As an admin`) && !body.includes("Matches within $0.01"), "…as the linked checklist; story criteria live in the story issue");
  ok(/## User stories\n\n- \[ \] #/.test(body) && body.includes("- [ ] Audit row per change"), "…under the PRD's own User stories heading, with the PRD-wide criteria kept");
}

// ── 5. a recreated parent gets the existing stories back as sub-issues ──
{
  const { t, c } = fresh();
  const g = await PROVIDER_API.github.push(c, creds.github, "acme/app", plan, {});
  t.state.gh.issues.delete(Number(g.items[0].id));
  const r = await PROVIDER_API.github.push(c, creds.github, "acme/app", plan, asExisting(g.items));
  const np = Number(r.items[0].id);
  const kids = t.state.gh.subs.filter(([parent]) => parent === np);
  ok(r.items[0].action === "created" && r.items.slice(1).every((i) => i.action === "updated"), "GitHub: parent recreated, stories updated");
  ok(kids.length === 2 && kids.every(([, , replaced]) => replaced), "GitHub: existing stories relinked as sub-issues of the new parent (replace_parent)");
  ok(t.state.gh.issues.get(Number(r.items[1].id)).body.includes(`Part of #${np}`), "GitHub: stories point at the new parent");
  const again = await PROVIDER_API.github.push(c, creds.github, "acme/app", plan, asExisting(r.items));
  ok(t.state.gh.subs.filter(([parent]) => parent === np).length === 2 && again.warnings.length === 0, "GitHub: a normal re-push doesn't relink again");
}
{
  const { t, c } = fresh();
  const l = await PROVIDER_API.linear.push(c, creds.linear, LINEAR_TEAM, plan, {});
  t.state.lin.issues.delete(l.items[0].id);
  const r = await PROVIDER_API.linear.push(c, creds.linear, LINEAR_TEAM, plan, asExisting(l.items));
  ok(r.items.slice(1).every((i) => t.state.lin.issues.get(i.id).parentId === r.items[0].id), "Linear: existing stories moved under the recreated parent");
}
{
  const { t, c } = fresh();
  const j = await PROVIDER_API.jira.push(c, creds.jira, "ENG", plan, {});
  t.state.jira.issues.delete(j.items[0].id);
  const r = await PROVIDER_API.jira.push(c, creds.jira, "ENG", plan, asExisting(j.items));
  ok(r.items.slice(1).every((i) => t.state.jira.issues.get(i.id).parent?.key === r.items[0].id), "Jira: existing stories moved under the recreated Epic");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
