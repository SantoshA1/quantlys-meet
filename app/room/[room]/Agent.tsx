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
  MAX_QUESTIONS, SPEC_MAX_QUESTIONS, type AgentAsk, type AgentState,
} from "@/lib/agent";
import { rubricFor, metaFor, detectMode } from "@/lib/prd";

/** Its own topic. Captions are a firehose and the agent speaks eight times an
 *  hour; sharing a channel would mean parsing every caption to find them. */
export const AGENT_TOPIC = "qm-agent";

type Broadcast =
  | { kind: "ask"; ask: AgentAsk }
  | { kind: "answer"; key: string; text: string; who: string }
  | { kind: "dismiss"; key: string; at: number };

export default function Agent({
  room, project, log, myName, spec = false, isHost = false,
  captionsOn, enableCaptions, captionEpoch, captionNote,
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
}) {
  const [on, setOn] = useState(!!spec);
  const [asked, setAsked] = useState<AgentAsk[]>([]);
  const [current, setCurrent] = useState<AgentAsk | null>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Array<{ key: string; label: string; status: string }>>([]);

  const startedAt = useRef(0);
  const lastAskAt = useRef(0);
  const wordsAtLastAsk = useRef(0);
  const lastWordsAt = useRef<number | null>(null);
  const wordsSeen = useRef(0);
  const sinceMark = useRef(0);
  const inFlight = useRef(false);
  const { localParticipant } = useLocalParticipant();

  const mode = detectMode(`${project} ${room}`);
  const meta = metaFor(mode);
  const rubric = rubricFor(mode);

  // Everyone in the room sees the same question at the same time. An agent
  // that whispers to the host is a note-taking tool; one that speaks into the
  // room is a participant, and only the second one gets answered out loud.
  const { send } = useDataChannel(AGENT_TOPIC, (msg) => {
    try {
      const b: Broadcast = JSON.parse(new TextDecoder().decode(msg.payload));
      if (b?.kind === "ask" && b.ask?.key) {
        setCurrent(b.ask);
        setAsked((a) => (a.some((x) => x.at === b.ask.at) ? a : [...a, b.ask]));
      } else if (b?.kind === "dismiss") {
        setCurrent((c) => (c && c.key === b.key ? null : c));
      } else if (b?.kind === "answer") {
        setCurrent((c) => (c && c.key === b.key ? null : c));
        setAsked((a) => a.map((x) => (x.key === b.key ? { ...x, answered: true } : x)));
        // Live answer closes that dim for the next ask — do not re-ask it.
        setOpen((o) => o.filter((d) => d.key !== b.key));
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
    if (!on) return;
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
  }, [on, project, rubric]);

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
      shout({ kind: "ask", ask: item });
    } catch (e: any) {
      setNote(`The agent hit an error: ${e?.message || String(e)}`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [project, mode, log, shout, spec]);

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
      const state: AgentState = {
        on: true,
        ...clock,
        asked,
        open,
        pending: Boolean(current),
        spec: Boolean(spec),
        hearing: Boolean(captionsOn),
      };
      const verdict = shouldAsk(state);
      setStatus(statusLine(state, verdict));
      if (verdict.ask && verdict.key && !inFlight.current) {
        ask(state, verdict.key, recentText(log));
      }
    };
    tick();
    const iv = window.setInterval(tick, 5000);
    return () => window.clearInterval(iv);
  }, [isHost, on, log, asked, open, current, ask, spec, captionsOn]);

  // A question the room talked straight past is not a question that needs
  // repeating on the screen for ever.
  useEffect(() => {
    if (!current) return;
    const since = finals(log).slice(sinceMark.current).map((c) => c.text).join(" ");
    if (looksAnswered(current, since)) {
      const key = current.key;
      shout({ kind: "answer", key, text: since.slice(-400), who: "the room" });
      setCurrent(null);
      setAsked((a) => a.map((x) => (x.key === key ? { ...x, answered: true } : x)));
      setOpen((o) => o.filter((d) => d.key !== key));
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
    shout({ kind: "answer", key, text: option, who: myName });
    setAsked((a) => a.map((x) => (x.key === key ? { ...x, answered: true } : x)));
    setOpen((o) => o.filter((d) => d.key !== key));
    setCurrent(null);
  }

  const doneCount = asked.filter((a) => a.answered).length;

  return (
    <>
      {isHost ? (
        <button
          className={`qmr-ghost qa-btn${on ? " qmr-on" : ""}`}
          onClick={() => {
            const next = !on;
            setOn(next);
            if (next && !captionsOn) enableCaptions();
            setNote(next ? openingLine(project, rubric.length, { spec, turnedCaptionsOn: !captionsOn }) : "");
            if (next && !startedAt.current) startedAt.current = Date.now();
          }}
          aria-pressed={on}
          title={
            project
              ? `Ask follow-up questions so ${project}'s ${meta.artifact} comes out complete`
              : "This meeting has no project, so the agent asks the standard PRD questions"
          }
        >
          {on ? `Agent · ${asked.length}/${spec ? SPEC_MAX_QUESTIONS : MAX_QUESTIONS}` : "PRD agent"}
        </button>
      ) : current ? (
        <span className="qmr-ghost qa-btn qa-readonly" title="The host's PRD agent is asking the room">
          Agent asking…
        </span>
      ) : null}

      {/* Room-wide: everyone who received the ask broadcast sees the card —
          not only the host who toggled the agent on. Guests answer without
          auth; only generation (/api/agent/question) stays host-signed-in. */}
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
          <p className="qa-fine">Answer out loud and it goes in the notes — the buttons are for when you would rather not say it.</p>
        </div>
      ) : null}

      {isHost && on && !current ? (
        <div className="qa-status" role="status">
          <b>PRD agent{project ? ` · ${project}` : ""}</b>
          <span>{busy ? "Thinking of a question…" : status}</span>
          {/* FIELD 2026-08-25: "I clicked on PRD Agent and I'm not clear what
              it is doing." Most of that was the auth bug — it switched itself
              off without a word — but the rest is this: an agent whose whole
              job is to wait needs to show what it is waiting FOR. Naming the
              parts of the PRD still open turns a blinking box into a
              checklist somebody can see progress against. */}
          {open.length ? (
            <span className="qa-open">
              STILL OPEN — {open.map((d) => d.label).slice(0, 6).join(" · ")}
              {open.length > 6 ? ` · +${open.length - 6}` : ""}
            </span>
          ) : null}
          {doneCount ? <span className="qa-done">{doneCount} answered</span> : null}
          {note ? <span className="qa-note">{note}</span> : null}
          {captionNote ? <span className="qa-note">{captionNote}</span> : null}
        </div>
      ) : null}
    </>
  );
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
`;
