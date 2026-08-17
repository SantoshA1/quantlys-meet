"use client";

// The host console. Deliberately self-contained: it makes its own Supabase
// client from the public env vars and carries its own styles, so it cannot
// be broken by, and cannot break, anything else in the app.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Recordings from "./Recordings";

type Meeting = {
  id: string;
  room_name: string;
  title: string | null;
  active: boolean | null;
  started_at: string | null;
};

let _client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

export default function HostConsole() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [title, setTitle] = useState("");
  const [mine, setMine] = useState<Meeting[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    db()
      .auth.getSession()
      .then(({ data }) => {
        setUser((data.session?.user as any) ?? null);
        setReady(true);
      });
    const { data: sub } = db().auth.onAuthStateChange((_e, session) => {
      setUser((session?.user as any) ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadMine = useCallback(async () => {
    if (!user) return;
    const { data } = await db()
      .from("meetings")
      .select("id, room_name, title, active, started_at")
      .eq("created_by", user.id)
      .order("started_at", { ascending: false })
      .limit(20);
    setMine((data as Meeting[]) ?? []);
  }, [user]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  function inviteLink(room: string) {
    return `${window.location.origin}/room/${room}`;
  }

  async function sendCode() {
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    const { error } = await db().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setNote(error.message);
      return;
    }
    setStage("code");
    setNote(`We emailed a sign-in code to ${address}.`);
  }

  async function verify() {
    const token = code.trim();
    if (!token || busy) return;
    setBusy(true);
    setNote("");
    const { error } = await db().auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setNote(`${error.message} — codes expire after a few minutes; send a new one if needed.`);
      return;
    }
    setCode("");
    setStage("email");
  }

  async function startMeeting() {
    if (!user || busy) return;
    setBusy(true);
    setNote("");
    const room = "qm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const { error } = await db().from("meetings").insert({
      room_name: room,
      title: title.trim() || "Quantlys Meeting",
      created_by: user.id,
    });
    setBusy(false);
    if (error) {
      setNote(`Could not start the meeting: ${error.message}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink(room));
    } catch {
      /* clipboard is a nicety, never a blocker */
    }
    setTitle("");
    router.push(`/room/${room}`);
  }

  async function copyInvite(room: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(room));
      setCopied(room);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setNote(inviteLink(room));
    }
  }

  async function endMeeting(id: string) {
    await db().from("meetings").update({ active: false, ended_at: new Date().toISOString() }).eq("id", id);
    loadMine();
  }

  async function signOut() {
    await db().auth.signOut();
    setMine([]);
    setStage("email");
    setNote("");
  }

  return (
    <main className="qm-wrap">
      <style>{CSS}</style>

      <header className="qm-bar">
        <span className="qm-logo">Quantlys Meeting</span>
        {user ? (
          <button className="qm-ghost" onClick={signOut}>
            Sign out
          </button>
        ) : null}
      </header>

      {!ready ? (
        <p className="qm-muted">Loading…</p>
      ) : !user ? (
        <section className="qm-card">
          <h1>Sign in to host</h1>
          <p className="qm-muted">
            Only the host needs an account. Everyone you invite joins with one click, no sign-up.
          </p>
          {stage === "email" ? (
            <div className="qm-row">
              <input
                className="qm-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
              />
              <button className="qm-primary" onClick={sendCode} disabled={busy}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </div>
          ) : (
            <div className="qm-row">
              <input
                className="qm-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verify()}
              />
              <button className="qm-primary" onClick={verify} disabled={busy}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <button className="qm-ghost" onClick={sendCode} disabled={busy}>
                Send a new code
              </button>
            </div>
          )}
          {note ? <p className="qm-note">{note}</p> : null}
        </section>
      ) : (
        <>
          <section className="qm-card">
            <h1>Start a meeting</h1>
            <p className="qm-muted">
              Signed in as {user.email}. Starting a meeting copies its invite link straight to your
              clipboard.
            </p>
            <div className="qm-row">
              <input
                className="qm-input"
                placeholder="Meeting name (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startMeeting()}
              />
              <button className="qm-primary" onClick={startMeeting} disabled={busy}>
                {busy ? "Starting…" : "Start a meeting"}
              </button>
            </div>
            {note ? <p className="qm-note">{note}</p> : null}
          </section>

          <section className="qm-card">
            <h2>Your meetings</h2>
            {mine.length === 0 ? (
              <p className="qm-muted">Nothing yet — start one above and share the link.</p>
            ) : (
              mine.map((m) => (
                <div className="qm-item" key={m.id}>
                  <span className="qm-name">
                    {m.title || "Quantlys Meeting"}
                    {m.active === false ? <em className="qm-ended"> · ended</em> : null}
                  </span>
                  <span className="qm-row">
                    <button className="qm-ghost" onClick={() => copyInvite(m.room_name)}>
                      {copied === m.room_name ? "Copied" : "Copy invite link"}
                    </button>
                    <button className="qm-ghost" onClick={() => router.push(`/room/${m.room_name}`)}>
                      Open
                    </button>
                    {m.active === false ? null : (
                      <button className="qm-ghost" onClick={() => endMeeting(m.id)}>
                        End
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </section>

          <Recordings userId={user.id} />
        </>
      )}
    </main>
  );
}

const CSS = `
.qm-wrap { max-width: 760px; margin: 0 auto; padding: 24px 20px 72px;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; }
.qm-bar { display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 18px; border-bottom: 1px solid #262b36; margin-bottom: 24px; }
.qm-logo { font-weight: 600; letter-spacing: .01em; }
.qm-card { background: #171a22; border: 1px solid #262b36; border-radius: 14px;
  padding: 22px; margin-bottom: 18px; }
.qm-card h1 { font-size: 21px; margin: 0 0 6px; }
.qm-card h2 { font-size: 16px; margin: 0 0 12px; }
.qm-muted { color: #8b93a5; font-size: 14px; margin: 0 0 16px; }
.qm-note { color: #8fd8cf; font-size: 14px; margin: 14px 0 0; }
.qm-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.qm-input { flex: 1 1 230px; min-width: 0; background: #10131a;
  border: 1px solid #2b3240; border-radius: 10px; padding: 11px 13px;
  color: #e9edf5; font: inherit; }
.qm-input:focus { outline: none; border-color: #00a99d; }
.qm-wrap button { font: inherit; cursor: pointer; border-radius: 10px;
  padding: 11px 18px; width: auto; white-space: nowrap; }
.qm-wrap button:disabled { opacity: .55; cursor: default; }
.qm-primary { background: #00a99d; color: #06110f; border: 0; font-weight: 600; }
.qm-ghost { background: transparent; color: #cfd6e4; border: 1px solid #2b3240; }
.qm-ghost:hover { border-color: #3b4356; }
.qm-item { display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding: 12px 0; border-bottom: 1px solid #262b36; flex-wrap: wrap; }
.qm-item:last-child { border-bottom: 0; }
.qm-name { font-size: 15px; }
.qm-ended { color: #8b93a5; font-style: normal; font-size: 13px; }
.qm-player { width: 100%; border-radius: 10px; background: #000; margin-bottom: 14px; }
`;
