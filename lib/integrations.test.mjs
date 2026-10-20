/**
 * GUARD — PRD export mappers + validation + Tier 1 links.
 * Run: node --experimental-strip-types lib/integrations.test.mjs
 */
import {
  parseMarkdown, inlineSpans, extractPrd, checklistify, buildPlan, previewPlan, parentMarkdown, storyMarkdown, replaceStorySection, dropTitle,
  githubIssuePayload, linearIssueInput, mdToAdf, jiraIssueFields, mdToNotionBlocks, notionRichText,
  parseRepo, normalizeJiraSite, isJiraProjectKey, normalizeNotionId, acceptCreds, acceptTarget,
  githubNewIssueUrl, linearNewIssueUrl, jiraCreateUrl, fitUrl, truncateBody, URL_MAX, MAX_CHILDREN, safeHref,
} from "./integrations.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const PRD = `# PRD — Self-serve plan change

## Problem

Admins email support to change plans. **Finance** can't see \`proration\`.

## User stories

- As an admin, I can preview the next invoice before I confirm.
  - Preview matches the invoice within $0.01
  - Shows proration line by line
- As finance, I can see who changed a plan.
- TBD

## Acceptance criteria

- Every plan change writes an audit row.
- Max → Free is blocked and routes to [support](https://example.com/support).

## Open

- EU VAT on proration — parked.

---

## Build-ready: 6 of 8 · score 0.75
`;

// ── parsing ──
const blocks = parseMarkdown(PRD);
ok(blocks[0].t === "h" && blocks[0].level === 1, "first block is the H1");
ok(blocks.some((b) => b.t === "li" && b.depth === 1 && /\$0\.01/.test(b.text)), "nested bullets keep their depth");
ok(blocks.some((b) => b.t === "hr"), "--- is a rule");
const code = parseMarkdown("```mermaid\ngraph TD\n# not a heading\n```\n");
ok(code.length === 1 && code[0].t === "code" && code[0].lang === "mermaid" && code[0].text.includes("# not a heading"), "fenced code is one block and hides markdown inside it");
const sp = inlineSpans("a **b** _c_ `d` [e](https://x.io) [f](javascript:alert(1))");
ok(sp.find((s) => s.bold)?.text === "b" && sp.find((s) => s.italic)?.text === "c" && sp.find((s) => s.code)?.text === "d", "inline bold/italic/code");
ok(sp.find((s) => s.text === "e")?.href === "https://x.io/" && !sp.find((s) => s.text === "f")?.href, "only http(s) links survive; javascript: is dropped");
ok(safeHref("data:text/html,x") === "" && safeHref("https://a.b/c") === "https://a.b/c", "safeHref allows http(s) only");

// ── extraction ──
const parts = extractPrd(PRD, "billing");
ok(parts.title === "PRD — Self-serve plan change", "title from the H1");
ok(parts.stories.length === 2, "two real stories; TBD skipped");
ok(parts.stories[0].criteria.length === 2 && parts.stories[1].criteria.length === 0, "nested bullets are that story's criteria");
ok(parts.criteria.length === 2 && parts.criteria[1].includes("support"), "PRD-wide acceptance criteria collected as plain text");
const H3 = `# PRD\n\n## User Stories\n\n### US-1: Export to GitHub\n\nAs a host, I can push the PRD to a repo.\n\n#### Acceptance criteria\n\n- One parent issue\n- Re-push updates\n\n### US-2: Linear\n\n- As a PM, I can push to Linear.\n- Sub-issues per story\n\n## Non-goals\n\n- Jira server\n`;
const p2 = extractPrd(H3);
ok(p2.stories.length === 2 && p2.stories[0].title === "Export to GitHub", "### stories with the US-1 prefix trimmed");
ok(p2.stories[0].text.startsWith("As a host") && p2.stories[0].criteria.length === 2, "story text + its own criteria under ####");
ok(p2.stories[1].text.startsWith("As a PM") && p2.stories[1].criteria[0] === "Sub-issues per story", "bulleted 'As a…' becomes text, other bullets criteria");
ok(!p2.stories.some((s) => /jira/i.test(s.title)), "the next ## section ends the stories");
ok(extractPrd("no headings at all", "Proj").title === "PRD — Proj" && extractPrd("").stories.length === 0, "a PRD without structure still exports as one item");

// ── checklist ──
const cl = checklistify(PRD);
ok(cl.includes("- [ ] Every plan change writes an audit row.") && cl.includes("- As finance"), "only acceptance bullets become checkboxes");
ok(!checklistify("## Acceptance\n\n- [x] done").includes("[ ] [x]"), "existing checkboxes are left alone");

// ── plan + preview ──
const link = "https://quantlys-meeting.com/prd/abcdef0123456789abcdef01";
const plan = buildPlan({ project: "billing", markdown: PRD, backlink: link, children: true });
ok(plan.items.length === 3 && plan.items[0].key === "epic" && plan.items[2].key === "story:2", "one parent + one child per story, stable keys");
ok(buildPlan({ project: "b", markdown: PRD, backlink: link, children: false }).items.length === 1, "children off → parent only");
const many = "# P\n\n## User stories\n\n" + Array.from({ length: 30 }, (_, i) => `- As user ${i}, I can do ${i}.`).join("\n");
const big = buildPlan({ project: "b", markdown: many, backlink: link, children: true });
ok(big.items.length === MAX_CHILDREN + 1 && big.droppedStories === 5, "children capped at 25, and the cut is counted");
const pv = previewPlan(plan, { epic: { external_id: "7", external_url: "https://github.com/a/b/issues/7" }, "story:9": { external_id: "9", external_url: "" } }, "github");
ok(pv.items[0].action === "update" && pv.items[1].action === "create" && pv.untouched[0] === "story:9", "preview: update what exists, create the rest, report leftovers");
ok(previewPlan(plan, {}, "notion").items.length === 1 && previewPlan(plan, {}, "notion").items[0].kind === "page", "Notion is one page");

// ── GitHub / Linear bodies ──
const parent = parentMarkdown(plan, [{ title: "Story: x", ref: "#12", url: "" }], 65000, true);
ok(parent.includes("- [ ] #12 x") && parent.includes(link) && parent.includes("- [ ] Every plan change"), "parent: PRD + checklist of child issues + backlink");
const st = storyMarkdown(plan.parts.stories[0], "#5", link, 65000);
ok(st.includes("- [ ] Preview matches") && st.includes("Part of #5"), "child: criteria as a checklist, linked to the parent");
ok(storyMarkdown(plan.parts.stories[1], "#5", link, 65000).includes("see the checklist in the parent"), "a story with no own criteria points at the parent's");
const huge = buildPlan({ project: "b", markdown: "# T\n\n" + "line of text\n".repeat(10000), backlink: link, children: false });
const hb = parentMarkdown(huge, [], 65000, true);
ok(hb.length <= 65000 && hb.includes("truncated") && hb.includes(link), "over GitHub's body limit → cut with a link to the full PRD");
ok(githubIssuePayload("a\nb".repeat(200), "x").title.length <= 256 && !githubIssuePayload("a\nb", "x").title.includes("\n"), "GitHub title one line, ≤256");
const li = linearIssueInput("team", "T", "D", "parent-id");
ok(li.teamId === "team" && li.parentId === "parent-id" && li.description === "D", "Linear input carries team, parent, markdown description");
ok(!("parentId" in linearIssueInput("team", "T", "D")), "no parentId on the top issue");
ok(truncateBody("short", 100, link) === "short", "short bodies untouched");

// ── Jira ADF ──
const adf = mdToAdf(PRD);
ok(adf.type === "doc" && adf.version === 1, "ADF doc v1");
const types = JSON.stringify(adf);
ok(types.includes('"heading"') && types.includes('"bulletList"') && types.includes('"rule"'), "headings, lists and rules map to ADF nodes");
const firstList = adf.content.find((n) => n.type === "bulletList");
ok(firstList.content[0].content.some((n) => n.type === "bulletList"), "nested bullets nest inside the list item");
ok(types.includes('"strong"') && types.includes('"code"') && types.includes('"link"') && types.includes("https://example.com/support"), "bold/code/link marks");
ok(types.includes("☐ Every plan change"), "acceptance criteria read as a checklist");
ok(!JSON.stringify(mdToAdf("")).includes('"text":""'), "no empty text nodes (Jira rejects them)");
const jf = jiraIssueFields({ projectKey: "ENG", issueTypeId: "10001", summary: "x".repeat(400), markdown: PRD, link, parentKey: "ENG-1" });
ok(jf.project.key === "ENG" && jf.issuetype.id === "10001" && jf.summary.length <= 255 && jf.parent.key === "ENG-1" && jf.description.type === "doc", "Jira fields: project, type, ≤255 summary, parent, ADF");
const ord = mdToAdf("1. one\n2. two\n- bullet");
ok(ord.content[0].type === "orderedList" && ord.content[0].content.length === 2 && ord.content[1].type === "bulletList", "ordered vs bullet lists split");

// ── Notion blocks ──
const nb = mdToNotionBlocks(PRD, link);
ok(nb.title === "PRD — Self-serve plan change" && !nb.blocks.some((b) => b.type === "heading_1" && /Self-serve/.test(JSON.stringify(b))), "H1 → page title, not repeated in the body");
ok(nb.blocks[0].type === "callout" && JSON.stringify(nb.blocks[0]).includes(link), "callout with the link back up top");
ok(nb.blocks.filter((b) => b.type === "to_do").length === 2, "criteria → to-do blocks");
const story0 = nb.blocks.find((b) => b.type === "bulleted_list_item" && JSON.stringify(b).includes("preview the next invoice"));
ok(story0 && story0.bulleted_list_item.children?.length === 2, "one level of nesting kept");
ok(notionRichText("x".repeat(4500)).length === 3 && notionRichText("x".repeat(4500)).every((r) => r.text.content.length <= 2000), "rich text split at Notion's 2000-char limit");
ok(nb.blocks.some((b) => b.type === "divider") && nb.blocks.some((b) => b.type === "heading_2"), "dividers and H2s");

// ── validation ──
ok(parseRepo("SantoshA1/quantlys-meet")?.full === "SantoshA1/quantlys-meet" && parseRepo("https://github.com/a/b.git")?.full === "a/b", "repos: owner/name or a github.com URL");
ok(!parseRepo("a/b/c") && !parseRepo("../x") && !parseRepo("a/..") && !parseRepo("-a/b") && !parseRepo("a b/c") && !parseRepo("https://evil.com/a/b"), "bad repo names refused");
ok(normalizeJiraSite("acme.atlassian.net") === "https://acme.atlassian.net" && normalizeJiraSite("https://ACME.atlassian.net/jira/software") === "https://acme.atlassian.net", "Jira site → canonical https origin");
for (const bad of ["http://acme.atlassian.net", "https://atlassian.net", "https://acme.atlassian.net.evil.com", "https://evil.com/?x=acme.atlassian.net", "https://acme.atlassian.net:8443", "https://u:p@acme.atlassian.net", "https://169.254.169.254", "https://localhost", "file:///etc/passwd", "https://a_b.atlassian.net"]) {
  ok(normalizeJiraSite(bad) === null, `SSRF guard refuses ${bad}`);
}
ok(isJiraProjectKey("ENG") && !isJiraProjectKey("eng") && !isJiraProjectKey("E") && !isJiraProjectKey("ENG-1"), "Jira project keys");
ok(normalizeNotionId("https://www.notion.so/team/Roadmap-0123456789abcdef0123456789abcdef") === "01234567-89ab-cdef-0123-456789abcdef", "Notion id from a notion.so URL");
ok(normalizeNotionId("https://evil.com/0123456789abcdef0123456789abcdef") === null && normalizeNotionId("nope") === null, "non-Notion URLs and junk refused");
ok(acceptCreds("github", { token: "github_pat_" + "a".repeat(40) }).ok && !acceptCreds("github", { token: "hunter2" }).ok, "GitHub token shape");
ok(acceptCreds("linear", { token: "lin_api_" + "a".repeat(40) }).ok && !acceptCreds("linear", { token: "x" }).ok, "Linear key shape");
ok(acceptCreds("notion", { token: "ntn_" + "a".repeat(40) }).ok && !acceptCreds("notion", { token: "ntn_" }).ok, "Notion token shape");
const jc = acceptCreds("jira", { site: "acme.atlassian.net", email: "me@acme.com", token: "ATATT3xFfGF0" + "a".repeat(30) });
ok(jc.ok && jc.creds.site === "https://acme.atlassian.net", "Jira creds normalise the site");
ok(!acceptCreds("jira", { site: "https://evil.com", email: "me@acme.com", token: "a".repeat(30) }).ok, "Jira creds refuse a non-Atlassian site");
ok(!acceptCreds("jira", { site: "acme.atlassian.net", email: "nope", token: "a".repeat(30) }).ok, "Jira creds need an email");
ok(!acceptCreds("slack", { token: "x" }).ok, "unknown providers refused");
ok(acceptTarget("linear", "0f8f6c9a-1111-4a5b-9c9d-123456789abc") && !acceptTarget("linear", "ENG"), "Linear target is a team uuid");
ok(acceptTarget("jira", "eng") === "ENG" && acceptTarget("github", "a/b") === "a/b" && !acceptTarget("github", "a"), "targets canonicalised");

// ── Tier 1 links ──
const gu = githubNewIssueUrl("SantoshA1/quantlys-meet", "PRD — X", PRD, link);
ok(gu.startsWith("https://github.com/SantoshA1/quantlys-meet/issues/new?title=") && gu.includes("&body="), "GitHub prefilled new-issue URL");
ok(decodeURIComponent(gu.split("&body=")[1]).includes("- [ ] Every plan change"), "…with criteria as checkboxes");
ok(githubNewIssueUrl("not a repo", "t", PRD, link) === null, "no URL for a bad repo");
const longMd = "# T\n\n" + "## Section\n\nSome words here and there.\n\n".repeat(800);
const lu = linearNewIssueUrl("T", longMd, link);
ok(lu.length <= URL_MAX && lu.startsWith("https://linear.app/new?title=") && decodeURIComponent(lu).includes("truncated. Full PRD: " + link), "Linear URL fits 8 KB and points back to the full PRD");
const gl = githubNewIssueUrl("a/b", "T", longMd, link);
ok(gl.length <= URL_MAX && decodeURIComponent(gl).includes(link), "GitHub URL fits too");
ok(fitUrl((b) => "u?" + encodeURIComponent(b), "é".repeat(5000), "L", 1000).length <= 1000, "fitting measures the ENCODED length (multi-byte safe)");
ok(jiraCreateUrl("acme.atlassian.net") === "https://acme.atlassian.net/secure/CreateIssue!default.jspa" && jiraCreateUrl("evil.com") === null, "Jira create link only on *.atlassian.net");

// ── v1.2.1: the parent lists each story once ──
{
  const md = "# T\n\n## User Stories\n\n### US-1: Export\n\nAs a host, I can push.\n\n#### Acceptance criteria\n\n- One parent\n\n### US-2: Linear\n\n- As a PM, I can push to Linear.\n\n## Non-goals\n\n- Jira server\n";
  const out = replaceStorySection(md, ["- [ ] #2 Export", "- [ ] #3 Linear"]);
  ok(out === "# T\n\n## User Stories\n\n- [ ] #2 Export\n- [ ] #3 Linear\n\n## Non-goals\n\n- Jira server\n", "story section (with ### stories and #### criteria) swapped for the linked list; the next ## section kept");
  ok(replaceStorySection("# T\n\n## Goals\n\n- x\n", ["- [ ] #2 y"]) === null, "no story section → null");
  ok(replaceStorySection("# T\n\n```md\n## User stories\n```\n\n## User stories\n\n- a\n", ["- [ ] #2 a"]).startsWith("# T\n\n```md\n## User stories\n```"), "a heading inside a code fence is not the section");
  ok(replaceStorySection("# T\n\n## User stories\n\n- a", ["- [ ] #2 a"]) === "# T\n\n## User stories\n\n- [ ] #2 a", "story section at the end of the PRD");
  const p1 = buildPlan({ project: "p", markdown: md, backlink: link, children: true });
  const body = parentMarkdown(p1, [{ title: "Story: Export", ref: "#2", url: "" }, { title: "Story: Linear", ref: "#3", url: "" }], 65000, true);
  ok(!body.includes("As a host, I can push.") && !body.includes("## Stories") && body.includes("## User Stories\n\n- [ ] #2 Export"), "parentMarkdown: no second story list, no extra Stories section");
  ok(parentMarkdown(p1, [], 65000, true).includes("As a host, I can push."), "before the stories exist, the PRD is shown as written");
  const noSection = buildPlan({ project: "p", markdown: "# T\n\nJust text.\n", backlink: link, children: true });
  ok(parentMarkdown(noSection, [{ title: "Story: x", ref: "#9", url: "" }], 65000, true).includes("## Stories\n\n- [ ] #9 x"), "a PRD without a story section still gets the checklist appended");
  const many = buildPlan({ project: "p", markdown: "# T\n\n## User stories\n\n" + Array.from({ length: 27 }, (_, i) => `- As user ${i}, I can do ${i}.`).join("\n"), backlink: link, children: true });
  const mb = parentMarkdown(many, many.items.slice(1).map((it, i) => ({ title: it.title, ref: `#${i + 2}`, url: "" })), 65000, true);
  ok(mb.includes("_2 more stories are in the full PRD (limit 25 per push)._"), "stories over the 25 cap are pointed at, not silently dropped");
}

// ── v1.2.1: the H1 is the issue title, so the body doesn't repeat it ──
ok(dropTitle("# PRD: X\n\n## Summary\n\nHi") === "## Summary\n\nHi", "dropTitle removes the H1 and the blank lines after it");
ok(dropTitle("Intro\n\n# Title\nBody") === "Intro\n\nBody", "…wherever the first H1 is");
ok(dropTitle("```\n# not a title\n```\n\n## A") === "```\n# not a title\n```\n\n## A", "…but not a # line inside a code fence");
ok(dropTitle("## Only H2\n\ntext") === "## Only H2\n\ntext", "no H1 → unchanged");
ok(!parentMarkdown(buildPlan({ project: "p", markdown: "# T1\n\nBody", backlink: link, children: false }), [], 65000, false).includes("# T1"), "parentMarkdown leaves the title out");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
