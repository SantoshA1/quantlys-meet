// The workflow somebody drew on the whiteboard.
//
// FIELD 2026-08-25: "whatever they're drawing on the whiteboard should be
// converted into a workflow and added to the PRD."
//
// The screenshot that came with it is three boxes joined by lines, labelled
// Bronze, Silver and Gold. That is not a doodle — it is the tier model of a
// product, drawn in ten seconds because drawing it was faster than saying it.
// And it is exactly the kind of thing a PRD never captures, because nobody
// reads a diagram out loud for the transcript's benefit.
//
// THE PART THAT MAKES THIS WORTH DOING RATHER THAN GUESSING AT: the board is
// not stored as pixels. Every stroke is structured already — a rect knows it
// is a rect and knows its two corners; a text knows its string and its point.
// So the workflow can be recovered from GEOMETRY, deterministically, with no
// model involved and nothing to hallucinate:
//
//   · a rect or an ellipse is a NODE;
//   · a text inside one is that node's LABEL;
//   · an arrow or a line between two of them is an EDGE, directed if it was
//     an arrow;
//   · and anything that does not fit is reported as LOOSE, never quietly
//     dropped. A workflow that silently omits the box somebody drew is worse
//     than no workflow, because they will not notice it is missing.
//
// ZERO-IMPORT, so the geometry can be argued with in a test.

export type Pt = { x: number; y: number };
export type Stroke = {
  id: string; by?: string; who?: string; tool: string;
  pts: Pt[]; text?: string; at?: number;
};

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type WfNode = { id: string; label: string; shape: "box" | "round"; box: Box; who?: string };
export type WfEdge = { from: string; to: string; directed: boolean; label?: string };
export type Workflow = {
  nodes: WfNode[];
  edges: WfEdge[];
  /** what could not be placed, in words, so a person can see what was ignored */
  loose: string[];
  /** did the board contain anything workflow-shaped at all */
  found: boolean;
};

export const EMPTY_WORKFLOW: Workflow = { nodes: [], edges: [], loose: [], found: false };

/** How close an edge's end has to be to a node before it counts as attached,
 *  in board-relative units (the whole board is 1.0 across). Hand-drawn lines
 *  stop short and overshoot; 6% of the board is about a finger's width at
 *  laptop size and forgives both without connecting things across the room. */
export const SNAP = 0.06;

const box = (a: Pt, b: Pt): Box => ({
  x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
});

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const contains = (b: Box, p: Pt) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
const centre = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Distance from a point to a box — zero inside it, otherwise the gap to its
 *  nearest edge. An arrow that stops just short of a box is still pointing at
 *  it, and an arrow drawn INTO a box is obviously pointing at it. */
export function distanceTo(b: Box, p: Pt): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.sqrt(dx * dx + dy * dy);
}

const NODE_TOOLS = new Set(["rect", "ellipse"]);
const EDGE_TOOLS = new Set(["arrow", "line"]);

/** Read a board as a workflow. Pure: same strokes in, same graph out. */
export function toWorkflow(strokes: Stroke[]): Workflow {
  const all = (strokes || []).filter((s) => s && Array.isArray(s.pts) && s.pts.length);

  // ── nodes ──────────────────────────────────────────────────────────────
  const shapes = all.filter((s) => NODE_TOOLS.has(String(s.tool)) && s.pts.length >= 2);
  const nodes: WfNode[] = shapes.map((s, i) => ({
    id: `n${i + 1}`,
    label: "",
    shape: String(s.tool) === "ellipse" ? "round" : "box",
    box: box(s.pts[0], s.pts[s.pts.length - 1]),
    who: s.who,
  }));

  // ── labels ─────────────────────────────────────────────────────────────
  // A label belongs to the SMALLEST box that contains it, so a box drawn
  // inside another box takes its own text rather than the outer one's.
  const texts = all.filter((s) => String(s.tool) === "text" && String(s.text || "").trim());
  const loose: string[] = [];
  for (const t of texts) {
    const p = t.pts[0];
    const owners = nodes
      .filter((n) => contains(n.box, p))
      .sort((a, b) => area(a.box) - area(b.box));
    if (!owners.length) {
      loose.push(`note: “${String(t.text).trim()}”`);
      continue;
    }
    const n = owners[0];
    n.label = n.label ? `${n.label} ${String(t.text).trim()}` : String(t.text).trim();
  }

  // ── edges ──────────────────────────────────────────────────────────────
  const lines = all.filter((s) => EDGE_TOOLS.has(String(s.tool)) && s.pts.length >= 2);
  const edges: WfEdge[] = [];
  for (const l of lines) {
    const a = l.pts[0], b = l.pts[l.pts.length - 1];
    const near = (p: Pt) => {
      let best: WfNode | null = null, bestD = Infinity;
      for (const n of nodes) {
        const d = distanceTo(n.box, p);
        if (d < bestD) { bestD = d; best = n; }
      }
      return bestD <= SNAP ? best : null;
    };
    const from = near(a), to = near(b);
    if (!from || !to || from.id === to.id) {
      // Said out loud rather than dropped. A line that connects nothing is
      // usually somebody underlining a word, and pretending it was an edge
      // would put a relationship in the PRD that nobody drew.
      loose.push(String(l.tool) === "arrow" ? "an arrow that doesn't join two boxes" : "a line that doesn't join two boxes");
      continue;
    }
    const directed = String(l.tool) === "arrow";
    const already = edges.find((e) => e.from === from.id && e.to === to.id);
    if (already) {
      // Drawn twice, once as a line and once as an arrow. The arrow is the
      // more specific statement — somebody went back and put a direction on
      // it — so it upgrades the edge rather than being discarded as a
      // duplicate. Caught by lib/workflow.test.mjs.
      if (directed) already.directed = true;
      continue;
    }
    edges.push({ from: from.id, to: to.id, directed });
  }

  // A box nobody labelled is still a step — it just has no name yet, and that
  // is a real thing for the PRD to ask about.
  for (const n of nodes) if (!n.label) loose.push("an unlabelled box");

  return {
    nodes,
    edges,
    loose,
    found: nodes.length >= 2 && edges.length >= 1,
  };
}

/** Left-to-right where the drawing was left-to-right, top-down otherwise —
 *  a diagram that reads in the direction it was drawn in is a diagram people
 *  recognise as theirs. */
export function flowDirection(w: Workflow): "LR" | "TD" {
  if (w.nodes.length < 2) return "LR";
  const xs = w.nodes.map((n) => centre(n.box).x);
  const ys = w.nodes.map((n) => centre(n.box).y);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  return spread(xs) >= spread(ys) ? "LR" : "TD";
}

const mermaidSafe = (s: string) =>
  String(s || "").replace(/["\[\]{}()<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** The drawing, as a diagram the PRD can carry. Mermaid because it renders
 *  natively wherever this document ends up and stays readable as text when it
 *  does not. */
export function toMermaid(w: Workflow, title = ""): string {
  if (!w.nodes.length) return "";
  const lines: string[] = [`flowchart ${flowDirection(w)}`];
  // Left to right, top to bottom — the order somebody's eye reads them in.
  const ordered = [...w.nodes].sort((a, b) =>
    (centre(a.box).x - centre(b.box).x) || (centre(a.box).y - centre(b.box).y));
  for (const n of ordered) {
    const label = mermaidSafe(n.label) || n.id;
    lines.push(n.shape === "round" ? `  ${n.id}(${label})` : `  ${n.id}[${label}]`);
  }
  for (const e of w.edges) lines.push(`  ${e.from} ${e.directed ? "-->" : "---"} ${e.to}`);
  return (title ? `%% ${mermaidSafe(title)}\n` : "") + lines.join("\n");
}

/** The same thing in a sentence, for the model. A prompt reads prose better
 *  than it reads a diagram language, and the PRD's job is to describe the
 *  workflow in words as well as draw it. */
export function describeWorkflow(w: Workflow): string {
  if (!w.nodes.length) return "";
  const name = (id: string) => {
    const n = w.nodes.find((x) => x.id === id);
    return n && n.label ? `“${n.label}”` : `an unlabelled step (${id})`;
  };
  const out: string[] = [];
  out.push(`The team drew a diagram on the whiteboard with ${w.nodes.length} step(s):`);
  for (const n of w.nodes) out.push(`- ${n.label ? `“${n.label}”` : `an unlabelled step (${n.id})`}`);
  if (w.edges.length) {
    out.push("");
    out.push("connected like this:");
    for (const e of w.edges) {
      out.push(`- ${name(e.from)} ${e.directed ? "leads to" : "is joined to"} ${name(e.to)}`);
    }
  }
  if (w.loose.length) {
    out.push("");
    out.push(`Also on the board, not part of the flow: ${w.loose.join("; ")}.`);
  }
  out.push("");
  out.push(
    "Treat this as something the team SHOWED rather than said. It is strong " +
    "evidence for the user journey and the scope, and weak evidence for " +
    "anything it does not depict — do not invent steps to make it tidy."
  );
  return out.join("\n");
}

/** What the person sees when the board is captured. Says what was understood
 *  AND what was not, because a capture that quietly ignored half the board is
 *  how somebody finds out at PRD time that their diagram was never read. */
export function captureNote(w: Workflow): string {
  if (!w.nodes.length && !w.loose.length) return "";
  if (!w.nodes.length) return "Nothing on the board looked like a workflow — drawings are kept with the meeting either way.";
  const bits = [`${w.nodes.length} step${w.nodes.length === 1 ? "" : "s"}`];
  if (w.edges.length) bits.push(`${w.edges.length} connection${w.edges.length === 1 ? "" : "s"}`);
  const head = `Captured ${bits.join(" and ")} from the whiteboard — it goes into this project's PRD.`;
  return w.loose.length ? `${head} Not included: ${w.loose.join("; ")}.` : head;
}
