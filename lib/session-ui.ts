// Mode-aware UI copy for Meeting (PRD) vs Memory (oral historian).
// ZERO-IMPORT beyond SessionMode so helpers stay offline-testable.

import {
  type SessionMode,
  acceptSessionMode,
  DEFAULT_SESSION_MODE,
} from "./memory";

export type { SessionMode };

/** True when a project name/tag itself is the Memory surface (e.g. tag `memory`). */
export function isMemoryProjectTag(raw: unknown): boolean {
  return acceptSessionMode(raw) === "memory";
}

export function resolveSessionMode(
  raw: unknown,
  fallback: SessionMode = DEFAULT_SESSION_MODE,
): SessionMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return acceptSessionMode(v);
}

// ── Live room: gap strip ──────────────────────────────────────────────────

export function gapStripKicker(mode: SessionMode): string {
  return mode === "memory" ? "Still to draw out" : "Still open";
}

export function gapStripAria(mode: SessionMode): string {
  return mode === "memory" ? "Story threads still open" : "Spec gaps still open";
}

export function gapStripCollapsedLabel(mode: SessionMode, count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (mode === "memory") {
    return n === 1 ? "1 thread still open" : `${n} threads still open`;
  }
  return n === 1 ? "1 gap still open" : `${n} gaps still open`;
}

// ── Live Notes rail ───────────────────────────────────────────────────────

export function liveNotesSubtitle(mode: SessionMode): string {
  return mode === "memory" ? "CAPTURING THE STORY" : "NOBODY TAKES MINUTES";
}

export function liveNotesEmptyHint(mode: SessionMode): string {
  return mode === "memory"
    ? "Turn captions on and the story starts writing itself down here — quotes, turning points, and open threads get caught as they are said."
    : "Turn captions on and the meeting starts writing itself down here — decisions and commitments get caught as they are said.";
}

export function liveNotesKindLabel(
  mode: SessionMode,
  kind: "decision" | "action" | "flag",
  who = "",
): string {
  const name = String(who || "").trim().toUpperCase();
  if (kind === "flag") {
    return name ? `FLAGGED BY ${name}` : "FLAGGED";
  }
  if (mode === "memory") {
    if (kind === "decision") return "TURNING POINT";
    return name ? `MOMENT → ${name}` : "MOMENT";
  }
  if (kind === "decision") return "DECISION CAUGHT";
  return name ? `ACTION → ${name}` : "ACTION";
}

export function liveNotesCountsLine(
  mode: SessionMode,
  decisions: number,
  actions: number,
): { prefix: string; leftLabel: string; rightLabel: string } {
  if (mode === "memory") {
    return {
      prefix: "CAUGHT SO FAR",
      leftLabel: decisions === 1 ? "TURNING POINT" : "TURNING POINTS",
      rightLabel: actions === 1 ? "MOMENT" : "MOMENTS",
    };
  }
  return {
    prefix: "CAUGHT SO FAR",
    leftLabel: decisions === 1 ? "DECISION" : "DECISIONS",
    rightLabel: actions === 1 ? "ACTION" : "ACTIONS",
  };
}

export function liveNotesFlagButton(mode: SessionMode, flashed: boolean): string {
  if (flashed) return "FLAGGED ✓";
  return mode === "memory" ? "FLAG THIS LINE" : "FLAG THIS MOMENT";
}

export function liveNotesFooter(mode: SessionMode): string {
  return mode === "memory"
    ? "Everyone here sees the recording badge for as long as it lasts. The story package and summary email go out the moment you stop."
    : "Everyone here sees the recording badge for as long as it lasts. Notes and the summary email go out the moment you stop.";
}

export function roomPeopleLabel(mode: SessionMode, count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (mode === "memory") {
    return n === 1 ? "1 IN THE ROOM" : `${n} IN THE ROOM`;
  }
  return n === 1 ? "1 IN THE MEETING" : `${n} IN THE MEETING`;
}

// ── Host recordings / notes ───────────────────────────────────────────────

export function recordingsActionsTab(mode: SessionMode, count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (mode === "memory") {
    return n ? `Open threads · ${n}` : "Open threads";
  }
  return n ? `Action items · ${n}` : "Action items";
}

export function recordingsActionsHead(mode: SessionMode): string {
  return mode === "memory" ? "Open threads & moments" : "Action items";
}

export function recordingsActionsEmpty(mode: SessionMode): string {
  return mode === "memory"
    ? "No open threads were drawn out loud in this one."
    : "Nothing was committed to out loud in this one.";
}

export function recordingsActionsFoot(mode: SessionMode): string {
  return mode === "memory"
    ? "These also feed the Memory package — rebuild it from the Memory panel when you want chapters and quotes shaped."
    : "These are also on your host page under “Still open”, where you can tick them off. Anything you don't tick comes back on Monday.";
}

export function recordingsAskHead(mode: SessionMode): string {
  return mode === "memory" ? "Ask this session" : "Ask this meeting";
}

export function recordingsAskOpeners(mode: SessionMode): string[] {
  if (mode === "memory") {
    return [
      "What turning points came up?",
      "Which lines are worth quoting?",
      "Who else belongs in this story?",
      "What still wants telling?",
    ];
  }
  return [
    "What did we decide?",
    "Did anyone commit to a date?",
    "What was left unresolved?",
    "What are the risks we named?",
  ];
}

export function recordingsSummaryDecisionsHead(mode: SessionMode): string {
  return mode === "memory" ? "Turning points & direction" : "Decisions and direction";
}

export function recordingsSummaryFollowupsHead(mode: SessionMode): string {
  return mode === "memory" ? "Open threads / next chapters" : "Follow-up / next steps";
}

export function recordingsSummaryTopicsHead(mode: SessionMode): string {
  return mode === "memory" ? "What was told" : "What was discussed";
}

// ── Host PRD / Memory surface (dropdown + CTA) ────────────────────────────

export function hostSurfaceTitle(mode: SessionMode): string {
  return mode === "memory" ? "Memory from your sessions" : "PRD from your meetings";
}

export function hostBuildCta(mode: SessionMode, opts?: { busy?: boolean; hasData?: boolean }): string {
  if (opts?.busy) {
    return mode === "memory" ? "Building…" : "Reading…";
  }
  if (mode === "memory") {
    return opts?.hasData ? "Rebuild Memory" : "Build Memory";
  }
  return opts?.hasData ? "Rebuild" : "Build the PRD";
}

export function hostBriefLabel(mode: SessionMode): string {
  return mode === "memory" ? "What this story is about" : "What we're building";
}

export function hostBriefHint(mode: SessionMode): string {
  return mode === "memory"
    ? "TWO OR THREE SENTENCES, WRITTEN ONCE. IT FRAMES THE ORAL-HISTORIAN AGENT — CHAPTERS, PEOPLE, TURNING POINTS — FROM THE FIRST MEMORY SESSION."
    : "TWO OR THREE SENTENCES, WRITTEN ONCE. IT DECIDES WHICH RUBRIC THIS PROJECT IS SCORED ON AND GIVES THE IN-MEETING AGENT SOMETHING TO ASK ABOUT FROM THE VERY FIRST MEETING.";
}

export function hostBriefPlaceholder(mode: SessionMode): string {
  return mode === "memory"
    ? "A life-journey book for my kids — the kitchen years, the move, and the hard-won lessons I want them to keep."
    : "A tool for the finance team that turns a photo of a receipt into a filed expense, so nobody keeps paper. Web first.";
}

export function hostEmptyProjectsHint(mode: SessionMode): string {
  return mode === "memory"
    ? "Put a project name in the Project box when you start a Memory session. Every recorded Memory session on the same project is read together into the story package."
    : "Put a project name in the Project box when you start a meeting. Every recorded meeting on the same project is read together, and the PRD builds from all of them.";
}

export function hostMemoryRedirectNote(project: string): string {
  const name = String(project || "this project").trim() || "this project";
  return `${name} is tagged Memory. Use Build Memory below (or the Memory package panel) — story chapters, quotes, and open threads, not a PRD rubric.`;
}

// ── Host Launch card (Meeting vs Memory before start) ─────────────────────

const LAUNCH_FOCUS_KEY = "qm.host.launchFocus";

/** Persist last Host Launch focus so the rail softens on return. */
export function readLaunchFocus(fallback: SessionMode = DEFAULT_SESSION_MODE): SessionMode {
  if (typeof window === "undefined") return fallback;
  try {
    return resolveSessionMode(window.localStorage.getItem(LAUNCH_FOCUS_KEY), fallback);
  } catch {
    return fallback;
  }
}

export function writeLaunchFocus(mode: SessionMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAUNCH_FOCUS_KEY, mode);
  } catch { /* private mode */ }
}

export function hostLaunchTitle(mode: SessionMode): string {
  return mode === "memory" ? "Start a memory session" : "Start a spec session";
}

export function hostLaunchBlurb(mode: SessionMode): string {
  return mode === "memory"
    ? "Tell the story out — no one else has to join. The oral-historian agent and recording turn on."
    : "Talk the spec out — no one else has to join. The agent and recording turn on.";
}

export function hostLaunchPrimaryCta(mode: SessionMode, busy = false): string {
  if (busy) return "STARTING…";
  return mode === "memory" ? "START MEMORY SESSION" : "START SPEC SESSION";
}

export function hostLaunchNamePlaceholder(mode: SessionMode): string {
  return mode === "memory" ? "Session name (story, podcast, or book)" : "Meeting name";
}

export function hostLaunchProjectTitle(mode: SessionMode): string {
  return mode === "memory"
    ? "Memory sessions in the same project roll into one story package"
    : "Meetings in the same project are rolled up together in your weekly digest";
}

export function hostLaunchDefaultTitle(mode: SessionMode): string {
  return mode === "memory" ? "Memory session" : "Spec session";
}

export function hostLaunchDefaultProject(mode: SessionMode): string {
  return mode === "memory" ? "memory" : "spec";
}

/** Query string that opens the room with agent/recording on and the right mode. */
export function hostLaunchRoomQuery(mode: SessionMode): string {
  return mode === "memory" ? "spec=1&mode=memory" : "spec=1";
}

export function hostLaunchFailNote(mode: SessionMode, detail: string): string {
  const kind = mode === "memory" ? "memory session" : "spec session";
  return `Could not start the ${kind}: ${detail}`;
}

export function hostLaunchInviteStuckNote(mode: SessionMode, link: string): string {
  const kind = mode === "memory" ? "memory session" : "spec session";
  return `The ${kind} is open at ${link} — open it when you're ready.`;
}

/** Soften pipeline step labels when Host Launch last focus is Memory. */
export function hostPipeLabel(mode: SessionMode, key: string, label: string): string {
  if (mode !== "memory") return label;
  if (key === "notes") return "Write the story notes";
  if (key === "email") return "Email you the story notes and a link";
  if (key === "items") return "Capture open threads";
  return label;
}

export function hostChipLabel(mode: SessionMode, key: string, meetingLabel: string): string {
  if (mode === "memory" && key === "items") return "THREADS";
  return meetingLabel;
}

export function hostRailStillOpenEmpty(mode: SessionMode): string {
  return mode === "memory"
    ? "Nothing open. Open threads land here after a recorded Memory session."
    : "Nothing open. Commitments land here after a recorded meeting.";
}

export function hostMeetingsEyebrow(mode: SessionMode): string {
  return mode === "memory" ? "YOUR SESSIONS" : "YOUR MEETINGS";
}
