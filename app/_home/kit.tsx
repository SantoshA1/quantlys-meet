"use client";

// Shared bits for the B/C direction previews. Copy here is reused from the
// live homepage / v2 so every claim maps to a shipped feature.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { guestJoinUiAllowed } from "@/lib/guest-join";

export const GH = "https://github.com/SantoshA1/quantlys-meet";
export const RELEASE = "https://github.com/SantoshA1/quantlys-meet/releases/tag/v1.0.0-oss";

let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_db) _db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return _db;
}

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="qp-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeOpacity=".35" strokeWidth="1">
        <path d="M4 4 L18 12" /><path d="M3 12 L18 12" /><path d="M4 20 L18 12" />
        <path d="M9 7 L18 12" /><path d="M9 17 L18 12" />
      </g>
      <g fill="currentColor" fillOpacity=".55">
        <circle cx="4" cy="4" r="1.6" /><circle cx="3" cy="12" r="1.6" /><circle cx="4" cy="20" r="1.6" />
        <circle cx="9" cy="7" r="1.3" /><circle cx="9" cy="17" r="1.3" />
      </g>
      <circle cx="18.5" cy="12" r="3.2" fill="#2DD4BF" />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Paste a link or code; same lookup as the live homepage. */
export function JoinBox() {
  const router = useRouter();
  const guestsOk = guestJoinUiAllowed({ NEXT_PUBLIC_ALLOW_GUEST_JOIN: process.env.NEXT_PUBLIC_ALLOW_GUEST_JOIN });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function join() {
    const raw = code.trim();
    const room = raw.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "";
    if (!room || busy) return;
    setBusy(true); setNote("");
    const { data, error } = await db().rpc("meeting_by_code", { code: room });
    setBusy(false);
    if (error) { router.push(`/room/${room}`); return; }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setNote("That link or code doesn't match a meeting that's running. Check it and try again.");
      return;
    }
    const found = Array.isArray(data) ? data[0] : data;
    router.push(`/room/${found.room_name || room}`);
  }
  if (!guestsOk) return <p className="qp-muted">Guest join is off on this deployment.</p>;
  return (
    <div className="qp-joinbox">
      <div className="qp-row">
        <input className="qp-input" placeholder="Have a link? Paste a meeting link or code" aria-label="Meeting link or code"
          value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && join()} />
        <button className="qp-btn qp-btn-g" onClick={join} disabled={busy || !code.trim()}>{busy ? "Finding…" : "Join as guest"}</button>
      </div>
      {note ? <p className="qp-note">{note}</p> : null}
    </div>
  );
}

export const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "What is Quantlys Meeting?", a: <>A browser video meeting. Guests join from a link. The recorded session writes a markdown PRD: user stories, acceptance criteria, decisions, and open questions.</> },
  { q: "Is Quantlys Meeting the same as Quantalys?", a: <>No. Quantlys Meeting is a spec-session video product at quantlys-meeting.com. Quantalys is an unrelated fund-data company.</> },
  { q: "Is it open source?", a: <>Yes — MIT at <a href={GH}>github.com/SantoshA1/quantlys-meet</a>. Bring your own LiveKit, Deepgram, Supabase, and model keys. Details: <Link href="/open-source-video-meeting">open-source video meeting</Link>.</> },
  { q: "What is Memory mode?", a: <>A second host-console surface for podcasts (chapters/clips), books, and oral history — not a product-review PRD. Each episode downloads as one continuous HD 720p video (MP4 or WebM), captions (.vtt / .srt), audio (m4a + WAV cuts), and a markdown package. <Link href="/memory-mode">Memory mode</Link>.</> },
];

export function Foot() {
  return (
    <footer className="qp-foot">
      <div className="qp-foot-top">
        <div>
          <Link href="/" className="qp-brand"><Mark /><span>Quantlys <em>Meeting</em></span></Link>
          <p>The video meeting that leaves a spec. Built on <a href="https://www.quantlys.ai/">Quantlys</a> by <a href="https://santoshadari.com/">Santosh Adari</a>.</p>
        </div>
        <div className="qp-foot-cols">
          <div>
            <Link href="/host">Host</Link><Link href="/memory-mode">Memory</Link><Link href="/example-prd">Example PRD</Link>
            <Link href="/browser-video-meeting-no-download">No-download meetings</Link><Link href="/podcast-recording-in-browser">Podcast recording</Link>
          </div>
          <div>
            <Link href="/ai-meeting-assistant-prd">AI meeting assistant → PRD</Link><Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
            <Link href="/prd-from-meeting">PRD from meeting</Link><Link href="/notes-vs-prd">Notes vs PRD</Link><Link href="/recap-vs-prd">Recap vs a PRD</Link>
          </div>
          <div>
            <Link href="/open-source-video-meeting">Open-source video conferencing</Link><Link href="/open-source-zoom-alternative">Open-source Zoom alternative</Link>
            <Link href="/self-hosted-video-conferencing">Self-hosted video conferencing</Link><a href={GH}>GitHub</a><a href={RELEASE}>v1.0.0-oss</a>
          </div>
          <div>
            <Link href="/about">About</Link><Link href="/privacy">Privacy</Link><a href="https://www.quantlys.ai/">Built on Quantlys</a>
          </div>
        </div>
      </div>
      <div className="qp-foot-bot">
        <span>© Quantlys · Agility Business Services · <a href="https://www.quantlys.ai/">quantlys.ai</a></span>
        <span className="qp-mono">MIT · v1.0.0-oss</span>
      </div>
    </footer>
  );
}
