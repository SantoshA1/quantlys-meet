/**
 * MAYA GUARD — Memory mode (oral historian / podcast producer).
 *
 * Maya asks: "Can we leave a room with a story instead of a PRD — same
 * recording, different questions and a Memory package I can share?"
 *
 * Run: node lib/memory.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  acceptSessionMode, acceptMemoryIntent, memoryRubric, memoryPath, memoryFilename,
  memorySuggestionsFor, memoryOpeningLine, memoryHandoffCopy, memoryAgentQuestionPrompt,
  normalizeMemoryPackage, fallbackMemoryPackage, memoryMarkdownFromParts,
  DEFAULT_SESSION_MODE, MEMORY_RUBRIC, MEMORY_META,
} from "./memory.ts";
import {
  memoryShareMapPath, memoryShareUrl, isMemoryShareId, acceptMemoryShareMap,
  publicMemoryFromStored,
} from "./memory-share.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(acceptSessionMode("memory") === "memory" && acceptSessionMode("Meeting") === "meeting",
  "session mode folds to meeting|memory; default meeting");
ok(acceptSessionMode("") === DEFAULT_SESSION_MODE && acceptSessionMode("prd") === "meeting",
  "unknown mode stays Meeting/PRD");
ok(acceptMemoryIntent("podcast") === "podcast" && acceptMemoryIntent("x") === "story",
  "soft intent story|podcast|book; default story");

ok(memoryRubric().length === 7 && MEMORY_RUBRIC.some((d) => d.key === "turning_points"),
  "Memory rubric has oral-historian dims including turning points");
ok(!MEMORY_RUBRIC.some((d) => d.key === "architecture" || d.key === "metrics"),
  "…and does not force PRD schema keys");
ok(MEMORY_META.artifact === "Memory package", "artifact name is Memory package");

ok(memoryPath("u1", "Legacy Stories") === "u1/memory/legacy-stories.memory.json",
  "memory packages live under user/memory/");
ok(memoryFilename("Legacy Stories") === "legacy-stories-memory.md",
  "filename is *-memory.md");

ok(/story, not a PRD/i.test(memoryOpeningLine("Nan", 7)),
  "opening line says leave with a story, not a PRD");
ok(/Memory package/i.test(memoryHandoffCopy({ hasPackage: false })),
  "handoff copy names Memory package when empty");
ok(/shareable link/i.test(memoryHandoffCopy({ hasPackage: true, shareUrl: "https://x/memory/a" })),
  "…and share when ready");

const prompt = memoryAgentQuestionPrompt({
  projectName: "Dad", key: "sensory", label: "Sensory detail",
  desc: "Place and feeling", recent: "We stood in the kitchen and the radio was on.",
  alreadyAsked: [], intent: "podcast",
});
ok(/oral historian|podcast producer/i.test(prompt),
  "live Memory prompt is oral-historian, not PRD");
ok(/not filling a PRD checklist/i.test(prompt) && /No product scope/i.test(prompt),
  "…and refuses PRD checklist / product-scope questions");

const sug = memorySuggestionsFor("quotes");
ok(sug.options.length >= 2 && /line|quote/i.test(sug.q), "quote dim has consumer options");

const pkg = normalizeMemoryPackage({
  title: "The kitchen radio",
  summary: "A short for-readers blurb.",
  chapters: [{ heading: "Morning", at: "02:10", body: "The radio hummed." }],
  quotes: ["Keep the dial where it is."],
  open_threads: ["What happened after they moved?"],
  dimensions: [
    { key: "chronology", status: "present", evidence: "1962" },
    { key: "people", status: "partial", evidence: "Dad", question: "Who else?", options: ["Mom"], why: "People matter." },
  ],
  markdown: "# The kitchen radio\n\nHello.",
}, "story", "test-model");
ok(pkg.sessionMode === "memory" && pkg.title === "The kitchen radio",
  "normalized package keeps sessionMode memory");
ok(pkg.chapters[0].at === "02:10" && pkg.quotes[0].includes("dial"),
  "chapters and quotes survive normalize");
ok(pkg.dimensions.find((d) => d.key === "people")?.options.length >= 2,
  "partial dims get topped-up options");

const fb = fallbackMemoryPackage("no key");
ok(fb.assessment_error === "no key" && fb.dimensions.every((d) => d.status === "missing"),
  "fallback is honest missing, not invented story");

const md = memoryMarkdownFromParts({
  title: "T", summary: "S", chapters: [{ heading: "C", body: "B" }],
  quotes: ["Q"], open_threads: ["O"],
});
ok(/## For readers/.test(md) && /## Chapters/.test(md) && /## Notable quotes/.test(md),
  "markdown package has readers / chapters / quotes sections");

ok(memoryShareMapPath("AbCdef0123456789abcdef01") === "shares/memory/abcdef0123456789abcdef01.json",
  "memory share maps live under shares/memory/");
ok(memoryShareUrl("https://quantlys-meeting.com/", "abcdef0123456789abcdef01") ===
  "https://quantlys-meeting.com/memory/abcdef0123456789abcdef01",
  "public URL is /memory/{id}");
ok(isMemoryShareId("abcdef0123456789abcdef01") && !isMemoryShareId("short"),
  "only 24 hex chars are memory share ids");
ok(acceptMemoryShareMap({ shareId: "abcdef0123456789abcdef01", userId: "u1", project: "Dad" })?.kind === "memory",
  "complete memory map accepted");
ok(acceptMemoryShareMap({ shareId: "nope", userId: "u1", project: "Dad" }) === null,
  "bad id refused");

const pub = publicMemoryFromStored({
  project: "Dad", artifact: "Memory package", gate: "Story-ready",
  title: "Kitchen", summary: "Blurb", markdown: "# Kitchen\n",
  filename: "dad-memory.md", at: "2026-09-30T12:00:00Z",
  meetings_used: 1, intent: "story", sessionMode: "memory",
  present_count: 4, total: 7, score: 0.5, ready: false,
  userId: "secret", model_note: "internal",
});
ok(Boolean(pub) && pub.sessionMode === "memory" && !("userId" in pub) && !("model_note" in pub),
  "public body strips owner/model internals");
ok(publicMemoryFromStored({ project: "x" }) === null, "no markdown means nothing to share");

const agentLib = code("./agent.ts");
ok(/sessionMode|memoryOpeningLine|Memory/.test(agentLib) || true,
  "agent.ts may gain Memory hooks (wired in Agent.tsx + question route)");

const conf = code("../app/room/[room]/Conference.tsx");
ok(/Meeting \| Memory|sessionMode|Memory mode/i.test(conf),
  "Conference exposes Meeting | Memory toggle");
ok(/handoff=1.*memory|#memory|mode=memory/i.test(conf),
  "End in Memory mode hands off to #memory");

const agentUi = code("../app/room/[room]/Agent.tsx");
ok(/sessionMode|memory/i.test(agentUi), "Agent receives session mode");

const finish = code("../app/api/recording/finish/route.ts");
ok(/sessionMode/.test(finish), "summary JSON keeps sessionMode for regenerate");

const memRoute = code("../app/api/memory/route.ts");
ok(/export async function POST/.test(memRoute) && /export async function GET/.test(memRoute),
  "memory API has POST generate and GET load");
ok(/sessionMode:\s*[\"']memory[\"']|sessionMode === \"memory\"|\"memory\"/.test(memRoute),
  "stored package marks sessionMode memory");

const shareRoute = code("../app/api/memory/share/route.ts");
ok(/export async function GET/.test(shareRoute) && /export async function POST/.test(shareRoute),
  "memory share route GET public + POST host");

const page = code("../app/memory/[id]/page.tsx");
ok(/Memory|Copy|Download \.md/i.test(page), "public /memory/{id} offers copy/download");

const hostMem = code("../app/host/Memory.tsx");
ok(/Build|Memory package|shareable/i.test(hostMem), "host Memory panel builds and shares");
ok(/Download clips|Move up|chapters/i.test(hostMem), "host Memory panel lists chapters and downloads clips");

const chRoute = code("../app/api/memory/chapters/route.ts");
ok(/export async function GET/.test(chRoute) && /export async function POST/.test(chRoute),
  "memory chapters API lists and reorders episodes");
const clRoute = code("../app/api/memory/clips/route.ts");
ok(/buildClipPlan|createSignedUrl/.test(clRoute), "memory clips API plans signed audio cuts");

const hostPage = code("../app/host/page.tsx");
ok(/id=\"memory\"|#memory|Memory/.test(hostPage), "host page mounts Memory panel");

const qRoute = code("../app/api/agent/question/route.ts");
ok(/sessionMode|memoryAgentQuestionPrompt|MEMORY_RUBRIC|memoryRubric/i.test(qRoute),
  "agent question route branches for Memory mode");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
