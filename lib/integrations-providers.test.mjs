/**
 * GUARD — PRD export against fake GitHub / Linear / Jira / Notion.
 * Idempotency, nesting, deleted-item recovery, auth errors, fixed hosts.
 * Run: node --experimental-strip-types lib/integrations-providers.test.mjs
 */
import { PROVIDER_API, ProviderError, sanitize } from "./integrations-providers.ts";
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
ok((await PROVIDER_API.github.targets(ctx, creds.github)).map((t) => t.id).join() === "acme/app", "GitHub repos, archived hidden");
ok((await PROVIDER_API.linear.targets(ctx, creds.linear))[0].id === LINEAR_TEAM, "Linear teams");
ok((await PROVIDER_API.jira.targets(ctx, creds.jira))[0].id === "ENG", "Jira projects");
ok((await PROVIDER_API.notion.targets(ctx, creds.notion))[0].label === "Roadmap", "Notion pages");
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
