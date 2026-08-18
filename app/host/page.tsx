"use client";

// The host console. Deliberately self-contained: it makes its own Supabase
// client from the public env vars and carries its own styles, so it cannot
// be broken by, and cannot break, anything else in the app.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Recordings from "./Recordings";
import Search from "./Search";

type Meeting = {
  id: string;
  room_name: string;
  title: string | null;
  active: boolean | null;
  started_at: string | null;
  scheduled_at: string | null;
  project: string | null;
};

type ActionItem = {
  id: string;
  project: string | null;
  room_name: string;
  meeting_title: string | null;
  text: string;
  owner: string | null;
  ts_seconds: number | null;
  met_at: string;
};

const DAYNAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL = ["", "first", "second", "third", "fourth", "last"];

/** The repeat rule in words, from the date the host actually picked. Shown
 *  under the picker because nobody can proof-read FREQ=MONTHLY;BYSETPOS=3, and
 *  a recurring meeting that lands on the wrong day repeats the mistake. */
function saysRepeat(freq: string, startAt: string, times: string): string {
  if (!freq) return "";
  const d = startAt ? new Date(startAt) : null;
  if (!d || isNaN(d.getTime())) return "Pick a date first and this will say what it means.";
  const day = d.getDay();       // the BROWSER'S day — the same clock the host set it in
  const nth = Math.ceil(d.getDate() / 7);
  let base =
    freq === "WEEKDAYS" ? "Every weekday" :
    freq === "WEEKLY"   ? `Every ${DAYNAME[day]}` :
    freq === "BIWEEKLY" ? `Every 2 weeks on ${DAYNAME[day]}` :
    freq === "MONTHLY"  ? `Monthly on the ${ORDINAL[Math.min(nth, 5)]} ${DAYNAME[day]}` :
    "Every day";
  const n = Number(times);
  return n > 0 ? `${base}, ${n} times` : `${base}, with no end date`;
}

function mmss(s: number | null) {
  if (s === null || s === undefined) return "";
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

type Step = { key: string; label: string; ok: boolean; detail: string };

// A meeting people can put in their calendar. Written here rather than fetched
// from a route: an .ics is 12 lines of text, and a calendar invite that depends
// on a server being up is a calendar invite that eventually isn't there.
function icsFor(title: string, startISO: string, link: string, minutes = 60) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(startISO);
  const end = new Date(start.getTime() + minutes * 60000);
  const esc = (t: string) => t.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Quantlys Meeting//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${link}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc("Join: " + link + "\nNo account needed — one click.")}`,
    `URL:${link}`,
    `LOCATION:${esc(link)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIcs(title: string, startISO: string, link: string) {
  const blob = new Blob([icsFor(title, startISO, link)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w -]/g, "").trim() || "meeting"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// "In 3 days", "in 20 minutes", "started 5 minutes ago" — a time a person can
// act on without doing arithmetic.
function when(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 60 ? `${mins} minute${mins === 1 ? "" : "s"}` :
    mins < 60 * 36 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"}` :
    `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;
  return ms >= 0 ? `starts in ${unit}` : `started ${unit} ago`;
}

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
  const [mineTotal, setMineTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");
  const [startAt, setStartAt] = useState("");
  const [health, setHealth] = useState<{ headline: string; steps: Step[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [project, setProject] = useState("");
  const [items, setItems] = useState<ActionItem[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [digestNote, setDigestNote] = useState("");
  const [sending, setSending] = useState(false);
  // Who's coming. One free-text box on purpose: people paste addresses out of
  // a calendar, a spreadsheet or an Outlook To: line, and every one of those
  // uses a different separator. The parser takes them all.
  const [guests, setGuests] = useState("");
  const [inviteFor, setInviteFor] = useState("");   // room being invited to, from the list
  const [laterGuests, setLaterGuests] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteNote, setInviteNote] = useState("");
  // How often. One event with an RRULE, not fifty rows — the guest's own
  // calendar expands the series and keeps it after one Yes.
  const [repeat, setRepeat] = useState("");
  const [ends, setEnds] = useState("");   // "" = never, else a count
  // Deleting asks once, in place. A browser confirm() is a modal the page
  // can't style, can't explain and can't say what will actually be removed —
  // and it trains people to click through warnings.
  const [confirmDel, setConfirmDel] = useState("");
  const [deleting, setDeleting] = useState("");

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

  // Paste-order insurance. `scheduled_at` and `project` arrive with a SQL
  // step, and if the page were pasted first this select would error and the
  // meetings list would go silently empty — the exact class of failure this
  // app keeps getting caught by. Ask for everything, and if the database
  // hasn't caught up yet, ask for what has always been there and say so once.
  const BASE_COLS = "id, room_name, title, active, started_at";
  // Bounded on purpose — but a bound the person is told about. A list that
  // silently stops is the app saying "that's all of them" when it isn't.
  const MINE_LIMIT = 50;
  const ITEMS_LIMIT = 200;
  const loadMine = useCallback(async () => {
    if (!user) return;
    // FIELD 2026-08-18 (Conclave round 39): this asked for 20 and drew them
    // under the heading "Your Meetings" — so meeting 21 onwards just wasn't
    // there, with no error and nothing saying so. Ask for the true count as
    // well, and when the bound bites, say it on the screen.
    const full = await db()
      .from("meetings")
      .select(`${BASE_COLS}, scheduled_at, project`, { count: "exact" })
      .eq("created_by", user.id)
      .order("started_at", { ascending: false })
      .limit(MINE_LIMIT);
    if (!full.error) {
      setMine((full.data as Meeting[]) ?? []);
      setMineTotal(full.count ?? (full.data?.length ?? 0));
      return;
    }
    const basic = await db()
      .from("meetings")
      .select(BASE_COLS, { count: "exact" })
      .eq("created_by", user.id)
      .order("started_at", { ascending: false })
      .limit(MINE_LIMIT);
    setMine(((basic.data as any[]) ?? []).map((m) => ({ ...m, scheduled_at: null, project: null })));
    setMineTotal(basic.count ?? (basic.data?.length ?? 0));
    setNote(
      "Scheduling and projects need one SQL step that hasn't been run yet — everything " +
        "else works. Run the meet-digest SQL in Supabase and this message goes away."
    );
  }, [user]);

  const [itemsReady, setItemsReady] = useState(true);
  const loadItems = useCallback(async () => {
    if (!user) return;
    const { data, error, count } = await db()
      .from("action_items")
      .select("id, project, room_name, meeting_title, text, owner, ts_seconds, met_at",
              { count: "exact" })
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("met_at", { ascending: false })
      .limit(ITEMS_LIMIT);
    setItemsTotal(count ?? (data?.length ?? 0));
    // No table yet is a SETUP state, not an empty list. "Nothing open" when the
    // truth is "nowhere to put it" is the lie this whole app keeps fixing.
    setItemsReady(!error);
    setItems((data as ActionItem[]) ?? []);
  }, [user]);

  useEffect(() => {
    loadMine();
    loadItems();
  }, [loadMine, loadItems]);

  // Ticking something off is the whole contract: anything you don't tick comes
  // back next Monday. Done is written here and nowhere else, so the list, the
  // count and the email can never disagree.
  async function tick(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));   // instant, then confirm
    const { error } = await db()
      .from("action_items")
      .update({ status: "done", done_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setDigestNote(`Couldn't tick that off: ${error.message}`);
      loadItems();
    }
  }

  async function sendDigest() {
    setSending(true);
    setDigestNote("");
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/digest/weekly", {
        method: "POST",
        headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      });
      const j = await r.json();
      setDigestNote(
        j?.sent
          ? `Sent to ${j.to} — ${j.open} open item${j.open === 1 ? "" : "s"}.`
          : j?.reason === "nothing open"
          ? "Nothing is open, so there is nothing to send."
          : j?.error || "It didn't send. Check “Check my setup” above — the email step is the usual reason."
      );
    } catch {
      setDigestNote("Couldn't reach the digest just now.");
    }
    setSending(false);
  }

  function inviteLink(room: string) {
    return `${window.location.origin}/room/${room}`;
  }

  // Sending the invitation — the half that was missing. Returns a sentence
  // fit to show a person, never a silent boolean: if mail could not go out,
  // the host has to learn it here, while the link is still on the clipboard
  // and they can send it by hand, not tomorrow when nobody turns up.
  async function sendInvites(
    room: string,
    addresses: string,
    startISO?: string,
    rule?: { freq: string; interval?: number; count?: number }
  ): Promise<string> {
    if (!addresses.trim()) return "";
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/meetings/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          room, emails: addresses, startISO, repeat: rule,
          // The clock the host is actually looking at. Without it the
          // invitation prints UTC and every guest does subtraction.
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const j = await r.json();
      if (!r.ok || j?.error) return j?.error || "The invitations didn't send.";
      const n = Number(j.sent || 0);
      const missed = (j.bad || []).length
        ? ` ${(j.bad || []).length} address${(j.bad || []).length === 1 ? "" : "es"} couldn't be read and got nothing: ${(j.bad || []).join(", ")}.`
        : "";
      return `Invitation sent to ${n} ${n === 1 ? "person" : "people"} with the calendar file attached.${missed}`;
    } catch {
      return "Couldn't reach the invite service — the meeting exists and its link works, so send it by hand for now.";
    }
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
      project: project.trim() || null,
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
    // Starting now and inviting people are the same act. Send first, THEN walk
    // into the room — pushing the route first unmounts this page mid-request
    // and the invitations quietly never leave.
    if (guests.trim()) {
      const said = await sendInvites(room, guests, new Date().toISOString());
      if (said && !said.startsWith("Invitation sent")) {
        setNote(`${said} The meeting is open at ${inviteLink(room)} — open it when you're ready.`);
        return;
      }
      setGuests("");
    }
    setTitle("");
    router.push(`/room/${room}`);
  }

  // Scheduling, the small honest version: the link exists NOW and works
  // forever. Nobody has to be let in at the right moment, no invitation can
  // expire, and a guest who clicks early is told when to come back instead of
  // meeting an error. The calendar file is what carries the time to everyone
  // else, because that is where people actually keep their day.
  async function scheduleMeeting() {
    if (!user || busy) return;
    if (!startAt) {
      setNote("Pick a date and time first.");
      return;
    }
    const iso = new Date(startAt).toISOString();
    setBusy(true);
    setNote("");
    const room = "qm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const name = title.trim() || "Quantlys Meeting";
    const { error } = await db().from("meetings").insert({
      room_name: room,
      title: name,
      created_by: user.id,
      project: project.trim() || null,
      scheduled_at: iso,
    });
    setBusy(false);
    if (error) {
      setNote(
        error.message.includes("scheduled_at")
          ? "Scheduling needs one more line of SQL — run the meet-sched-0-sql step, then try again."
          : `Could not schedule: ${error.message}`
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink(room));
    } catch {
      /* not a blocker */
    }
    const rule = repeat
      ? {
          freq: repeat === "BIWEEKLY" ? "WEEKLY" : repeat,
          interval: repeat === "BIWEEKLY" ? 2 : 1,
          count: Number(ends) > 0 ? Number(ends) : undefined,
        }
      : undefined;
    const said = guests.trim() ? await sendInvites(room, guests, iso, rule) : "";
    if (!said) downloadIcs(name, iso, inviteLink(room));   // no guests → you're sending it yourself
    setTitle("");
    setStartAt("");
    if (said.startsWith("Invitation sent")) setGuests("");
    setNote(
      said
        ? `Scheduled. ${said} The link works from now until you end the meeting, so nobody can arrive to a locked door.`
        : "Scheduled. The invite link is on your clipboard and the calendar file is in your " +
          "Downloads — send both. The link works from now until you end the meeting, so " +
          "nobody can arrive to a locked door."
    );
    loadMine();
  }

  // "Will my next meeting actually produce notes in my inbox?" — asked before
  // the meeting, in two seconds, instead of discovered afterwards by an email
  // that never arrived.
  async function checkSetup() {
    setChecking(true);
    setHealth(null);
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/recording/selftest", {
        method: "POST",
        headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      });
      const j = await r.json();
      if (j?.steps) setHealth({ headline: j.headline, steps: j.steps });
      else setNote(j?.error || "Couldn't check the setup just now.");
    } catch {
      setNote("Couldn't reach the setup check.");
    }
    setChecking(false);
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

  // Deleting the whole thing — the row, its recordings, the files behind
  // them and the action items that came out of it. Everything the server
  // removes is named in the answer, because "deleted" with no detail is how
  // people find out later that the video was still there.
  async function deleteMeeting(room: string) {
    setDeleting(room);
    setInviteNote("");
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/meetings/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ room }),
      });
      const j = await r.json();
      if (!r.ok || j?.error) {
        setInviteNote(j?.error || "Couldn't delete that meeting.");
      } else {
        const bits = [
          j.files_removed ? `${j.files_removed} recording file${j.files_removed === 1 ? "" : "s"}` : "",
          j.action_items ? `${j.action_items} action item${j.action_items === 1 ? "" : "s"}` : "",
        ].filter(Boolean);
        setInviteNote(
          `Deleted “${j.title || "that meeting"}”${bits.length ? ` — and ${bits.join(" and ")} with it.` : "."}`
        );
        setMine((xs) => xs.filter((m) => m.room_name !== room));
        loadItems();
      }
    } catch {
      setInviteNote("Couldn't reach the server to delete that.");
    }
    setDeleting("");
    setConfirmDel("");
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
              <input
                className="qm-input qm-narrow"
                placeholder="Project (optional)"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                title="Meetings in the same project are rolled up together in your weekly digest"
              />
              <button className="qm-primary" onClick={startMeeting} disabled={busy}>
                {busy ? "Starting…" : "Start a meeting"}
              </button>
            </div>

            <div className="qm-guests">
              <label className="qm-label" htmlFor="qm-guests">
                Who's coming? <em>(optional)</em>
              </label>
              <textarea
                id="qm-guests"
                className="qm-area"
                rows={2}
                placeholder="maya@company.com, sam@partner.co — or paste a whole column"
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
              <p className="qm-hint">
                They get a proper calendar invitation with the join link — Yes / No / Maybe,
                straight into their calendar. Commas, semicolons, new lines or “Name
                &lt;address&gt;” all work. Leave it empty and you'll get the link to send yourself.
              </p>
            </div>

            <div className="qm-sched">
              <p className="qm-muted qm-tight">Or set it for later.</p>
              <div className="qm-row">
                <input
                  className="qm-input"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  aria-label="Start date and time"
                />
                <select
                  className="qm-input qm-narrow"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  aria-label="How often it repeats"
                >
                  <option value="">Doesn&apos;t repeat</option>
                  <option value="DAILY">Every day</option>
                  <option value="WEEKDAYS">Every weekday</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Every 2 weeks</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                {repeat ? (
                  <input
                    className="qm-input qm-tiny"
                    type="number"
                    min={2}
                    max={200}
                    placeholder="times"
                    value={ends}
                    onChange={(e) => setEnds(e.target.value)}
                    aria-label="Number of occurrences — leave empty for no end"
                    title="How many times. Leave it empty and it repeats indefinitely."
                  />
                ) : null}
                <button className="qm-ghost" onClick={scheduleMeeting} disabled={busy || !startAt}>
                  {busy ? "Working…" : guests.trim() ? "Schedule and invite" : "Schedule it"}
                </button>
              </div>
              {repeat ? (
                <p className="qm-hint">
                  {saysRepeat(repeat, startAt, ends)} — everyone gets one invitation
                  and their calendar fills in the rest. The join link is the same
                  every time.
                </p>
              ) : null}
            </div>
            {note ? <p className="qm-note">{note}</p> : null}
          </section>

          <section className="qm-card">
            <h2>Will recordings turn into notes?</h2>
            <p className="qm-muted qm-tight">
              Transcripts and the email need keys set in Vercel. This asks each service
              directly, so you find out now rather than after a meeting.
            </p>
            <div className="qm-row">
              <button className="qm-ghost" onClick={checkSetup} disabled={checking}>
                {checking ? "Checking…" : "Check my setup"}
              </button>
            </div>
            {health ? (
              <>
                <p className={`qm-head ${health.steps.every((x) => x.ok) ? "qm-good" : "qm-bad"}`}>
                  {health.headline}
                </p>
                <ul className="qm-steps">
                  {health.steps.map((st) => (
                    <li key={st.key} className={st.ok ? "is-ok" : "is-bad"}>
                      <span className="qm-mark">{st.ok ? "✓" : "✗"}</span>
                      <span>
                        <b>{st.label}</b>
                        <em>{st.detail}</em>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="qm-card">
            <h2>Your meetings</h2>
            {mineTotal > mine.length ? (
              <p className="qm-muted qm-tight">
                Showing your {mine.length} most recent of {mineTotal}. Everything
                older is still recorded and still searchable above.
              </p>
            ) : null}
            {mine.length === 0 ? (
              <p className="qm-muted">Nothing yet — start one above and share the link.</p>
            ) : (
              mine.map((m) => (
                <div className="qm-itemwrap" key={m.id}>
                <div className="qm-item">
                  <span className="qm-name">
                    {m.title || "Quantlys Meeting"}
                    {m.scheduled_at ? (
                      <em className="qm-when">
                        {" · "}
                        {new Date(m.scheduled_at).toLocaleString([], {
                          weekday: "short", day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                        {" · "}
                        {when(m.scheduled_at)}
                      </em>
                    ) : null}
                    {m.active === false ? <em className="qm-ended"> · ended</em> : null}
                  </span>
                  <span className="qm-row">
                    <button className="qm-ghost" onClick={() => copyInvite(m.room_name)}>
                      {copied === m.room_name ? "Copied" : "Copy invite link"}
                    </button>
                    {m.scheduled_at ? (
                      <button
                        className="qm-ghost"
                        onClick={() =>
                          downloadIcs(m.title || "Quantlys Meeting", m.scheduled_at!, inviteLink(m.room_name))
                        }
                      >
                        Add to calendar
                      </button>
                    ) : null}
                    <button
                      className="qm-ghost"
                      onClick={() => {
                        setInviteFor(inviteFor === m.room_name ? "" : m.room_name);
                        setLaterGuests("");
                        setInviteNote("");
                      }}
                    >
                      {inviteFor === m.room_name ? "Cancel" : "Invite people"}
                    </button>
                    <button className="qm-ghost" onClick={() => router.push(`/room/${m.room_name}`)}>
                      Open
                    </button>
                    {m.active === false ? null : (
                      <button className="qm-ghost" onClick={() => endMeeting(m.id)}>
                        End
                      </button>
                    )}
                    {confirmDel === m.room_name ? (
                      <>
                        <button
                          className="qm-danger"
                          disabled={deleting === m.room_name}
                          onClick={() => deleteMeeting(m.room_name)}
                        >
                          {deleting === m.room_name ? "Deleting…" : "Yes, delete it"}
                        </button>
                        <button className="qm-ghost" onClick={() => setConfirmDel("")}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        className="qm-ghost qm-dellink"
                        onClick={() => { setConfirmDel(m.room_name); setInviteNote(""); }}
                        title="Delete this meeting, its recordings and its notes"
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>

                {confirmDel === m.room_name ? (
                  <p className="qm-warn">
                    This removes the meeting, its recording files and any action
                    items that came out of it. There is no undo.
                  </p>
                ) : null}

                {/* Inviting someone to a meeting that already exists — the case
                    that comes up most: one more person, the morning of. */}
                {inviteFor === m.room_name ? (
                  <div className="qm-invite">
                    <textarea
                      className="qm-area"
                      rows={2}
                      autoFocus
                      placeholder="maya@company.com, sam@partner.co"
                      value={laterGuests}
                      onChange={(e) => setLaterGuests(e.target.value)}
                    />
                    <div className="qm-row">
                      <button
                        className="qm-primary"
                        disabled={inviting || !laterGuests.trim()}
                        onClick={async () => {
                          setInviting(true);
                          const said = await sendInvites(
                            m.room_name,
                            laterGuests,
                            m.scheduled_at || m.started_at || new Date().toISOString()
                          );
                          setInviting(false);
                          setInviteNote(said);
                          if (said.startsWith("Invitation sent")) {
                            setLaterGuests("");
                            setInviteFor("");
                          }
                        }}
                      >
                        {inviting ? "Sending…" : "Send invitation"}
                      </button>
                      <span className="qm-hint">
                        Same meeting, same link — an invitation already accepted is
                        updated, not duplicated.
                      </span>
                    </div>
                  </div>
                ) : null}
                </div>
              ))
            )}
            {inviteNote ? <p className="qm-note">{inviteNote}</p> : null}
          </section>

          <section className="qm-card">
            <div className="qm-head-row">
              <h2>Still open</h2>
              <button className="qm-ghost" onClick={sendDigest} disabled={sending}>
                {sending ? "Sending…" : "Email me this week's digest"}
              </button>
            </div>
            <p className="qm-muted qm-tight">
              Everything anyone committed to, across every meeting. Tick it off and it
              goes. Anything you don't tick comes back next Monday — that's the point.
            </p>
            {digestNote ? <p className="qm-note">{digestNote}</p> : null}
            {itemsTotal > items.length ? (
              <p className="qm-muted qm-tight">
                Showing {items.length} of {itemsTotal} open items — the newest first.
              </p>
            ) : null}
            {!itemsReady ? (
              <p className="qm-muted">
                The action-items table hasn't been created yet — run the meet-digest SQL
                step in Supabase and this list starts filling itself after each recording.
              </p>
            ) : items.length === 0 ? (
              <p className="qm-muted">
                Nothing open. Action items appear here after a meeting is recorded and
                transcribed.
              </p>
            ) : (
              Object.entries(
                items.reduce<Record<string, ActionItem[]>>((acc, i) => {
                  const k = (i.project || "").trim() || "General";
                  (acc[k] = acc[k] || []).push(i);
                  return acc;
                }, {})
              ).map(([proj, list]) => (
                <div key={proj} className="qm-proj">
                  <div className="qm-projname">
                    {proj}
                    <em> · {list.length} open</em>
                  </div>
                  {list.map((i) => (
                    <div className="qm-todo" key={i.id}>
                      <button
                        className="qm-tick"
                        onClick={() => tick(i.id)}
                        title="Mark it done — it won't come back"
                        aria-label={`Mark done: ${i.text}`}
                      >
                        ○
                      </button>
                      <span className="qm-todotext">
                        {i.text}
                        <em>
                          {i.meeting_title || i.room_name}
                          {" · "}
                          {new Date(i.met_at).toLocaleDateString([], {
                            weekday: "short", month: "short", day: "numeric",
                          })}
                          {i.ts_seconds !== null ? ` · ${mmss(i.ts_seconds)}` : ""}
                          {i.owner ? ` · ${i.owner}` : ""}
                        </em>
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>

          <Search />

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
.qm-tight { margin-bottom: 10px; }
.qm-sched { margin-top: 16px; padding-top: 16px; border-top: 1px solid #262b36; }
.qm-when { color: #8fd8cf; font-style: normal; font-size: 13px; }
.qm-head { font-size: 14px; margin: 16px 0 10px; font-weight: 600; }
.qm-good { color: #8fd8cf; }
.qm-bad { color: #ffc9a0; }
.qm-steps { list-style: none; margin: 0; padding: 0; display: flex;
  flex-direction: column; gap: 10px; }
.qm-steps li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.qm-steps li.is-ok .qm-mark { color: #4ac9b5; }
.qm-steps li.is-bad .qm-mark { color: #ff9d9d; }
.qm-mark { flex: 0 0 auto; width: 14px; font-weight: 700; }
.qm-narrow { flex: 0 1 170px; }
.qm-tiny { flex: 0 0 90px; }
select.qm-input { cursor: pointer; }
.qm-guests { margin-top: 16px; }
.qm-label { display: block; font-size: 13px; color: #cfd6e4; margin: 0 0 6px; font-weight: 600; }
.qm-label em { color: #6f7789; font-style: normal; font-weight: 400; }
.qm-area { width: 100%; box-sizing: border-box; background: #0f1218; color: #e9edf5;
  border: 1px solid #2c3342; border-radius: 10px; padding: 10px 12px; font: inherit;
  resize: vertical; min-height: 44px; }
.qm-area:focus { outline: 0; border-color: #00a99d; }
.qm-area::placeholder { color: #5a6272; }
.qm-hint { color: #6f7789; font-size: 12.5px; line-height: 1.5; margin: 6px 0 0; }
.qm-itemwrap { border-bottom: 1px solid #21252f; }
.qm-itemwrap:last-child { border-bottom: 0; }
.qm-itemwrap .qm-item { border-bottom: 0; }
.qm-invite { padding: 0 0 16px; display: grid; gap: 10px; }
.qm-danger { background: #4a1f24; color: #ffd7d7; border: 1px solid #7a2f38; }
.qm-danger:hover { border-color: #a03c48; }
.qm-dellink { color: #b9808a; border-color: #3a2a2e; }
.qm-dellink:hover { color: #ffc9c9; border-color: #7a2f38; }
.qm-warn { margin: 0 0 14px; font-size: 13px; color: #ffb4b4; line-height: 1.5;
  background: #1d1216; border: 1px solid #4a2129; border-radius: 10px;
  padding: 10px 12px; }
.qm-head-row { display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.qm-head-row h2 { margin: 0; }
.qm-proj { margin-top: 18px; }
.qm-projname { font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase;
  color: #00a99d; font-weight: 700; margin-bottom: 8px; }
.qm-projname em { font-style: normal; color: #8b93a5; letter-spacing: 0;
  text-transform: none; font-weight: 400; }
.qm-todo { display: flex; gap: 11px; align-items: flex-start; padding: 8px 0;
  border-bottom: 1px solid #1c202a; }
.qm-todo:last-child { border-bottom: 0; }
.qm-tick { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; line-height: 1;
  border: 1px solid #2b3240; background: transparent; color: #6f7789;
  border-radius: 50%; font-size: 13px; }
.qm-tick:hover { border-color: #00a99d; color: #00a99d; }
.qm-todotext { flex: 1 1 auto; font-size: 14px; line-height: 1.5; }
.qm-todotext em { display: block; font-style: normal; color: #8b93a5;
  font-size: 12px; margin-top: 2px; }
.qm-steps em { display: block; font-style: normal; color: #8b93a5; font-size: 13px;
  margin-top: 2px; line-height: 1.5; }
`;
