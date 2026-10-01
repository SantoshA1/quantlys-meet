"use client";

// MEETING INTELLIGENCE — the last meeting, read back to you.
//
// DESIGN 2026-08-18. The centrepiece of the console: what happened, what was
// decided, who owes what, and a talk-density strip you can reconcile against
// the recording. Everything here is read from the summary JSON the finish
// route already writes — this panel never asks a model anything, it renders
// what the pipeline proved.

import { useCallback, useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bars, balance, markers, hms, type Utt, type Marker } from "@/lib/intelligence";
import { resolveSessionMode } from "@/lib/session-ui";

let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _db;
}

const VIDEO_EXT = /\.(mp4|webm)$/i;
const SUMMARY_EXT = /\.summary\.json$/i;

export type OpenRow = {
  id: string;
  room_name: string;
  text: string;
  owner: string | null;
  ts_seconds: number | null;
};

type Summary = {
  room: string;
  title?: string;
  summaryText?: string;
  decisions?: string[];
  actions?: string[];
  utterances?: Utt[];
  people?: string[];
  transcript?: string;
  summary?: string;
  sessionMode?: string;
  createdAt?: string;
  videoPath?: string;
};

async function listAll(prefix: string, cap: number) {
  const out: any[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const r = await db().storage.from("recordings").list(prefix, { limit: 100, offset });
    if (r.error) return out;
    const page = r.data ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export default function Intelligence({
  userId,
  openItems,
  onTick,
}: {
  userId: string;
  openItems: OpenRow[];
  onTick: (id: string) => void;
}) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [when, setWhen] = useState("");
  const [state, setState] = useState<"loading" | "none" | "ready">("loading");
  const [showTranscript, setShowTranscript] = useState(false);
  const [shared, setShared] = useState(false);

  const load = useCallback(async () => {
    // Newest meeting folder that has BOTH a recording and a summary. Walk
    // newest-first and stop at the first hit rather than downloading history.
    const rooms = await listAll(userId, 2000);
    const folders = rooms.filter((f: any) => !f.id).map((f: any) => f.name);
    type Cand = { path: string; stem: string; room: string };
    const cands: Cand[] = [];
    for (const room of folders) {
      const files = await listAll(`${userId}/${room}`, 1000);
      for (const f of files) {
        if (SUMMARY_EXT.test(f.name)) {
          const stem = f.name.replace(SUMMARY_EXT, "");
          if (files.some((v: any) => VIDEO_EXT.test(v.name) && v.name.startsWith(stem))) {
            cands.push({ path: `${userId}/${room}/${f.name}`, stem, room });
          }
        }
      }
    }
    if (!cands.length) { setState("none"); return; }
    cands.sort((a, b) => (a.stem < b.stem ? 1 : -1));
    const { data, error } = await db().storage.from("recordings").download(cands[0].path);
    if (error || !data) { setState("none"); return; }
    try {
      const j = JSON.parse(await data.text()) as Summary;
      setSum(j);
      setWhen(cands[0].stem.replace("T", " · ").slice(0, 18));
      setState("ready");
    } catch { setState("none"); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (state === "loading") {
    return (
      <section className="qh-panel">
        <div className="qh-panelhead"><span className="qh-eyebrow">MEETING INTELLIGENCE</span></div>
        <p className="qh-dim">Reading your last meeting…</p>
      </section>
    );
  }
  if (state === "none" || !sum) {
    return (
      <section className="qh-panel">
        <div className="qh-panelhead"><span className="qh-eyebrow">MEETING INTELLIGENCE</span></div>
        <p className="qh-dim">
          Your first recorded meeting will be read back here — what happened, what was
          decided, and who owes what. Record one and this panel writes itself.
        </p>
      </section>
    );
  }

  const memory = resolveSessionMode(sum.sessionMode) === "memory";
  const utts: Utt[] = Array.isArray(sum.utterances) ? sum.utterances : [];
  const strip = bars(utts, 28);
  const bal = balance(utts);
  const marks: Marker[] = markers(sum.decisions || [], sum.actions || [], utts);
  const endSec = utts.length ? Math.max(...utts.map((u) => Number(u.start) || 0)) + 4 : 0;
  const speakers = (sum.people?.length || 0) ||
    new Set(utts.map((u) => u.speaker).filter((s) => typeof s === "number")).size;
  const readyAfter = (() => {
    // "READY 4 MIN AFTER THE MEETING ENDED" — only when both clocks exist.
    if (!sum.createdAt || !endSec) return "";
    const stemTime = Date.parse(when.replace(" · ", "T") + ":00Z");
    if (!Number.isFinite(stemTime)) return "";
    const mins = Math.round((Date.parse(sum.createdAt) - (stemTime + endSec * 1000)) / 60000);
    return mins >= 0 && mins < 120
      ? `READY ${mins} MIN AFTER THE ${memory ? "SESSION" : "MEETING"} ENDED`
      : "";
  })();

  // WHO OWES WHAT: the open rows for THIS meeting are tickable; anything the
  // notes extracted beyond the open rows renders as plain text — done items
  // don't grow checkboxes back.
  const roomOpen = openItems.filter((it) => it.room_name === sum.room);
  const openTexts = new Set(roomOpen.map((r) => r.text));
  const extraActions = (sum.actions || []).filter((a) => !openTexts.has(a)).slice(0, 5);
  // Memory sessions are not an action-item queue. Keep their open threads
  // readable, but never turn them into meeting commitments with checkboxes.
  const memoryThreads = memory ? (sum.actions || []).slice(0, 5) : [];

  async function shareNotes() {
    try {
      await navigator.clipboard.writeText(sum!.summary || sum!.summaryText || "");
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    } catch { /* clipboard denied — the button simply doesn't confirm */ }
  }

  return (
    <section className="qh-panel">
      <div className="qh-panelhead">
        <span className="qh-eyebrow">{memory ? "MEMORY INTELLIGENCE" : "MEETING INTELLIGENCE"}</span>
        {readyAfter ? <span className="qh-ready"><span className="q-dot q-beat" /> {readyAfter}</span> : null}
        <span className="qh-spacer" />
        {sum.transcript ? (
          <button className="qh-ghost" onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "HIDE TRANSCRIPT" : "FULL TRANSCRIPT"}
          </button>
        ) : null}
        {(sum.summary || sum.summaryText) ? (
          <button className="qh-ghost" onClick={shareNotes}>{shared ? "COPIED" : memory ? "SHARE STORY" : "SHARE NOTES"}</button>
        ) : null}
      </div>

      <div className="qh-introw">
        <div>
          <h2 className="qh-mtitle">{sum.title || (memory ? "Your last session" : "Your last meeting")}</h2>
          <p className="qh-msub">
            {when.toUpperCase()}
            {endSec ? <> <span className="qh-sep">│</span> {hms(endSec)} RUNTIME</> : null}
            {speakers ? <> <span className="qh-sep">│</span> {speakers} SPEAKER{speakers === 1 ? "" : "S"}</> : null}
          </p>
        </div>
        <div className="qh-stats">
          <div className="qh-stat"><i>{memory ? "TURNING POINTS" : "DECISIONS"}</i><b>{(sum.decisions || []).length}</b></div>
          <div className="qh-stat"><i>{memory ? "MOMENTS" : "ACTIONS"}</i><b>{(sum.actions || []).length}</b></div>
          {bal !== null ? (
            <div className="qh-stat" title="How evenly the room talked: (1 − loudest share) ÷ (1 − 1/speakers). 1 is perfectly shared, 0 is a monologue.">
              <i>TALK BALANCE</i><b>{bal.toFixed(2)}</b>
            </div>
          ) : null}
        </div>
      </div>

      {strip.length ? (
        <div className="qh-strip">
          <div className="qh-bars">
            {strip.map((h, i) => (
              <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
          <div className="qh-stripmeta">
            <span>00:00</span>
            {marks.map((m) => (
              <span key={m.at} className={`qh-mark ${m.kind === "decision" ? "is-dec" : "is-act"}`}>
                ◆ {hms(m.at)} {m.label}
              </span>
            ))}
            <span>{hms(endSec)}</span>
          </div>
        </div>
      ) : null}

      <div className="qh-cols">
        <div>
          <p className="qh-label">{memory ? "THE STORY SO FAR" : "WHAT HAPPENED"}</p>
          {sum.summaryText ? (
            <p className="qh-body">{sum.summaryText}</p>
          ) : (
            <p className="qh-dim">The notes for this {memory ? "session" : "meeting"} carry no overview.</p>
          )}
          {(sum.decisions || []).slice(0, 4).map((d, i) => {
            const at = marks.find((m) => m.kind === "decision" && d.toUpperCase().includes(m.label.split(" ")[0] || "§"));
            return (
              <div className="qh-decision" key={i}>
                {at ? <span className="qh-at">{hms(at.at)}</span> : null}
                <span>{d.replace(/^[^—]*—\s*/, "")} <em>— {memory ? "turning point" : "decided"}</em></span>
              </div>
            );
          })}
        </div>
        <div>
          <p className="qh-label">
            {memory ? "OPEN THREADS" : "WHO OWES WHAT"}{" "}
            {(sum.actions || []).length ? <em className="qh-count">{(sum.actions || []).length} EXTRACTED</em> : null}
          </p>
          {((!memory && roomOpen.length === 0 && extraActions.length === 0) || (memory && memoryThreads.length === 0)) ? (
            <p className="qh-dim">{memory ? "No open threads were drawn out in this session." : "No commitments were caught in this meeting."}</p>
          ) : null}
          {!memory && roomOpen.map((it) => (
            <label className="qh-owe" key={it.id}>
              <input type="checkbox" onChange={() => onTick(it.id)} aria-label={`Mark done: ${it.text}`} />
              <span>
                <b>{it.text}</b>
                <em>
                  {(it.owner || "UNOWNED").toUpperCase()}
                  {it.ts_seconds !== null && it.ts_seconds !== undefined ? ` · ${hms(it.ts_seconds)}` : ""}
                </em>
              </span>
            </label>
          ))}
          {memory ? memoryThreads.map((a, i) => (
            <div className="qh-owe is-plain" key={`m${i}`}>
              <span className="qh-tickmark">•</span>
              <span><b>{a.replace(/^[^—]*—\s*/, "")}</b></span>
            </div>
          )) : extraActions.map((a, i) => (
            <div className="qh-owe is-plain" key={`x${i}`}>
              <span className="qh-tickmark">✓</span>
              <span><b>{a.replace(/^[^—]*—\s*/, "")}</b><em>{(a.match(/^([^—]*)—/) || [])[1]?.trim().toUpperCase() || ""}</em></span>
            </div>
          ))}
        </div>
      </div>

      {showTranscript && sum.transcript ? (
        <div className="qh-transcript">
          {utts.length ? (
            utts.slice(0, 800).map((u, i) => (
              <p key={i}>
                <span className="qh-at">{hms(Number(u.start) || 0)}</span>
                <span className="qh-who">
                  {typeof u.speaker === "number" && u.speaker >= 0 ? `Speaker ${u.speaker + 1}` : "—"}
                </span>
                {u.transcript}
              </p>
            ))
          ) : (
            <pre>{sum.transcript}</pre>
          )}
        </div>
      ) : null}
    </section>
  );
}
