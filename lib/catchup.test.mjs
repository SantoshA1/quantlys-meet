// node --experimental-strip-types lib/catchup.test.mjs
import { recentTranscript, catchupPrompt, parseCatchup, fallbackCatchup, CATCHUP_WINDOW_MS } from "./catchup.ts";
import { requireRoomToken } from "./room-auth.ts";
import { AccessToken } from "livekit-server-sdk";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };
const log = [
  { id: "1", who: "A", text: "old stuff", final: true, at: 0 },
  { id: "2", who: "B", text: "we ship Friday", final: true, at: 400_000 },
  { id: "3", who: "A", text: "draft", final: false, at: 590_000 },
  { id: "4", who: "A", text: "who owns QA?", final: true, at: 595_000 },
];
const r = recentTranscript(log, 600_000);
ok(!r.includes("old stuff") && r.includes("[06:40] B: we ship Friday") && r.includes("who owns QA?"), "keeps only last 5 min of finals");
ok(!r.includes("draft"), "drops interim captions");
ok(recentTranscript(log, 600_000, CATCHUP_WINDOW_MS * 10).includes("old stuff"), "window is configurable");
ok(catchupPrompt("x").includes("prd_changes") && catchupPrompt("x", { memory: true }).includes("story_changes"), "prompt adapts to session mode");
const p = parseCatchup('```json\n{"summary":"S","decisions":["ship Friday"],"open_questions":["who owns QA?"],"prd_changes":[]}\n```');
ok(p && p.summary === "S" && p.decisions[0] === "ship Friday" && p.open_questions.length === 1, "parses fenced JSON");
ok(parseCatchup('{"summary":"m","story_changes":["a"]}').prd_changes[0] === "a", "maps story_changes");
ok(parseCatchup("not json") === null, "bad answer → null");
ok(parseCatchup(JSON.stringify({ decisions: Array(9).fill("d") })).decisions.length === 5, "lists capped at 5");
ok(fallbackCatchup("").summary.includes("Nothing"), "empty fallback says so");

process.env.LIVEKIT_API_KEY = "devkey"; process.env.LIVEKIT_API_SECRET = "secret".repeat(6);
const mint = async (room) => { const t = new AccessToken("devkey", "secret".repeat(6), { identity: "u" }); t.addGrant({ room, roomJoin: true }); return t.toJwt(); };
const req = (tok) => new Request("https://x/api", { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
ok((await requireRoomToken(req(""), "r1"))?.status === 401, "no room token → 401");
ok((await requireRoomToken(req(await mint("r2")), "r1"))?.status === 403, "token for another room → 403");
ok((await requireRoomToken(req("garbage"), "r1"))?.status === 401, "invalid token → 401");
ok((await requireRoomToken(req(await mint("r1")), "r1")) === null, "valid token for this room passes");
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
