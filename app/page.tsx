"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Home() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  // guest join
  const [joinInput, setJoinInput] = useState("");
  // host code auth
  const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  function goJoin() {
    const v = joinInput.trim();
    if (!v) return;
    // Accept a full link OR a bare room code.
    let room = v;
    try { const u = new URL(v); room = u.pathname.split("/meeting/")[1]?.split("/")[0] || v; } catch {}
    router.push(`/meeting/${room}`);
  }

  async function sendCode() {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { shouldCreateUser: true }, // NO emailRedirectTo → code, not link
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setStage("code");
  }
  async function verify() {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setErr("That code didn't work — check it or request a new one.");
  }

  return (
    <div className="wrap">
      {/* JOIN A MEETING — no account needed */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h1>Join a meeting</h1>
        <p className="muted">Paste a meeting link or code — no account needed.</p>
        <input placeholder="Meeting link or code" value={joinInput}
          onChange={e => setJoinInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && goJoin()} />
        <button disabled={!joinInput.trim()} onClick={goJoin}
          style={{ width: "100%" }}>Join as guest</button>
      </div>

      {/* HOST SIGN-IN — 6-digit code */}
      <div className="card">
        {user ? (
          <>
            <h2>Host a meeting</h2>
            <p className="muted">Signed in as {user.email}</p>
            {/* create-meeting + active list unchanged */}
          </>
        ) : stage === "email" ? (
          <>
            <h2>Sign in to host</h2>
            <p className="muted">Hosting requires an account. We'll email a 6-digit code.</p>
            <input type="email" placeholder="you@team.com" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && email && sendCode()} />
            <button disabled={!email || busy} onClick={sendCode} style={{ width: "100%" }}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <h2>Enter your code</h2>
            <p className="muted">6-digit code sent to <b>{email}</b>.</p>
            <input inputMode="numeric" maxLength={6} autoFocus placeholder="000000" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && code.length === 6 && verify()}
              style={{ letterSpacing: "0.4em", textAlign: "center", fontSize: 22 }} />
            <button disabled={code.length !== 6 || busy} onClick={verify} style={{ width: "100%" }}>
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <p className="muted" style={{ marginTop: 10 }}>
              <a onClick={sendCode} style={{ color: "var(--brand)", cursor: "pointer" }}>Email me a new code</a>
              {" · "}
              <a onClick={() => { setStage("email"); setCode(""); }} style={{ color: "var(--muted)", cursor: "pointer" }}>Change email</a>
            </p>
          </>
        )}
        {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
      </div>
    </div>
  );
}
