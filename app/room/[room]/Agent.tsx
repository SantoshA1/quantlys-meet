"use client";

// The agent in the room.
//
// FIELD 2026-08-24: "build an AI agent for asking questions during the
// meeting, where a virtual agent can be enabled with a click of a button when
// the meeting starts, so live meetings are prompted with questions based on
// the project — Conclave follow-up questions to ensure the PRD is 100%
// complete."
//
// The whole design problem is that this feature's failure mode is not being
// wrong, it is being ANNOYING. A question that arrives over somebody's
// sentence is turned off in the first two minutes and never turned back on,
// and then the eight dimensions it existed to close stay open for ever. So
// the decision to speak is made by lib/agent.ts — pure, guarded, and biased
// hard toward silence — and this component only carries it out.
//
// WHAT IT ACTUALLY DOES, once a minute:
//   · reads the live captions (no new transcription — it rides the ones the
//     meeting already produces, so it costs nothing when captions are off);
//   · asks lib/agent.ts whether this is a moment; almost always: no;
//   · when it is, asks ONE question of the model and puts it on everybody's
//     screen through the room's own data channel, so the question is part of
//     the meeting rather than a private note to the host.
//
// Answers are captions like any other: somebody says one out loud, and the
// PRD reads it in the transcript afterwards. The buttons exist for the case
// where nobody wants to say it out loud — a tap writes the answer into the
// record so it reaches /api/prd the same way.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDataChannel, useLocalParticipant } from "@livekit/components-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { finals, type Caption } from "@/lib/captions";
import {
  shouldAsk, statusLine, openingLine, specOpeningLine, looksAnswered, observe,
  dropCoveredByRecent, specGapStrip, gapChipLabel,
  MAX_QUESTIONS, SPEC_MAX_QUESTIONS, type AgentAsk, type AgentState,
} from "@/lib/agent";
import { rubricFor, metaFor, detectMode } from "@/lib/prd";
import {
  memoryRubric, memoryOpeningLine, memoryStatusLine, MEMORY_META,
  type SessionMode,
} from "@/lib/memory";
import {
  gapStripKicker, gapStripAria, gapStripCollapsedLabel,
} from "@/lib/session-ui";

/** Its own topic. Captions are a firehose and the agent speaks eight times an
 *  hour; sharing a channel would mean parsing every caption to find them. */
export const AGENT_TOPIC = "qm-agent";

type GapDim = { key: string; label: string; status: string };

type Broadcast =
  | { kind: "ask"; ask: AgentAsk; open?: GapDim[]; highlightKey?: string }
  | { kind: "answer"; key: string; text: string; who: string; open?: GapDim[] }
  | { kind: "dismiss"; key: string; at: number }
  | { kind: "gaps"; open: GapDim[]; highlightKey: string; agentOn: boolean };

function normalizeGaps(list: unknown): GapDim[] {
  const seen = new Set<string>();
  const out: GapDim[] = [];
  for (const d of Array.isArray(list) ? list : []) {
    const row = d as { key?: string; label?: string; status?: string };
    const key = String(row?.key || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: gapChipLabel({ key, label: row?.label }),
      status: String(row?.status || "missing"),
    });
  }
  return out;
}

export default function Agent({
  room, project, log, myName, spec = false, isHost = false,
  captionsOn, enableCaptions, captionEpoch, captionNote,
  sessionMode = "meeting",
  gapsTop = 64,
}: {
  room: string;
  /** the project this meeting belongs to, from /api/room/info */
  project: string;
  /** the live caption log — the agent never transcribes anything itself */
  log: Caption[];
  myName: string;
  /** a spec session starts the interviewer on */
  spec?: boolean;
  /** only the host may enable generation — guests still see & answer the card */
  isHost?: boolean;
  captionsOn: boolean;
  enableCaptions: () => void;
  captionEpoch?: number;
  captionNote?: string;
  /** Meeting (PRD) vs Memory (oral historian). Default Meeting. */
  sessionMode?: SessionMode;
  /** Pixels from viewport top to sit BELOW the chrome bar — never over Leave / Settings. */
  gapsTop?: number;
}) {
  const [on, setOn] = useState(!!spec);
  const [asked, setAsked] = useState<AgentAsk[]>([]);
  const [current, setCurrent] = useState<AgentAsk | null>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Array<{ key: string; label: string; status: string }>>([]);
  // Guests do not generate. They learn that the host's agent is on — and which
  // dims are still open — from the room broadcast, so the strip is the same
  // for everyone.
  const [roomOn, setRoomOn] = useState(false);
  const [remoteHighlight, setRemoteHighlight] = useState("");
  // Gap strip starts collapsed so chips never cover chrome; expand below the bar.
  const [gapsExpanded, setGapsExpanded] = useState(false);

  const startedAt = useRef(0);
  const lastAskAt = useRef(0);
  const wordsAtLastAsk = useRef(0);
  const lastWordsAt = useRef<number | null>(null);
  const wordsSeen = useRef(0);
  const sinceMark = useRef(0);
  const inFlight = useRef(false);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const openRef = useRef(open);
  openRef.current = open;
  const { localParticipant } = useLocalParticipant();

  const memory = sessionMode === "memory";
  const mode = detectMode(`${project} ${room}`);
  const meta = memory
    ? { artifact: MEMORY_META.artifact, gate: MEMORY_META.gate, crew: MEMORY_META.crew }
    : metaFor(mode);
  const rubric = memory ? memoryRubric() : rubricFor(mode);

  // Everyone in the room sees the same question at the same time. An agent
  // that whispers to the host is a note-taking tool; one that speaks into the
  // room is a participant, and only the second one gets answered out loud.
  const { send } = useDataChannel(AGENT_TOPIC, (msg) => {
    try {
      const b: Broadcast = JSON.parse(new TextDecoder().decode(msg.payload));
      if (b?.kind === "ask" && b.ask?.key) {
        setCurrent(b.ask);
        setAsked((a) => (a.some((x) => x.at === b.ask.at) ? a : [...a, b.ask]));
        setRemoteHighlight(b.ask.key);
        // Guests take the open list that travelled with the ask so the
        // highlighted chip and the question arrive together.
        if (!isHostRef.current) {
          setRoomOn(true);
          if (Array.isArray(b.open)) setOpen(normalizeGaps(b.open));
        }
      } else if (b?.kind === "dismiss") {
        setCurrent((c) => (c && c.key === b.key ? null : c));
        setRemoteHighlight((h) => (h === b.key ? "" : h));
      } else if (b?.kind === "answer") {
        setCurrent((c) => (c && c.key === b.key ? null : c));
        setAsked((a) => a.map((x) => (x.key === b.key ? { ...x, answered: true } : x)));
        setRemoteHighlight((h) => (h === b.key ? "" : h));
        // Live answer closes that dim for the next ask — do not re-ask it.
        // Guests apply the host's remaining list when it rode along; otherwise
        // drop the answered key locally so the chip still leaves the strip.
        if (!isHostRef.current && Array.isArray(b.open)) setOpen(normalizeGaps(b.open));
        else setOpen((o) => o.filter((d) => d.key !== b.key));
      } else if (b?.kind === "gaps") {
        // Host is the source of truth for the open list. Applying our own
        // echo can resurrect a dim a local answer already dropped.
        if (!isHostRef.current) {
          setOpen(normalizeGaps(b.open));
          setRoomOn(Boolean(b.agentOn));
          setRemoteHighlight(String(b.highlightKey || ""));
        }
      }
    } catch { /* a malformed frame is not worth a broken panel */ }
  });

  const shout = useCallback((b: Broadcast) => {
    try { send(new TextEncoder().encode(JSON.stringify(b)), { reliable: true }); } catch { /* local still updates */ }
  }, [send]);

  // What is still open comes from the project's LAST assessment, so the agent
  // does not re-ask what a previous meeting already settled. No assessment
  // yet — a project's first meeting — means everything is open, which is
  // exactly right.
  useEffect(() => {
    // Only the host loads the assessment. Guests paint the strip from the
    // broadcast so they never need to generate, and they still see the same chips.
    if (!isHost || !on) return;
    // Memory mode: oral-historian dims, not the PRD assessment.
    if (memory) {
      setOpen(rubric.map((d) => ({ key: d.key, label: d.label, status: "missing" })));
      return;
    }
    // No project yet still means the whole rubric is open — otherwise shouldAsk
    // sees an empty list and says nothing is left to ask, so a spec session
    // never interviews.
    if (!project) {
      setOpen(rubric.map((d) => ({ key: d.key, label: d.label, status: "missing" })));
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data: s } = await supabaseBrowser().auth.getSession();
        const token = s?.session?.access_token;
        if (!token) { if (alive) setOpen(rubric.map((d) => ({ key: d.key, label: d.label, status: "missing" }))); return; }
        const r = await fetch(`/api/prd?project=${encodeURIComponent(project)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await r.json().catch(() => null);
        if (!alive) return;
        const dims = Array.isArray(j?.dimensions) ? j.dimensions : [];
        const answered = new Set(
          (Array.isArray(j?.answered) ? j.answered : []).map((k: any) => String(k || "")).filter(Boolean)
        );
        const openDims = dims.length
          ? dims.filter((d: any) => d?.status !== "present").map((d: any) => ({ key: d.key, label: d.label, status: d.status }))
          : rubric.map((d) => ({ key: d.key, label: d.label, status: "missing" }));
        setOpen(openDims.filter((d: { key: string }) => !answered.has(d.key)));
      } catch {
        if (alive) setOpen(rubric.map((d) => ({ key: d.key, label: d.label, status: "missing" })));
      }
    })();
    return () => { alive = false; };
  }, [isHost, on, project, rubric, memory]);

  // Spec sessions start with the agent already on, so the opening line has to
  // land without a click. Captions are the ears — turn them on if they aren't.
  useEffect(() => {
    if (!spec) return;
    setNote(specOpeningLine(project, rubric.length));
    if (!startedAt.current) startedAt.current = Date.now();
    if (!captionsOn) enableCaptions();
  }, [spec, project, rubric.length, captionsOn, enableCaptions]);

  const ask = useCallback(async (state: AgentState, key: string, recent: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { data: s } = await supabaseBrowser().auth.getSession();
      const token = s?.session?.access_token;
      if (!token) {
        setNote("Sign in on this device to let the agent ask questions — it speaks as the host.");
        setOn(false);
        return;
      }
      const r = await fetch("/api/agent/question", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project, mode,
          recent,
          open: state.open,
          asked: state.asked.map((a) => a.question),
          askedKeys: state.asked.map((a) => a.key),
          spec: Boolean(spec),
          sessionMode,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!j) { setNote("The agent couldn't reach the server — it will try again."); return; }
      if (j.error) { setNote(j.error); setOn(false); return; }
      if (!j.ask) { setNote(String(j.reason || "")); return; }
      const item: AgentAsk = {
        key: String(j.key), label: String(j.label || j.key),
        question: String(j.question), options: Array.isArray(j.options) ? j.options.map(String) : [],
        why: String(j.why || ""), at: Date.now(),
      };
      lastAskAt.current = Date.now();
      wordsAtLastAsk.current = words(log);
      sinceMark.current = finals(log).length;
      setAsked((a) => [...a, item]);
      setCurrent(item);
      setNote(String(j.model_note || ""));
      shout({ kind: "ask", ask: item, open: openRef.current, highlightKey: item.key });
    } catch (e: any) {
      setNote(`The agent hit an error: ${e?.message || String(e)}`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [project, mode, log, shout, spec, sessionMode]);

  // The clock. Once every five seconds is enough for a decision whose
  // shortest interval is three minutes, and it keeps the status line honest
  // rather than frozen.
  useEffect(() => {
    // Generation is host-only. Guests still receive ask broadcasts and can
    // answer the card — they must never burn /api/agent/question.
    if (!isHost || !on) { setStatus(""); return; }
    if (!startedAt.current) startedAt.current = Date.now();
    const tick = () => {
      const n = words(log);
      if (n > wordsSeen.current) {
        lastWordsAt.current = Date.now();
        wordsSeen.current = n;
      } else if (n < wordsSeen.current) {
        wordsSeen.current = n;
      }
      const clock = observe({
        now: Date.now(),
        lastWordsAt: lastWordsAt.current,
        lastAskAt: lastAskAt.current,
        startedAt: startedAt.current,
        wordsNow: n,
        wordsAtAsk: wordsAtLastAsk.current,
      });
      // Same anti-reask the next question uses: a dim the room just covered
      // in substance leaves the open list, so the chip leaves the strip for
      // everyone. Never drop the dim whose card is still up — that chip stays
      // highlighted until the answer lands.
      const covered = dropCoveredByRecent(open, recentText(log));
      let liveOpen = covered;
      if (current?.key && open.some((d) => d.key === current.key) && !covered.some((d) => d.key === current.key)) {
        const held = open.find((d) => d.key === current.key);
        liveOpen = held ? [held, ...covered] : covered;
      }
      if (liveOpen.map((d) => d.key).join("|") !== open.map((d) => d.key).join("|")) {
        setOpen(liveOpen);
      }
      const state: AgentState = {
        on: true,
        ...clock,
        asked,
        open: liveOpen,
        pending: Boolean(current),
        spec: Boolean(spec),
        hearing: Boolean(captionsOn),
      };
      const verdict = shouldAsk(state);
      // Memory: oral-historian status copy (not "parts of the PRD").
      if (memory) {
        const reason = String(verdict.reason || "")
          .replace(/every open part has been covered/i, "the story dimensions are covered")
          .replace(/parts? still open/i, "parts of the story still open");
        setStatus(memoryStatusLine(state.asked.length, (state.open || []).map((d) => d.label).filter(Boolean), reason));
      } else {
        setStatus(statusLine(state, verdict));
      }
      if (verdict.ask && verdict.key && !inFlight.current) {
        ask(state, verdict.key, recentText(log));
      }
    };
    tick();
    const iv = window.setInterval(tick, 5000);
    return () => window.clearInterval(iv);
  }, [isHost, on, log, asked, open, current, ask, spec, captionsOn, memory]);

  // A question the room talked straight past is not a question that needs
  // repeating on the screen for ever.
  useEffect(() => {
    if (!current) return;
    const since = finals(log).slice(sinceMark.current).map((c) => c.text).join(" ");
    if (looksAnswered(current, since)) {
      const key = current.key;
      const nextOpen = openRef.current.filter((d) => d.key !== key);
      shout({ kind: "answer", key, text: since.slice(-400), who: "the room", open: nextOpen });
      setCurrent(null);
      setAsked((a) => a.map((x) => (x.key === key ? { ...x, answered: true } : x)));
      setOpen(nextOpen);
    }
  }, [log, current, shout]);

  function pick(option: string) {
    if (!current) return;
    // The answer becomes part of the record the same way a spoken one does —
    // the PRD is built from the transcript, so an answer that only lived in a
    // React state would be an answer the PRD never sees.
    const line = `${myName || "Someone"} answered "${current.question}": ${option}`;
    try {
      localParticipant?.publishData?.(
        new TextEncoder().encode(JSON.stringify({
          id: `agent-${current.at}`, who: myName || "Agent answer",
          text: line, final: true, at: captionEpoch ? Date.now() - captionEpoch : Date.now() - startedAt.current,
        })),
        { reliable: true, topic: "qm-cc" }
      );
    } catch { /* the broadcast below still records it for this meeting */ }
    const key = current.key;
    const nextOpen = openRef.current.filter((d) => d.key !== key);
    shout({ kind: "answer", key, text: option, who: myName, open: nextOpen });
    setAsked((a) => a.map((x) => (x.key === key ? { ...x, answered: true } : x)));
    setOpen(nextOpen);
    setCurrent(null);
  }

  const doneCount = asked.filter((a) => a.answered).length;
  const agentOn = isHost ? on : roomOn;
  const highlightKey = current?.key || (!isHost ? remoteHighlight : "");
  const gaps = specGapStrip({
    open,
    highlightKey,
    agentOn,
    askOnScreen: Boolean(current),
  });

  useGapBroadcast(shout, isHost, on, open, current?.key || "", Boolean(current));

  // An ask on screen should reveal the dim it closes — still below chrome.
  useEffect(() => {
    if (current?.key) setGapsExpanded(true);
  }, [current?.key]);

  return (
    <>
      {isHost ? (
        <button
          className={`qmr-ghost qa-btn${on ? " qmr-on" : ""}`}
          onClick={() => {
            const next = !on;
            setOn(next);
            if (next && !captionsOn) enableCaptions();
            setNote(next
              ? (memory
                  ? memoryOpeningLine(project, rubric.length, { turnedCaptionsOn: !captionsOn })
                  : openingLine(project, rubric.length, { spec, turnedCaptionsOn: !captionsOn }))
              : "");
            if (next && !startedAt.current) startedAt.current = Date.now();
          }}
          aria-pressed={on}
          title={
            memory
              ? (project
                  ? `Ask oral-historian follow-ups so ${project}'s Memory package comes out rich`
                  : "Ask oral-historian questions — chronology, people, turning points, sensory detail, lessons, quotes")
              : (project
                  ? `Ask follow-up questions so ${project}'s ${meta.artifact} comes out complete`
                  : "This meeting has no project, so the agent asks the standard PRD questions")
          }
        >
          {on
            ? `Agent · ${asked.length}/${spec ? SPEC_MAX_QUESTIONS : MAX_QUESTIONS}`
            : (memory ? "Memory agent" : "PRD agent")}
        </button>
      ) : current ? (
        <span className="qmr-ghost qa-btn qa-readonly" title={memory ? "The host's Memory agent is asking the room" : "The host's PRD agent is asking the room"}>
          Agent asking…
        </span>
      ) : null}

      {/* Room-wide: everyone who received the ask broadcast sees the card —
          not only the host who toggled the agent on. Guests answer without
          auth; only generation (/api/agent/question) stays host-signed-in. */}
      {gaps.visible ? (
        <div
          className={`qa-gaps${gapsExpanded ? " is-open" : " is-collapsed"}`}
          role="status"
          aria-label={gapStripAria(sessionMode)}
          style={{ top: Math.max(48, gapsTop) }}
        >
          {gapsExpanded ? (
            <>
              <span className="qa-gaps-kicker">{gapStripKicker(sessionMode)}</span>
              <span className="qa-gapchips">
                {gaps.chips.map((c) => (
                  <span
                    key={c.key}
                    className={`qa-gap${c.highlight ? " is-on" : ""}`}
                    title={c.highlight ? `This question closes ${c.label}` : c.label}
                  >
                    {c.label}
                  </span>
                ))}
                {gaps.more > 0 ? <span className="qa-gap qa-gapmore">+{gaps.more}</span> : null}
              </span>
              <button
                type="button"
                className="qa-gaps-toggle"
                aria-expanded="true"
                onClick={() => setGapsExpanded(false)}
                title="Collapse so chrome stays clear"
              >
                Hide
              </button>
            </>
          ) : (
            <button
              type="button"
              className="qa-gaps-toggle qa-gaps-pill"
              aria-expanded="false"
              onClick={() => setGapsExpanded(true)}
              title={gapStripAria(sessionMode)}
            >
              {gapStripCollapsedLabel(sessionMode, gaps.chips.length + gaps.more)}
            </button>
          )}
        </div>
      ) : null}

      {current ? (
        <div className="qa-card" role="status">
          <div className="qa-head">
            <span className="qa-tag">{meta.artifact} · {current.label}</span>
            <button className="qa-x" aria-label="Dismiss"
              onClick={() => { shout({ kind: "dismiss", key: current.key, at: Date.now() }); setCurrent(null); }}>×</button>
          </div>
          <p className="qa-q">{current.question}</p>
          <div className="qa-opts">
            {current.options.map((o, i) => (
              <button key={i} className="qa-opt" onClick={() => pick(o)}>{o}</button>
            ))}
          </div>
          {current.why ? <p className="qa-why">{current.why}</p> : null}
          <p className="qa-fine">
            {memory
              ? "Answer out loud and it goes in the story — the buttons are for when you would rather not say it."
              : "Answer out loud and it goes in the notes — the buttons are for when you would rather not say it."}
          </p>
        </div>
      ) : null}

      {isHost && on && !current ? (
        <div className="qa-status" role="status">
          <b>{memory ? "Memory agent" : "PRD agent"}{project ? ` · ${project}` : ""}</b>
          <span>{busy ? "Thinking of a question…" : status}</span>
          {/* FIELD 2026-08-25: "I clicked on PRD Agent and I'm not clear what
              it is doing." Most of that was the auth bug — it switched itself
              off without a word — but the rest is this: an agent whose whole
              job is to wait needs to show what it is waiting FOR. Naming the
              parts of the PRD still open turns a blinking box into a
              checklist somebody can see progress against. */}
          {doneCount ? <span className="qa-done">{doneCount} answered</span> : null}
          {note ? <span className="qa-note">{note}</span> : null}
          {captionNote ? <span className="qa-note">{captionNote}</span> : null}
        </div>
      ) : null}
    </>
  );
}

function useGapBroadcast(
  shout: (b: Broadcast) => void,
  isHost: boolean,
  on: boolean,
  open: GapDim[],
  highlightKey: string,
  askOnScreen: boolean,
) {
  const shoutRef = useRef(shout);
  shoutRef.current = shout;
  const openRef = useRef(open);
  openRef.current = open;
  const hiRef = useRef(highlightKey);
  hiRef.current = highlightKey;
  const onRef = useRef(on);
  onRef.current = on;

  const sig = `${on ? 1 : 0}|${highlightKey}|${open.map((d) => d.key).join("|")}`;
  useEffect(() => {
    if (!isHost) return;
    shoutRef.current({
      kind: "gaps",
      open: openRef.current,
      highlightKey: hiRef.current,
      // An ask still on screen keeps the strip up for the room even if the
      // host just switched generation off.
      agentOn: onRef.current || Boolean(hiRef.current),
    });
  }, [isHost, sig]);

  useEffect(() => {
    if (!isHost || (!on && !askOnScreen)) return;
    const iv = window.setInterval(() => {
      shoutRef.current({
        kind: "gaps",
        open: openRef.current,
        highlightKey: hiRef.current,
        agentOn: onRef.current || Boolean(hiRef.current),
      });
    }, 12000);
    return () => window.clearInterval(iv);
  }, [isHost, on, askOnScreen]);
}

function words(log: Caption[]): number {
  let n = 0;
  for (const c of finals(log)) n += String(c.text || "").split(/\s+/).filter(Boolean).length;
  return n;
}

/** The last few minutes, which is the only part a live question can follow
 *  from. The whole meeting goes to /api/prd afterwards; this is the bit that
 *  has to land in the conversation happening now. */
function recentText(log: Caption[]): string {
  const f = finals(log);
  const out: string[] = [];
  let chars = 0;
  for (let i = f.length - 1; i >= 0 && chars < 6000; i--) {
    const line = `${f[i].who}: ${String(f[i].text || "").trim()}`;
    out.unshift(line);
    chars += line.length;
  }
  return out.join("\n");
}

export const AGENT_CSS = `
.qa-btn { white-space:nowrap; }
.qa-readonly { opacity:.85; cursor:default; pointer-events:none; }
.qa-card { position:absolute; right:12px; bottom:96px; z-index:70; width:min(380px, calc(100vw - 24px));
  background:#0d1b1a; border:1px solid #14706a; border-radius:13px; padding:13px 14px;
  display:flex; flex-direction:column; gap:9px; box-shadow:0 18px 44px rgba(0,0,0,.6); }
.qa-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.qa-tag { font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:#7fe0d6; }
.qa-x { font:inherit; font-size:17px; line-height:1; cursor:pointer; background:none; border:0; color:#8b93a5; padding:0 2px; }
.qa-x:hover { color:#e9edf5; }
.qa-q { margin:0; color:#e9edf5; font-size:15px; line-height:1.45; }
.qa-opts { display:flex; flex-direction:column; gap:6px; }
.qa-opt { font:inherit; font-size:13px; text-align:left; cursor:pointer; color:#cfe9e6;
  background:#123130; border:1px solid #1d4f4c; border-radius:9px; padding:8px 11px; line-height:1.4; }
.qa-opt:hover { background:#17403e; border-color:#2a6f6a; }
.qa-why { margin:0; color:#8b93a5; font-size:11.5px; line-height:1.5; }
.qa-fine { margin:0; color:#6c7688; font-size:10.5px; line-height:1.45; }
.qa-status { position:absolute; right:12px; bottom:96px; z-index:70; width:min(320px, calc(100vw - 24px));
  background:#0b0e14; border:1px solid #1c2430; border-radius:11px; padding:10px 12px;
  display:flex; flex-direction:column; gap:3px; box-shadow:0 12px 30px rgba(0,0,0,.5); }
.qa-status b { color:#7fe0d6; font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
.qa-status span { color:#8b93a5; font-size:12px; line-height:1.5; }
.qa-done { color:#7fe0d6 !important; }
.qa-note { color:#f0d9a6 !important; }
.qa-open { color:#6c7688 !important; font-size:10.5px !important; letter-spacing:.06em;
  text-transform:uppercase; line-height:1.5 !important; }
/* Dock BELOW the measured chrome bar (gapsTop). Never overlay Leave / Settings /
   Meeting|Memory / Agent / Copy invite — those live in .qmr-actions above. */
.qa-gaps { position:fixed; left:12px; right:auto; transform:none; z-index:25;
  display:flex; align-items:center; gap:8px; max-width:min(520px, calc(100vw - 24px));
  padding:5px 8px 5px 10px; background:#0d1b1a; border:1px solid #14706a; border-radius:999px;
  box-shadow:0 10px 28px rgba(0,0,0,.45); pointer-events:auto; }
.qa-gaps.is-collapsed { padding:0; background:transparent; border:0; box-shadow:none; }
.qa-gaps-kicker { flex:0 0 auto; font-size:10px; letter-spacing:.12em; text-transform:uppercase;
  color:#7fe0d6; font-weight:600; }
.qa-gapchips { display:flex; gap:5px; min-width:0; overflow:hidden; flex-wrap:wrap; max-height:52px; }
.qa-gap { flex:0 1 auto; max-width:132px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:11.5px; color:#cfe9e6; background:#123130; border:1px solid #1d4f4c;
  border-radius:999px; padding:3px 9px; line-height:1.3; }
.qa-gap.is-on { color:#06110f; background:#7fe0d6; border-color:#7fe0d6; font-weight:600; }
.qa-gapmore { flex:0 0 auto; color:#8b93a5; background:transparent; border-color:#2b3240; }
.qa-gaps-toggle { flex:0 0 auto; font:inherit; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase;
  cursor:pointer; color:#7fe0d6; background:#123130; border:1px solid #1d4f4c; border-radius:999px;
  padding:5px 11px; line-height:1.2; }
.qa-gaps-toggle:hover { border-color:#2a6f6a; color:#cfe9e6; }
.qa-gaps-pill { background:#0d1b1a; border-color:#14706a; box-shadow:0 8px 20px rgba(0,0,0,.4); }
@media (max-width: 720px) {
  .qa-gaps { left:8px; max-width:calc(100vw - 16px); }
  .qa-gaps-kicker { display:none; }
}
`;
