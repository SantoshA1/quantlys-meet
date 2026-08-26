/**
 * MAYA GUARD — the workflow somebody drew on the whiteboard.
 *
 * Maya asks: "I drew the tiers on the board in ten seconds because drawing was
 * faster than explaining. Why isn't it in the PRD?"
 *
 * FIELD 2026-08-25: "whatever they're drawing on the whiteboard should be
 * converted into a workflow and added to the PRD." The screenshot was three
 * boxes joined by lines — Bronze, Silver, Gold. A product's tier model, drawn
 * rather than said, and therefore invisible to a transcript.
 *
 * The board is stored as STRUCTURE, not pixels, so this is geometry rather
 * than guesswork. The rule that matters: anything that does not fit is
 * REPORTED, never quietly dropped. A workflow that silently omits a box is
 * worse than no workflow, because nobody notices what is missing.
 *
 * Run: node lib/workflow.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  toWorkflow, toMermaid, describeWorkflow, captureNote, flowDirection, distanceTo, SNAP,
} from "./workflow.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

const rect = (id, x0, y0, x1, y1) => ({ id, tool: "rect", pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
const text = (id, x, y, t) => ({ id, tool: "text", pts: [{ x, y }], text: t });
const line = (id, x0, y0, x1, y1, tool = "line") => ({ id, tool, pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });

// THE SCREENSHOT, as geometry.
const TIERS = [
  rect("a", .10, .30, .24, .62), rect("b", .38, .30, .55, .62), rect("c", .70, .30, .86, .62),
  text("t1", .16, .45, "Bronze"), text("t2", .46, .45, "Silver"), text("t3", .78, .45, "Gold"),
  line("l1", .24, .46, .38, .46), line("l2", .55, .46, .70, .46),
];

// ── 1. the drawing becomes a graph ───────────────────────────────────────
const w = toWorkflow(TIERS);
ok(w.found === true, "three boxes and two lines is a workflow");
ok(w.nodes.map((n) => n.label).join(" ") === "Bronze Silver Gold",
  "each box takes the label drawn inside it — this is the whole feature, and it needs no model at all");
ok(w.edges.length === 2 && w.edges[0].from === "n1" && w.edges[0].to === "n2",
  "a line between two boxes is an edge between those two nodes");
ok(w.loose.length === 0, "and nothing was left over");
ok(w.edges.every((e) => e.directed === false), "a plain line is undirected — it does not invent a direction nobody drew");
const upgraded = toWorkflow([...TIERS, line("l3", .24, .46, .38, .46, "arrow")]);
ok(upgraded.edges.length === 2 && upgraded.edges[0].directed === true,
  "…and an arrow drawn over an existing line UPGRADES it rather than being dropped as a duplicate — somebody went back and put a direction on it, which is a more specific statement than the line was");

// ── 2. what does not fit is said out loud ────────────────────────────────
const orphan = toWorkflow([...TIERS, text("t9", .5, .95, "remember the SLA")]);
ok(orphan.loose.some((l) => /remember the SLA/.test(l)),
  "text outside every box is reported as a note. NEGATIVE CONTROL for silently dropping it — a diagram that loses half of what was written on it is worse than none");
const stray = toWorkflow([...TIERS, line("l9", .05, .90, .12, .95)]);
ok(stray.loose.some((l) => /doesn't join two boxes/.test(l)),
  "a line that connects nothing is reported, not turned into a relationship nobody drew");
const blank = toWorkflow([rect("z", .1, .1, .3, .3), rect("y", .5, .1, .7, .3), line("k", .3, .2, .5, .2)]);
ok(blank.loose.filter((l) => /unlabelled box/.test(l)).length === 2,
  "an unlabelled box is still a step, and its missing name is a real thing for the PRD to ask about");
ok(toWorkflow([{ id: "p", tool: "pen", pts: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }]).found === false,
  "NEGATIVE CONTROL: a scribble is not a workflow. One box and no connections is not either");
ok(toWorkflow([]).found === false && toWorkflow(null).nodes.length === 0, "an empty board yields nothing, not a crash");

// ── 3. the geometry rules ────────────────────────────────────────────────
ok(distanceTo({ x0: .1, y0: .1, x1: .3, y1: .3 }, { x: .2, y: .2 }) === 0, "a point inside a box is at zero distance");
ok(distanceTo({ x0: .1, y0: .1, x1: .3, y1: .3 }, { x: .35, y: .2 }) > 0, "…and outside it is not");
const shortLine = toWorkflow([rect("a", .1, .1, .3, .3), rect("b", .5, .1, .7, .3), line("l", .32, .2, .48, .2)]);
ok(shortLine.edges.length === 1,
  `a hand-drawn line that stops short still connects — people do not touch the box, and ${SNAP * 100}% of the board forgives that`);
const farLine = toWorkflow([rect("a", .05, .05, .15, .15), rect("b", .85, .85, .95, .95), line("l", .3, .3, .6, .6)]);
ok(farLine.edges.length === 0, "NEGATIVE CONTROL: but a line in the middle of nowhere does not connect two distant boxes");
const nested = toWorkflow([rect("out", .1, .1, .9, .9), rect("in", .4, .4, .6, .6), text("t", .5, .5, "inner"), line("l", .2, .5, .4, .5)]);
ok(nested.nodes.find((n) => n.label === "inner")?.box.x0 === .4,
  "a label inside nested boxes belongs to the SMALLEST one that contains it");
ok(flowDirection(w) === "LR", "boxes spread across the screen read left to right");
ok(flowDirection(toWorkflow([rect("a", .4, .05, .6, .2), rect("b", .4, .5, .6, .7), line("l", .5, .2, .5, .5)])) === "TD",
  "…and boxes stacked down the screen read top to bottom, which is the direction they were drawn in");

// ── 4. what the PRD receives ─────────────────────────────────────────────
const mm = toMermaid(w, "Quantlys");
ok(mm.startsWith("%% Quantlys\nflowchart LR"), "the diagram is Mermaid, so it renders wherever the document ends up");
ok(mm.includes("n1[Bronze]") && mm.includes("n1 --- n2"), "…with the labels and the connections that were drawn");
ok(toMermaid(toWorkflow([{ id: "e", tool: "ellipse", pts: [{ x: .1, y: .1 }, { x: .3, y: .3 }] }])).includes("("),
  "an ellipse is drawn round, because somebody chose an ellipse");
// The node syntax IS `n1[label]`, so the test is about the label's own text.
const risky = toMermaid(toWorkflow([rect("a", .1, .1, .3, .3), text("t", .2, .2, 'Tier [A] "gold"')]));
ok(risky.includes("n1[Tier A gold]"),
  "brackets and quotes inside a label are stripped — one of them closes the node early and takes the whole diagram down with it");

const said = describeWorkflow(w);
ok(said.includes("“Bronze” is joined to “Silver”"), "the model is told the flow in prose, which it reads better than a diagram language");
ok(/SHOWED rather than said/.test(said),
  "…and told to treat it as evidence of what was DEPICTED — strong for the journey, and explicitly not licence to invent steps to make it tidy");

ok(/3 steps and 2 connections/.test(captureNote(w)), "the person is told what was captured");
ok(/Not included/.test(captureNote(orphan)), "…and what was not. A silent capture is one nobody trusts");
ok(captureNote(toWorkflow([])) === "", "an untouched board says nothing at all");

// ── 5. the wiring ────────────────────────────────────────────────────────
const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");
const prd = readFileSync(new URL("../app/api/prd/route.ts", import.meta.url), "utf8");
const fin = readFileSync(new URL("../app/api/recording/finish/route.ts", import.meta.url), "utf8");
const board = readFileSync(new URL("../app/room/[room]/Board.tsx", import.meta.url), "utf8");
ok(/workflow: toWorkflow\(getBoardStrokes\(\)/.test(conf), "the drawing rides into the recording payload");
ok(/workflow: \(body\.workflow/.test(fin), "the recording keeps it");
ok(/describeWorkflow\(drawn\)/.test(prd) && /toMermaid\(drawn/.test(prd),
  "and the PRD both READS it and CARRIES it — a document that describes a flow in prose while the picture sits in a recording nobody opens has lost the clearest thing the meeting made");
ok(/onCaptured\?\.\(captureNote/.test(board), "pressing Done says what was understood");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
