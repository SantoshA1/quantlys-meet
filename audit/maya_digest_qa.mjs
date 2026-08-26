/**
 * MAYA QA — the weekly digest.
 *
 * Maya asks: "I pressed Email me this week's digest and it said nothing is
 * open, so there is nothing to send. Is that broken, or did I just finish
 * everything?"
 *
 * FIELD 2026-08-26, checked against the live database: every action item in
 * the whole product was `status = done`. So the sentence was TRUE — and it
 * read like a failure, and it read identically to the case where nothing had
 * ever been captured. Three situations, one sentence, no way to tell which.
 *
 * Deterministic + offline, driving the REAL handler in
 * app/api/digest/weekly/route.ts. Run: node audit/maya_digest_qa.mjs
 */
import { register } from "node:module";
register("./alias.mjs", import.meta.url);

const { CLOUD, reset, fakeFetch } = await import("./fake-cloud.mjs");

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
globalThis.fetch = fakeFetch;

const { POST } = await import("../app/api/digest/weekly/route.ts");

const RESULTS = [];
class AssertErr extends Error { constructor(m) { super(m); this.name = "AssertErr"; } }
const _a = (c, m) => { if (!c) throw new AssertErr(m); };
async function check(tid, name, fn) {
  try { await fn(); RESULTS.push([tid, name, "PASS", ""]); }
  catch (e) { RESULTS.push([tid, name, "FAIL", String(e?.message).slice(0, 170)]); }
}

const post = (qs = "preview=1") =>
  POST(new Request(`http://localhost/api/digest/weekly?${qs}`, {
    method: "POST",
    headers: { authorization: "Bearer good" },
  }));

const item = (id, over) => ({
  id, user_id: "u1", room_name: "qm-aaa", meeting_title: "Standup", project: "Quantlys",
  text: "Kiran to finish the billing cutover", owner: "Kiran", ts_seconds: 60,
  status: "open", met_at: new Date().toISOString(), video_path: "u1/qm-aaa/v.webm", ...over,
});

await check("DG-01", "everything ticked off is GOOD NEWS, and says so", async () => {
  reset();
  CLOUD.rows.action_items = [item("1", { status: "done" }), item("2", { status: "done" })];
  const j = await (await post()).json();
  _a(j.reason === "all-done", `state was ${j.reason}`);
  _a(/working, not failing/.test(j.message),
     "THE FIELD REPORT: finishing your work is not an error, and the old sentence made the good outcome read like a broken feature");
  _a(/2 action items/.test(j.message), "…and counts what you actually got done");
});

await check("DG-02", "nothing ever captured is a different problem, with a different answer", async () => {
  reset();
  CLOUD.rows.action_items = [];
  const j = await (await post()).json();
  _a(j.reason === "none-at-all", `state was ${j.reason}`);
  _a(/record a meeting/i.test(j.message), "this is the only one of the three that is a setup problem, and it says what to do");
});

await check("DG-03", "an item carried forward from weeks ago still sends", async () => {
  reset();
  const long_ago = new Date(Date.now() - 40 * 86400000).toISOString();
  CLOUD.rows.action_items = [item("1", { met_at: long_ago })];
  const r = await post();
  const body = await r.text();
  _a(/billing cutover/.test(body),
     "carrying old commitments forward IS the digest — a summary tells you what a meeting was about, a digest tells you what is still owed");
});

await check("DG-04", "AN ITEM FROM A MEETING I HOST COUNTS, EVEN IF A COLLEAGUE RECORDED IT", async () => {
  reset();
  CLOUD.meetings = [{ room_name: "qm-aaa", created_by: "u1" }];
  // Filed under the person who pressed Record, which is how action_items are
  // keyed — in the field that meant a host's own commitments were invisible.
  CLOUD.rows.action_items = [item("1", { user_id: "u2-colleague" })];
  // A successful preview renders the digest itself, so the proof is that the
  // colleague's item is IN it — stronger than a count.
  const body = await (await post()).text();
  _a(/billing cutover/.test(body),
     "the item a colleague recorded, from a meeting I host, is in MY digest. In the field this was invisible: action_items are keyed by whoever pressed Record");
  _a(/Kiran/.test(body), "…with the person who owes it");
});

await check("DG-05", "…but an item from somebody else's meeting does not", async () => {
  reset();
  CLOUD.meetings = [{ room_name: "qm-aaa", created_by: "u1" }];
  CLOUD.rows.action_items = [item("1", { user_id: "u2-colleague", room_name: "qm-not-mine" })];
  const j = await (await post()).json();
  _a(j.open === 0,
     "NEGATIVE CONTROL: reading by MEETING must not become reading everybody's commitments");
});

await check("DG-06", "an item is not counted twice when it is both mine and from my room", async () => {
  reset();
  CLOUD.meetings = [{ room_name: "qm-aaa", created_by: "u1" }];
  CLOUD.rows.action_items = [item("1")];   // matches BOTH reads: user_id u1 and room qm-aaa
  const body = await (await post()).text();
  const hits = (body.match(/billing cutover/g) || []).length;
  _a(hits === 1, `merged by id — appears once, got ${hits}. Two reads that both match must not double an item`);
});

await check("DG-07", "signed out is refused", async () => {
  reset();
  const r = await POST(new Request("http://localhost/api/digest/weekly?preview=1", { method: "POST" }));
  _a(r.status !== 200 || !(await r.json()).sent, "no session, no digest");
});

console.log("=".repeat(78));
console.log("  MAYA QA — the weekly digest");
console.log("=".repeat(78));
let passed = 0;
for (const [tid, name, status, detail] of RESULTS) {
  console.log(`  ${status === "PASS" ? "PASS" : "FAIL"}  ${tid}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (status === "PASS") passed++;
}
console.log("-".repeat(78));
console.log(`  ${passed}/${RESULTS.length} PASS`);
process.exit(passed === RESULTS.length ? 0 : 1);
