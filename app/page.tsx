"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Home() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [title, setTitle] = useState("");
  const [meetings, setMeetings] = useState<any[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    loadActive();
  }, []);

  async function loadActive() {
    const { data } = await supabase.from("meetings").select("*").eq("active", true).order("started_at", { ascending: false });
    setMeetings(data ?? []);
  }

  async function sendLink() {
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setSent(true);
  }

  async function createMeeting() {
    const room = "room-" + Math.random().toString(36).slice(2, 9);
    await supabase.from("meetings").insert({ room_name: room, title, created_by: user.id });
    router.push(`/meeting/${room}?title=${encodeURIComponent(title)}`);
  }

  if (!user) {
    return (
      <div className="wrap"><div className="card">
        <h1>Quantlys Meeting</h1>
        <p className="muted">Sign in with a magic link.</p>
        {sent ? <p>✅ Check your email for the sign-in link.</p> : (
          <>
            <input placeholder="you@team.com" value={email} onChange={e => setEmail(e.target.value)} />
            <button onClick={sendLink}>Send magic link</button>
          </>
        )}
      </div></div>
    );
  }

  return (
    <div className="wrap"><div className="card">
      <h1>Quantlys Meeting</h1>
      <p className="muted">Signed in as {user.email}</p>
      <input placeholder="Meeting title (e.g. Monday Standup)" value={title} onChange={e => setTitle(e.target.value)} />
      <button disabled={!title} onClick={createMeeting}>New meeting</button>

      <h3 style={{ marginTop: 24 }}>Active meetings</h3>
      {meetings.length === 0 && <p className="muted">None right now.</p>}
      {meetings.map(m => (
        <div className="list-item" key={m.id}>
          <span>{m.title}</span>
          <button className="ghost" onClick={() => router.push(`/meeting/${m.room_name}?title=${encodeURIComponent(m.title)}`)}>Join</button>
        </div>
      ))}
    </div></div>
  );
}
