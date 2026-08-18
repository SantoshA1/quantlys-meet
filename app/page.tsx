"use client";

// The front door. Deliberately self-contained: its own Supabase client from
// the public env vars, its own styles. Guests join here with no account;
// hosts are sent to their console. There is nothing on this page that ends
// in a dead end.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => {
        setEmail(data.session?.user?.email ?? null);
        setReady(true);
      });
  }, []);

  // "qm-abc123", a full link, or a link with a query string — all the same room.
  function roomFrom(input: string) {
    const raw = input.trim();
    if (!raw) return "";
    const last = raw.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "";
    return last;
  }

  async function joinAsGuest() {
    const room = roomFrom(code);
    if (!room || busy) return;
    setBusy(true);
    setNote("");
    // meetings are owner-only by design, so a guest looks up the one room
    // they were given by its exact code and nothing else.
    const { data, error } = await db().rpc("meeting_by_code", { code: room });
    setBusy(false);
    if (error) {
      // Never strand someone over a lookup: the room name is what matters.
      router.push(`/room/${room}`);
      return;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setNote("That link or code doesn't match a meeting that's running. Check it and try again.");
      return;
    }
    const found = Array.isArray(data) ? data[0] : data;
    router.push(`/room/${found.room_name || room}`);
  }

  return (
    <main className="qmh-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="qmh-bar">
        <span className="qmh-logo">Quantlys Meeting</span>
      </header>

      <section className="qmh-card">
        <h1>Join a meeting</h1>
        <p className="qmh-muted">Paste a meeting link or code — no account needed.</p>
        <div className="qmh-row">
          <input
            className="qmh-input"
            placeholder="Meeting link or code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinAsGuest()}
            autoFocus
          />
          <button className="qmh-primary" onClick={joinAsGuest} disabled={busy || !code.trim()}>
            {busy ? "Finding…" : "Join as guest"}
          </button>
        </div>
        {note ? <p className="qmh-note">{note}</p> : null}
      </section>

      <section className="qmh-card">
        <h2>Host a meeting</h2>
        {!ready ? (
          <p className="qmh-muted">Loading…</p>
        ) : email ? (
          <>
            <p className="qmh-muted">
              Signed in as {email}. Your meetings, invite links and recordings live on your host
              page.
            </p>
            <div className="qmh-row">
              <button className="qmh-primary" onClick={() => router.push("/host")}>
                Go to my host page
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="qmh-muted">
              Only the host needs an account. We'll email you a 6-digit code — everyone you invite
              joins with one click.
            </p>
            <div className="qmh-row">
              <button className="qmh-primary" onClick={() => router.push("/host")}>
                Sign in to host
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

const CSS = `
.qmh-wrap { max-width: 720px; margin: 0 auto; padding: 24px 20px 72px;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; }
.qmh-bar { display: flex; align-items: center; padding-bottom: 18px;
  border-bottom: 1px solid #262b36; margin-bottom: 24px; }
.qmh-logo { font-weight: 600; letter-spacing: .01em; }
.qmh-card { background: #171a22; border: 1px solid #262b36; border-radius: 14px;
  padding: 22px; margin-bottom: 18px; }
.qmh-card h1 { font-size: 21px; margin: 0 0 6px; }
.qmh-card h2 { font-size: 17px; margin: 0 0 6px; }
.qmh-muted { color: #8b93a5; font-size: 14px; margin: 0 0 16px; }
.qmh-note { color: #ffb4b4; font-size: 14px; margin: 14px 0 0; }
.qmh-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.qmh-input { flex: 1 1 240px; min-width: 0; background: #10131a;
  border: 1px solid #2b3240; border-radius: 10px; padding: 11px 13px;
  color: #e9edf5; font: inherit; }
.qmh-input:focus { outline: none; border-color: #00a99d; }
.qmh-wrap button { font: inherit; cursor: pointer; border-radius: 10px;
  padding: 11px 18px; width: auto; white-space: nowrap; }
.qmh-wrap button:disabled { opacity: .55; cursor: default; }
.qmh-primary { background: #00a99d; color: #06110f; border: 0; font-weight: 600; }
`;
