/**
 * MAYA GUARD — Meeting vs Memory UI copy.
 *
 * Maya asks: "In Memory mode, do I still see PRD / minutes / action-item
 * language, and does the gap strip cover Leave / Settings?"
 *
 * Run: node lib/session-ui.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  isMemoryProjectTag, resolveSessionMode,
  gapStripKicker, gapStripAria, gapStripCollapsedLabel,
  liveNotesSubtitle, liveNotesEmptyHint, liveNotesKindLabel,
  liveNotesCountsLine, liveNotesFlagButton, liveNotesFooter, roomPeopleLabel,
  recordingsActionsTab, recordingsActionsHead, recordingsActionsEmpty,
  recordingsActionsFoot, recordingsAskHead, recordingsAskOpeners,
  recordingsSummaryDecisionsHead, recordingsSummaryFollowupsHead,
  recordingsSummaryTopicsHead,
  hostSurfaceTitle, hostBuildCta, hostBriefLabel, hostBriefHint,
  hostBriefPlaceholder, hostEmptyProjectsHint, hostMemoryRedirectNote,
} from "./session-ui.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(isMemoryProjectTag("memory") && isMemoryProjectTag("Memory") && !isMemoryProjectTag("life-book"),
  "project tag memory folds to Memory surface");
ok(resolveSessionMode("memory") === "memory" && resolveSessionMode(undefined, "meeting") === "meeting",
  "resolveSessionMode reads summary / LiveKit mode");
ok(resolveSessionMode("Personal Life Journey") === "meeting",
  "ordinary project names stay Meeting");

ok(gapStripKicker("memory") === "Still to draw out" && gapStripKicker("meeting") === "Still open",
  "gap strip kicker matches mode dims");
ok(/story/i.test(gapStripAria("memory")) && /spec|gap/i.test(gapStripAria("meeting")),
  "gap strip aria is mode-aware");
ok(gapStripCollapsedLabel("memory", 7).includes("7") && gapStripCollapsedLabel("meeting", 1).includes("1"),
  "collapsed gap strip names the count");

ok(liveNotesSubtitle("memory") === "CAPTURING THE STORY",
  "Live Notes Memory subtitle is story framing, not minutes");
ok(liveNotesSubtitle("meeting") === "NOBODY TAKES MINUTES",
  "Live Notes Meeting keeps minutes cue");
ok(!/minutes|PRD|decision/i.test(liveNotesEmptyHint("memory")),
  "Memory Live Notes empty hint avoids meeting-minutes language");
ok(liveNotesKindLabel("memory", "decision") === "TURNING POINT",
  "Memory catches turning points, not decisions");
ok(/MOMENT/.test(liveNotesKindLabel("memory", "action", "Santosh")),
  "Memory softens ACTION → into MOMENT");
ok(/DECISION/.test(liveNotesKindLabel("meeting", "decision")),
  "Meeting keeps decision label");
ok(liveNotesCountsLine("memory", 0, 4).rightLabel === "MOMENTS",
  "Memory footer counts moments not actions");
ok(liveNotesFlagButton("memory", false) === "FLAG THIS LINE",
  "Memory flag CTA is story-shaped");
ok(/story package/i.test(liveNotesFooter("memory")),
  "Memory footer mentions story package");
ok(roomPeopleLabel("memory", 1) === "1 IN THE ROOM",
  "Memory people chip says room not meeting");

ok(recordingsActionsTab("memory", 0) === "Open threads",
  "Recordings Memory tab is Open threads");
ok(recordingsActionsEmpty("memory").includes("open threads"),
  "Recordings Memory empty softens commitment language");
ok(recordingsActionsEmpty("meeting").includes("committed"),
  "Meeting empty keeps commitment language");
ok(/Memory package|chapters/i.test(recordingsActionsFoot("memory")),
  "Memory actions foot points at Memory package");
ok(recordingsAskHead("memory") === "Ask this session",
  "Memory ask head says session");
ok(recordingsAskOpeners("memory").some((q) => /quote|turning|story|telling/i.test(q)),
  "Memory ask openers are story-shaped");
ok(recordingsSummaryDecisionsHead("memory").includes("Turning"),
  "Memory summary uses turning points head");
ok(recordingsSummaryTopicsHead("memory").includes("told"),
  "Memory topics head is story framing");
ok(recordingsSummaryFollowupsHead("memory").includes("chapters") ||
   recordingsSummaryFollowupsHead("memory").includes("threads"),
  "Memory follow-ups are open threads / chapters");

ok(hostSurfaceTitle("memory") === "Memory from your sessions",
  "Host Memory title is not PRD from your meetings");
ok(hostBuildCta("memory", {}) === "Build Memory" && hostBuildCta("meeting", {}) === "Build the PRD",
  "Host CTA is Build Memory vs Build the PRD");
ok(hostBuildCta("memory", { hasData: true }) === "Rebuild Memory",
  "Host rebuild CTA stays Memory-shaped");
ok(/story/i.test(hostBriefLabel("memory")) && /building/i.test(hostBriefLabel("meeting")),
  "Host brief label switches story vs building");
ok(!/PRD|rubric|in-meeting/i.test(hostBriefHint("memory")),
  "Host Memory brief hint drops PRD rubric copy");
ok(/kids|journey|story/i.test(hostBriefPlaceholder("memory")),
  "Host Memory placeholder is writer/podcaster shaped");
ok(/Memory session/i.test(hostEmptyProjectsHint("memory")),
  "Host empty hint mentions Memory sessions");
ok(/tagged Memory|Build Memory/i.test(hostMemoryRedirectNote("memory")),
  "Memory project note steers away from PRD rubric");

const agent = code("../app/room/[room]/Agent.tsx");
ok(/gapsTop|qa-gaps-dock|gapStripCollapsed|collapsed/i.test(agent),
  "Agent gap strip takes chrome-safe placement (below bar / collapsible)");
ok(!/top:\s*60px/.test(agent) || /gapsTop|style=\{\{\s*top/i.test(agent),
  "gap strip no longer hardcodes top:60px over chrome");

const conf = code("../app/room/[room]/Conference.tsx");
ok(/liveNotesSubtitle|sessionMode|CAPTURING THE STORY|liveNotes/i.test(conf),
  "Conference Live Notes wires mode copy");
ok(/gapsTop=\{headroom\}|gapsTop=\{|headroom/.test(conf),
  "Conference passes headroom so gap strip sits below chrome");

const rec = code("../app/host/Recordings.tsx");
ok(/recordingsActionsEmpty|resolveSessionMode|sessionMode|Open threads/i.test(rec),
  "Recordings notes panel uses mode-aware action copy");

const prd = code("../app/host/Prd.tsx");
ok(/hostSurfaceTitle|hostBuildCta|isMemoryProjectTag|Build Memory/i.test(prd),
  "Prd host panel switches to Memory CTA when project tag is memory");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
