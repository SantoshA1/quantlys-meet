// In-memory GitHub / Linear / Jira / Notion, just enough of each API for the
// PRD export suites. Used two ways: as an injected `fetch` in
// lib/integrations-providers.test.mjs, and behind a local HTTP server in the
// e2e run (INTEGRATIONS_TEST_API_BASE). Nothing here touches the network.
//
// Paths are the providers' real ones, prefixed with /<provider>.

export const TOKENS = {
  github: "github_pat_" + "T".repeat(40),
  linear: "lin_api_" + "L".repeat(40),
  notion: "ntn_" + "N".repeat(40),
  jiraEmail: "me@acme.test",
  jira: "ATATT" + "J".repeat(40),
};
export const LINEAR_TEAM = "0f8f6c9a-1111-4a5b-9c9d-123456789abc";
export const NOTION_PARENT = "01234567-89ab-cdef-0123-456789abcdef";

export function makeTrackers() {
  const s = {
    gh: { issues: new Map(), next: 1, subs: [] },
    lin: { issues: new Map(), next: 1 },
    jira: { issues: new Map(), next: 1 },
    notion: { pages: new Map(), next: 1 },
    calls: [],
  };
  const res = (status, json) => ({ status, json });
  function handle(method, url, headers, bodyText) {
    const u = new URL(url);
    const path = u.pathname;
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = bodyText ? JSON.parse(bodyText) : null;
    s.calls.push({ method, path, body });
    let m;
    if (path.startsWith("/github/")) {
      if (h.authorization !== `Bearer ${TOKENS.github}`) return res(401, { message: "Bad credentials" });
      const p = path.slice(7);
      if (method === "GET" && p === "/user") return res(200, { login: "santosh" });
      if (method === "GET" && p === "/user/repos") return res(200, [{ full_name: "acme/app", private: true, has_issues: true }, { full_name: "acme/old", archived: true }]);
      if ((m = p.match(/^\/repos\/acme\/app\/issues$/)) && method === "POST") {
        const n = s.gh.next++;
        const it = { id: 1000 + n, number: n, title: body.title, body: body.body, html_url: `https://github.com/acme/app/issues/${n}` };
        s.gh.issues.set(n, it); return res(201, it);
      }
      if ((m = p.match(/^\/repos\/acme\/app\/issues\/(\d+)$/)) && method === "PATCH") {
        const it = s.gh.issues.get(Number(m[1]));
        if (!it) return res(404, { message: "Not Found" });
        Object.assign(it, body); return res(200, it);
      }
      if ((m = p.match(/^\/repos\/acme\/app\/issues\/(\d+)\/sub_issues$/)) && method === "POST") { s.gh.subs.push([Number(m[1]), body.sub_issue_id]); return res(201, {}); }
      if (p.startsWith("/repos/")) return res(404, { message: "Not Found" });
      return res(404, { message: "Not Found" });
    }
    if (path === "/linear/graphql") {
      if (h.authorization !== TOKENS.linear) return res(200, { errors: [{ message: "Authentication required", extensions: { type: "authentication error" } }] });
      const q = String(body.query || ""), v = body.variables || {};
      if (q.includes("viewer")) return res(200, { data: { viewer: { name: "Santosh", email: "s@x.test" } } });
      if (q.includes("teams")) return res(200, { data: { teams: { nodes: [{ id: LINEAR_TEAM, key: "ENG", name: "Engineering" }] } } });
      if (q.includes("issueCreate")) {
        if (v.input.teamId !== LINEAR_TEAM) return res(200, { errors: [{ message: "Entity not found: Team" }] });
        if (v.input.parentId && !s.lin.issues.has(v.input.parentId)) return res(200, { errors: [{ message: "Entity not found: parent" }] });
        const n = s.lin.next++;
        const id = `lin-${n}`;
        const it = { id, identifier: `ENG-${n}`, url: `https://linear.app/acme/issue/ENG-${n}`, ...v.input };
        s.lin.issues.set(id, it);
        return res(200, { data: { issueCreate: { success: true, issue: { id, identifier: it.identifier, url: it.url } } } });
      }
      if (q.includes("issueUpdate")) {
        const it = s.lin.issues.get(v.id);
        if (!it) return res(200, { errors: [{ message: "Entity not found: Issue", extensions: { type: "invalid input" } }] });
        Object.assign(it, v.input);
        return res(200, { data: { issueUpdate: { success: true, issue: { id: it.id, identifier: it.identifier, url: it.url } } } });
      }
      return res(400, { errors: [{ message: "unknown" }] });
    }
    if (path.startsWith("/jira/")) {
      const want = "Basic " + Buffer.from(`${TOKENS.jiraEmail}:${TOKENS.jira}`).toString("base64");
      if (h.authorization !== want) return res(401, { errorMessages: ["Client must be authenticated"] });
      const p = path.slice(5);
      if (p === "/rest/api/3/myself") return res(200, { displayName: "Santosh A" });
      if (p === "/rest/api/3/project/search") return res(200, { values: [{ id: "10000", key: "ENG", name: "Engineering" }] });
      if (p === "/rest/api/3/issue/createmeta/ENG/issuetypes") return res(200, { issueTypes: [{ id: "1", name: "Epic" }, { id: "2", name: "Story" }, { id: "3", name: "Sub-task", subtask: true }] });
      if (p === "/rest/api/3/issue" && method === "POST") {
        const f = body.fields;
        if (!f?.description || f.description.type !== "doc") return res(400, { errors: { description: "ADF required" } });
        if (f.parent && !s.jira.issues.has(f.parent.key)) return res(400, { errors: { parent: "bad parent" } });
        const key = `ENG-${s.jira.next++}`;
        s.jira.issues.set(key, { key, ...f }); return res(201, { id: String(s.jira.next), key });
      }
      if ((m = p.match(/^\/rest\/api\/3\/issue\/(ENG-\d+)$/)) && method === "PUT") {
        const it = s.jira.issues.get(m[1]);
        if (!it) return res(404, { errorMessages: ["Issue does not exist"] });
        Object.assign(it, body.fields); return { status: 204, json: null };
      }
      return res(404, { errorMessages: ["nope"] });
    }
    if (path.startsWith("/notion/v1/")) {
      if (h.authorization !== `Bearer ${TOKENS.notion}` || !h["notion-version"]) return res(401, { message: "API token is invalid." });
      const p = path.slice(10);
      if (p === "/users/me") return res(200, { name: "QM export", bot: { workspace_name: "Acme" } });
      if (p === "/search") return res(200, { results: [{ object: "page", id: NOTION_PARENT, properties: { title: { type: "title", title: [{ plain_text: "Roadmap" }] } } }] });
      if (p === "/pages" && method === "POST") {
        if (body.parent?.page_id !== NOTION_PARENT) return res(404, { message: "Could not find page" });
        if ((body.children || []).length > 100) return res(400, { message: "children too long" });
        const id = `0000000${s.notion.next++}-aaaa-bbbb-cccc-dddddddddddd`.slice(-36);
        s.notion.pages.set(id, { id, title: body.properties.title.title[0].text.content, blocks: [...body.children], archived: false });
        return res(200, { id, url: `https://www.notion.so/${id.replace(/-/g, "")}` });
      }
      if ((m = p.match(/^\/blocks\/([^/]+)\/children$/)) && method === "PATCH") {
        const pg = s.notion.pages.get(m[1]);
        if (!pg) return res(404, { message: "nope" });
        if (body.children.length > 100) return res(400, { message: "children too long" });
        pg.blocks.push(...body.children); return res(200, {});
      }
      if ((m = p.match(/^\/pages\/([^/]+)$/)) && method === "PATCH") {
        const pg = s.notion.pages.get(m[1]);
        if (!pg) return res(404, { message: "nope" });
        Object.assign(pg, body); return res(200, { id: pg.id });
      }
      return res(404, { message: "nope" });
    }
    return res(404, { message: "unknown host path" });
  }
  const fetch = async (url, init = {}) => {
    const r = handle(init.method || "GET", String(url), init.headers, init.body);
    return new Response(r.json === null ? null : JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { state: s, handle, fetch };
}
