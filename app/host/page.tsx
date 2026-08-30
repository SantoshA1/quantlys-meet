"use client";

// The host console. Deliberately self-contained: it makes its own Supabase
// client from the public env vars and carries its own styles, so it cannot
// be broken by, and cannot break, anything else in the app.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Recordings from "./Recordings";
import Search from "./Search";
import Intelligence from "./Intelligence";
import Prd, { PRD_CSS } from "./Prd";
import { nextUp, inWords, stillOpen } from "@/lib/intelligence";

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
  // Short names for the status strip. "Turn speech into text" is the right
  // label in a checklist and the wrong one in a chip.
  const CHIP: Record<string, string> = {
    storage: "STORAGE", transcribe: "TRANSCRIBE", notes: "INTELLIGENCE", email: "MAIL", items: "ACTIONS",
  };
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
          : j?.message || j?.reason === "nothing open"
          // The route now says WHICH of three situations this is — all done,
          // nothing ever captured, or open-but-not-this-week — because they
          // have three different answers and only one is a problem.
          ? (j.message || "Nothing is open, so there is nothing to send.")
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

  async function startSpecSession() {
    if (!user || busy) return;
    setBusy(true);
    setNote("");
    const room = "qm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const { error } = await db().from("meetings").insert({
      room_name: room,
      title: title.trim() || "Spec session",
      created_by: user.id,
      project: project.trim() || title.trim() || "spec",
    });
    setBusy(false);
    if (error) {
      setNote(`Could not start the spec session: ${error.message}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink(room));
    } catch {
      /* clipboard is a nicety, never a blocker */
    }
    if (guests.trim()) {
      const said = await sendInvites(room, guests, new Date().toISOString());
      if (said && !said.startsWith("Invitation sent")) {
        setNote(`${said} The spec session is open at ${inviteLink(room)} — open it when you're ready.`);
        return;
      }
      setGuests("");
    }
    setTitle("");
    router.push(`/room/${room}?spec=1`);
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

  // The setup check was behind a button. A key that is missing is missing
  // whether or not anybody thought to look, and the cost lands hours later on
  // the one person who cannot debug it — so ask on arrival, quietly.
  useEffect(() => {
    if (!user || health) return;
    let alive = true;
    (async () => {
      try {
        const { data: sess } = await db().auth.getSession();
        const r = await fetch("/api/recording/selftest", {
          method: "POST",
          headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
        });
        const j = await r.json();
        if (alive && j?.steps) setHealth({ headline: j.headline, steps: j.steps });
      } catch { /* the strip simply stays on CHECKING… */ }
    })();
    return () => { alive = false; };
  }, [user, health]);

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

  async function endMeeting(room: string) {
    try {
      const { data: sess } = await db().auth.getSession();
      const r = await fetch("/api/host/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ room, action: "end" }),
      });
      const j = await r.json();
      if (!r.ok || j?.error) {
        setInviteNote(j?.error || "Couldn't end that session.");
      }
    } catch {
      setInviteNote("Couldn't reach the server to end that session.");
    }
    loadMine();
  }

  async function signOut() {
    await db().auth.signOut();
    setMine([]);
    setStage("email");
    setNote("");
  }

  const allGood = Boolean(health && health.steps.every((x) => x.ok));
  const brokenCount = (health?.steps || []).filter((x) => !x.ok).length;

  const up = nextUp(mine);
  // The projects this person actually has meetings on. Sorted, de-duplicated,
  // and derived rather than stored — a project is a tag on a meeting, not a
  // record somewhere that could disagree with the meetings.
  const projectNames = Array.from(
    new Set(mine.map((m) => String((m as any).project || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const groups = stillOpen(items.map((i) => ({ ...i, project: i.project })));

  return (
    <main className="qh-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <style dangerouslySetInnerHTML={{ __html: QH }} />

      <header className="qh-top">
        <span className="qh-logo">
          <span className="qh-cube" aria-hidden>◇</span>
          HOST<em> CONSOLE</em>
        </span>
        {user ? (
          <>
            <span className="qh-chips">
              <span className={`q-chip${allGood ? " q-live" : ""}`} title={health?.headline || "Checking your setup…"}>
                <span className={`q-dot${allGood ? " q-beat" : ""}`}
                      style={{ background: health ? (allGood ? "var(--accent2)" : "var(--danger)") : "var(--dim)" }} />
                {health ? (allGood ? "ALL SYSTEMS NOMINAL" : `${brokenCount} NEED ATTENTION`) : "CHECKING…"}
              </span>
              {(health?.steps || []).filter((st) => CHIP[st.key]).map((st) => (
                <span key={st.key} className="q-chip" title={st.detail}
                      style={{ color: st.ok ? "var(--muted)" : "var(--danger)",
                               borderColor: st.ok ? "var(--fieldline)" : "var(--dangerLine)" }}>
                  {CHIP[st.key]} {st.ok ? "READY" : "OFF"}
                </span>
              ))}
            </span>
            <span className="qh-user" title={user.email || ""}>{user.email}</span>
            <button className="qh-ghost" onClick={signOut}>SIGN OUT</button>
          </>
        ) : null}
      </header>

      {!ready ? (
        <p className="qh-dim">Loading…</p>
      ) : !user ? (
        <section className="qh-panel qh-signin">
          <p className="qh-eyebrow">HOST SIGN-IN</p>
          <h1 className="qh-h1">Sign in to host</h1>
          <p className="qh-dim">
            Only the host needs an account. Everyone you invite joins with one click, no sign-up.
          </p>
          {stage === "email" ? (
            <div className="qh-row">
              <input className="qh-input" type="email" inputMode="email" autoComplete="email"
                placeholder="you@company.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()} />
              <button className="qh-primary" onClick={sendCode} disabled={busy}>
                {busy ? "SENDING…" : "EMAIL ME A CODE"}
              </button>
            </div>
          ) : (
            <div className="qh-row">
              <input className="qh-input" inputMode="numeric" autoComplete="one-time-code"
                placeholder="6-digit code" value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verify()} />
              <button className="qh-primary" onClick={verify} disabled={busy}>
                {busy ? "CHECKING…" : "SIGN IN"}
              </button>
              <button className="qh-ghost" onClick={sendCode} disabled={busy}>SEND A NEW CODE</button>
            </div>
          )}
          {note ? <p className="qh-note">{note}</p> : null}
        </section>
      ) : (
        <div className="qh-grid">
          <div className="qh-main">

            {/* ── LAUNCH ─────────────────────────────────────────────── */}
            <section className="qh-panel qh-launch">
              <p className="qh-eyebrow">LAUNCH</p>
              <h1 className="qh-h1">Start a spec session</h1>
              <p className="qh-dim">
                Talk the spec out — no one else has to join. The agent and recording turn on.
              </p>
              <div className="qh-row">
                <input className="qh-input qh-grow" placeholder="Meeting name" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && startSpecSession()} />
                <input className="qh-input qh-mid" placeholder="Project" value={project}
                  onChange={(e) => setProject(e.target.value)}
                  title="Meetings in the same project are rolled up together in your weekly digest" />
                <button className="qh-primary" onClick={startSpecSession} disabled={busy}>
                  {busy ? "STARTING…" : "START SPEC SESSION"}
                </button>
                <button className="qh-ghost qh-btn" onClick={startMeeting} disabled={busy}
                  title="Start a normal team meeting — agent and recording stay off until you turn them on">
                  {busy ? "STARTING…" : "START NOW"}
                </button>
              </div>
              <div className="qh-row">
                <textarea className="qh-input qh-grow qh-area" rows={1}
                  placeholder="Who's coming?  maya@company.com, sam@partner.co — or paste a whole column"
                  value={guests} onChange={(e) => setGuests(e.target.value)} />
                <input className="qh-input qh-mid" type="datetime-local" value={startAt}
                  onChange={(e) => setStartAt(e.target.value)} aria-label="Start date and time" />
                <button className="qh-ghost qh-btn" onClick={scheduleMeeting} disabled={busy || !startAt}>
                  {busy ? "WORKING…" : "SCHEDULE"}
                </button>
              </div>
              <div className="qh-row qh-fineline">
                <span className="qh-fine">
                  Commas, semicolons, new lines or “Name &lt;address&gt;” all work · leave it
                  empty and you&apos;ll get the link to send yourself.
                </span>
                <span className="qh-spacer" />
                <select className="qh-input qh-tiny" value={repeat}
                  onChange={(e) => setRepeat(e.target.value)} aria-label="How often it repeats">
                  <option value="">Doesn&apos;t repeat</option>
                  <option value="DAILY">Every day</option>
                  <option value="WEEKDAYS">Every weekday</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Every 2 weeks</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                {repeat ? (
                  <input className="qh-input qh-tiny" type="number" min={2} max={200} placeholder="times"
                    value={ends} onChange={(e) => setEnds(e.target.value)}
                    aria-label="Number of occurrences — leave empty for no end" />
                ) : null}
              </div>
              {repeat ? <p className="qh-fine">{saysRepeat(repeat, startAt, ends)} — everyone gets one
                invitation and their calendar fills in the rest.</p> : null}
              {note ? <p className="qh-note">{note}</p> : null}
            </section>

            {/* ── MEETING INTELLIGENCE ───────────────────────────────── */}
            <Intelligence userId={user.id} openItems={items} onTick={tick} />
            {/* Every recorded meeting on a project, read together, scored on
                the same rubric Quantlys Conclave scores a PRD on. See Prd.tsx
                for why there is no one-click "send to Conclave" button. */}
            <Prd projects={projectNames} />

            {/* ── YOUR MEETINGS ──────────────────────────────────────── */}
            <section className="qh-panel">
              <div className="qh-panelhead">
                <span className="qh-eyebrow">YOUR MEETINGS</span>
                {mineTotal > mine.length ? (
                  <span className="qh-fine">SHOWING {mine.length} OF {mineTotal} — OLDER ONES STAY SEARCHABLE</span>
                ) : null}
              </div>
              {mine.length === 0 ? (
                <p className="qh-dim">Nothing yet — start one above and share the link.</p>
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
                      {m.active === false ? <em className="qm-ended"> · last session ended</em> : null}
                    </span>
                    <span className="qm-row">
                      <button className="qh-ghost" onClick={() => copyInvite(m.room_name)}>
                        {copied === m.room_name ? "COPIED" : "COPY LINK"}
                      </button>
                      {m.scheduled_at ? (
                        <button className="qh-ghost"
                          onClick={() => downloadIcs(m.title || "Quantlys Meeting", m.scheduled_at!, inviteLink(m.room_name))}>
                          CALENDAR
                        </button>
                      ) : null}
                      <button className="qh-ghost"
                        onClick={() => { setInviteFor(inviteFor === m.room_name ? "" : m.room_name); setLaterGuests(""); setInviteNote(""); }}>
                        {inviteFor === m.room_name ? "CANCEL" : "INVITE"}
                      </button>
                      <button className="qh-primary qh-small" onClick={() => router.push(`/room/${m.room_name}`)}>
                        OPEN
                      </button>
                      <button className="qh-ghost" onClick={() => endMeeting(m.room_name)}>END SESSION</button>
                      {confirmDel === m.room_name ? (
                        <>
                          <button className="qm-danger" disabled={deleting === m.room_name}
                            onClick={() => deleteMeeting(m.room_name)}>
                            {deleting === m.room_name ? "Deleting…" : "Yes, delete it"}
                          </button>
                          <button className="qh-ghost" onClick={() => setConfirmDel("")}>KEEP IT</button>
                        </>
                      ) : (
                        <button className="qh-ghost qh-del"
                          onClick={() => { setConfirmDel(m.room_name); setInviteNote(""); }}
                          title="Delete this meeting, its recordings and its notes">
                          DELETE
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
                  {inviteFor === m.room_name ? (
                    <div className="qm-invite">
                      <textarea className="qh-input qh-area" rows={2} autoFocus
                        placeholder="maya@company.com, sam@partner.co"
                        value={laterGuests} onChange={(e) => setLaterGuests(e.target.value)} />
                      <div className="qh-row">
                        <button className="qh-primary qh-small" disabled={inviting || !laterGuests.trim()}
                          onClick={async () => {
                            setInviting(true);
                            const said = await sendInvites(
                              m.room_name, laterGuests,
                              m.scheduled_at || m.started_at || new Date().toISOString()
                            );
                            setInviting(false);
                            setInviteNote(said);
                            if (said.startsWith("Invitation sent")) { setLaterGuests(""); setInviteFor(""); }
                          }}>
                          {inviting ? "SENDING…" : "SEND INVITATION"}
                        </button>
                        <span className="qh-fine">
                          Same meeting, same link — an invitation already accepted is updated, not duplicated.
                        </span>
                      </div>
                    </div>
                  ) : null}
                  </div>
                ))
              )}
              {inviteNote ? <p className="qh-note">{inviteNote}</p> : null}
            </section>

            <Search />
            <Recordings userId={user.id} />
          </div>

          {/* ── THE RAIL ───────────────────────────────────────────── */}
          <aside className="qh-rail">
            <p className="qh-railhead">NEXT UP</p>
            {up && up.scheduled_at ? (
              <div className="qh-next">
                <p className="qh-nextwhen"><span className="q-dot q-beat" /> {inWords(up.scheduled_at).toUpperCase()}</p>
                <p className="qh-nexttitle">{up.title || "Quantlys Meeting"}</p>
                <p className="qh-fine">
                  {new Date(up.scheduled_at).toLocaleString([], {
                    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  }).toUpperCase()}
                </p>
                <div className="qh-row">
                  <button className="qh-primary qh-small" onClick={() => router.push(`/room/${up.room_name}`)}>JOIN</button>
                  <button className="qh-ghost" onClick={() => copyInvite(up.room_name)}>
                    {copied === up.room_name ? "COPIED" : "COPY LINK"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="qh-dim qh-railnote">Nothing scheduled. Set a time in the launch card and it appears here.</p>
            )}

            <p className="qh-railhead">STILL OPEN {itemsReady && items.length ? <em className="qh-count">{itemsTotal}</em> : null}</p>
            {!itemsReady ? (
              <p className="qh-dim qh-railnote">
                The action-items table hasn&apos;t been created yet — run the meet-digest SQL step
                in Supabase and this list starts filling itself after each recording.
              </p>
            ) : items.length === 0 ? (
              <p className="qh-dim qh-railnote">Nothing open. Commitments land here after a recorded meeting.</p>
            ) : (
              <>
                {groups.map((g) => (
                  <div key={g.project} className="qh-proj">
                    <p className="qh-projname">{g.project} <em>· {g.items.length} OPEN</em></p>
                    {g.items.slice(0, 6).map((i: any) => (
                      <label className="qh-open" key={i.id}>
                        <input type="checkbox" onChange={() => tick(i.id)} aria-label={`Mark done: ${i.text}`} />
                        <span>{i.text}</span>
                      </label>
                    ))}
                    {g.items.length > 6 ? <p className="qh-fine">+ {g.items.length - 6} more in the digest</p> : null}
                  </div>
                ))}
                {itemsTotal > items.length ? (
                  <p className="qh-fine">Showing {items.length} of {itemsTotal} — newest first.</p>
                ) : null}
                <p className="qh-fine">Anything you don&apos;t tick comes back next Monday. That&apos;s the point.</p>
              </>
            )}
            <button className="qh-wide" onClick={sendDigest} disabled={sending}>
              {sending ? "SENDING…" : "EMAIL ME THIS WEEK'S DIGEST"}
            </button>
            {digestNote ? <p className="qh-note">{digestNote}</p> : null}

            <p className="qh-railhead">PIPELINE</p>
            <div className="qh-pipe">
              {(health?.steps || []).map((st) => (
                <div key={st.key} className={`qh-pipestep ${st.ok ? "is-ok" : "is-bad"}`} title={st.detail}>
                  <span className="qh-pipemark">{st.ok ? "✓" : "✗"}</span>
                  <span className="qh-pipelabel">{st.label}</span>
                </div>
              ))}
              {!health ? <p className="qh-dim qh-railnote">Checking your setup…</p> : null}
            </div>
            <button className="qh-wide" onClick={checkSetup} disabled={checking}>
              {checking ? "CHECKING…" : "CHECK MY SETUP"}
            </button>
            {health && !allGood ? (
              <p className="qh-note qh-railnote">{health.headline}</p>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}

const CSS = PRD_CSS + `
.qm-wrap { max-width: 1180px; margin: 0 auto; padding: 26px 24px 80px;
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

// The console's own composition — built on the design tokens globals.css
// already ships. The qm-* styles above stay because the meetings list and
// Recordings/Search still wear them; these are the design's console shell.
const QH = `
.qh-wrap { max-width: 1520px; margin: 0 auto; padding: 0 24px 80px;
  font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
  color: var(--text, #e8eef5); }
.qh-top { position: sticky; top: 0; z-index: 30; display: flex; align-items: center;
  gap: 14px; flex-wrap: wrap; padding: 13px 4px; margin-bottom: 22px;
  background: color-mix(in srgb, var(--bg, #04060a) 86%, transparent);
  backdrop-filter: blur(10px); border-bottom: 1px solid var(--line2, #131c26); }
.qh-logo { display: flex; align-items: center; gap: 10px; font-weight: 600;
  font-size: 14px; letter-spacing: .09em; text-transform: uppercase; }
.qh-logo em { color: var(--accent2, #4DD7CF); font-style: normal; font-weight: 400; }
.qh-cube { color: var(--accent, #00A99D); filter: drop-shadow(0 0 8px var(--glow, rgba(0,169,157,.16))); }
.qh-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qh-user { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  color: var(--muted, #7b8aa0); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qh-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; align-items: start; }
@media (max-width: 1080px) { .qh-grid { grid-template-columns: 1fr; } }
.qh-main { min-width: 0; }

.qh-panel { position: relative; border: 1px solid var(--line, #16202c); background:
  radial-gradient(900px 420px at 80% -20%, var(--glow, rgba(0,169,157,.16)), transparent 62%),
  repeating-linear-gradient(0deg, var(--grid, rgba(255,255,255,.014)) 0 1px, transparent 1px 64px),
  repeating-linear-gradient(90deg, var(--grid, rgba(255,255,255,.014)) 0 1px, transparent 1px 64px),
  var(--panel, #070b10);
  padding: 22px 26px; margin-bottom: 20px; }
.qh-panel::before { content: ""; position: absolute; top: -1px; left: -1px; width: 14px; height: 14px;
  border-top: 2px solid var(--accent, #00A99D); border-left: 2px solid var(--accent, #00A99D); }
.qh-launch { padding: 26px 30px 24px; }
.qh-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .24em;
  color: var(--accent2, #4DD7CF); margin: 0 0 6px; }
.qh-h1 { font-size: 30px; font-weight: 600; margin: 2px 0 8px; letter-spacing: -0.01em; }
.qh-dim { color: var(--muted, #7b8aa0); font-size: 14px; line-height: 1.55; margin: 4px 0 14px; }
.qh-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0 0; }
.qh-fineline { align-items: baseline; }
.qh-spacer { flex: 1; }
.qh-grow { flex: 1 1 260px; }
.qh-mid { flex: 0 1 200px; }
.qh-tiny { flex: 0 0 auto; width: auto; }
.qh-input { background: var(--sunk, #070a0f); border: 1px solid var(--fieldline, #1e2937);
  color: var(--text, #e8eef5); padding: 12px 14px; font: inherit; font-size: 14px;
  border-radius: 0; min-width: 0; }
.qh-input:focus { outline: none; border-color: var(--accent, #00A99D);
  box-shadow: 0 0 0 1px var(--accent, #00A99D) inset; }
.qh-area { resize: vertical; line-height: 1.45; }
.qh-primary { background: var(--accent, #00A99D); color: var(--onAccent, #031310);
  border: 0; padding: 13px 22px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  letter-spacing: .14em; font-weight: 600; cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
.qh-primary:hover { background: var(--accent2, #4DD7CF); }
.qh-primary:disabled { opacity: .55; cursor: default; }
.qh-small { padding: 9px 16px; }
.qh-ghost, .qh-btn { background: transparent; border: 1px solid var(--fieldline, #1e2937);
  color: var(--text2, #c3cddb); padding: 9px 14px; font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; letter-spacing: .12em; cursor: pointer; }
.qh-ghost:hover { border-color: var(--accent, #00A99D); color: var(--accentBright, #7ff0e8); }
.qh-ghost:disabled { opacity: .5; cursor: default; }
.qh-btn { padding: 12px 18px; }
.qh-del:hover { border-color: var(--dangerLine, #7a2f38); color: var(--danger, #ff5964); }
.qh-wide { display: block; width: 100%; margin: 14px 0 4px; padding: 12px;
  background: transparent; border: 1px solid var(--fieldline, #1e2937);
  color: var(--text2, #c3cddb); font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  letter-spacing: .16em; cursor: pointer; }
.qh-wide:hover { border-color: var(--accent, #00A99D); color: var(--accentBright, #7ff0e8); }
.qh-fine { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--dim, #4a566b);
  letter-spacing: .04em; line-height: 1.6; }
.qh-note { margin-top: 12px; padding: 10px 14px; border: 1px solid var(--fieldline, #1e2937);
  background: var(--sunk, #070a0f); color: var(--text2, #c3cddb); font-size: 13.5px; line-height: 1.5; }
.qh-signin { max-width: 640px; margin: 60px auto; padding: 34px 38px; }

/* ── intelligence panel ── */
.qh-panelhead { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding-bottom: 12px; border-bottom: 1px solid var(--line2, #131c26); margin-bottom: 14px; }
.qh-ready { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .14em;
  color: var(--muted, #7b8aa0); display: flex; align-items: center; gap: 7px; }
.qh-introw { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.qh-mtitle { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
.qh-msub { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted, #7b8aa0);
  letter-spacing: .08em; margin: 0; }
.qh-sep { color: var(--faint, #3f4a5c); padding: 0 4px; }
.qh-stats { display: flex; gap: 26px; }
.qh-stat i { display: block; font-family: 'IBM Plex Mono', monospace; font-style: normal;
  font-size: 9.5px; letter-spacing: .18em; color: var(--dim, #4a566b); margin-bottom: 2px; }
.qh-stat b { font-size: 30px; font-weight: 600; color: var(--accent2, #4DD7CF);
  font-variant-numeric: tabular-nums; }
.qh-strip { margin: 18px 0 6px; border: 1px solid var(--line2, #131c26);
  background: var(--sunk, #070a0f); padding: 14px 16px 10px; }
.qh-bars { display: flex; align-items: flex-end; gap: 4px; height: 74px; }
.qh-bars span { flex: 1; min-width: 3px; background: linear-gradient(180deg,
  var(--accent2, #4DD7CF), var(--accent, #00A99D)); opacity: .85; }
.qh-stripmeta { display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
  margin-top: 9px; font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  color: var(--dim, #4a566b); letter-spacing: .08em; }
.qh-stripmeta > span:last-child { margin-left: auto; }
.qh-mark { color: var(--accent2, #4DD7CF); }
.qh-mark.is-act { color: var(--warn, #ffc98a); }
.qh-cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 26px; margin-top: 16px; }
@media (max-width: 860px) { .qh-cols { grid-template-columns: 1fr; } }
.qh-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .2em;
  color: var(--dim, #4a566b); margin: 0 0 10px; }
.qh-count { font-style: normal; color: var(--accent2, #4DD7CF); margin-left: 6px; }
.qh-body { font-size: 14.5px; line-height: 1.65; color: var(--text2, #c3cddb); margin: 0 0 14px; }
.qh-decision { display: flex; gap: 10px; padding: 9px 12px; margin-bottom: 8px;
  border-left: 2px solid var(--accent, #00A99D);
  background: color-mix(in srgb, var(--accent, #00A99D) 7%, transparent);
  font-size: 13.5px; line-height: 1.5; }
.qh-decision em { color: var(--muted, #7b8aa0); font-style: normal; }
.qh-at { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent2, #4DD7CF);
  font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.qh-owe { display: flex; gap: 11px; align-items: flex-start; padding: 10px 2px;
  border-bottom: 1px solid var(--line2, #131c26); cursor: pointer; }
.qh-owe input { margin-top: 3px; accent-color: var(--accent, #00A99D); }
.qh-owe b { display: block; font-weight: 500; font-size: 13.5px; line-height: 1.45; }
.qh-owe em { font-family: 'IBM Plex Mono', monospace; font-style: normal; font-size: 10px;
  letter-spacing: .1em; color: var(--dim, #4a566b); }
.qh-owe.is-plain { cursor: default; }
.qh-tickmark { color: var(--accent, #00A99D); margin-top: 1px; }
.qh-transcript { margin-top: 16px; max-height: 380px; overflow: auto;
  border: 1px solid var(--line2, #131c26); background: var(--sunk, #070a0f); padding: 14px 16px; }
.qh-transcript p { margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--text2, #c3cddb); }
.qh-transcript .qh-at { margin-right: 10px; }
.qh-who { color: var(--accent, #00A99D); font-weight: 600; margin-right: 8px; }
.qh-transcript pre { white-space: pre-wrap; font: 12.5px/1.6 'IBM Plex Mono', monospace;
  color: var(--text2, #c3cddb); }

/* ── the rail ── */
.qh-rail { min-width: 0; }
.qh-railhead { display: flex; align-items: center; gap: 8px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .22em;
  color: var(--dim, #4a566b); margin: 26px 0 10px; }
.qh-railhead:first-child { margin-top: 4px; }
.qh-railhead::after { content: ""; flex: 1; height: 1px; background: var(--line, #16202c); }
.qh-next { border: 1px solid var(--accent, #00A99D); background:
  color-mix(in srgb, var(--accent, #00A99D) 6%, var(--panel, #070b10));
  padding: 16px 18px; box-shadow: 0 0 24px var(--glow, rgba(0,169,157,.16)); }
.qh-nextwhen { display: flex; align-items: center; gap: 8px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .18em;
  color: var(--accent2, #4DD7CF); margin: 0 0 6px; }
.qh-nexttitle { font-size: 19px; font-weight: 600; margin: 0 0 4px; }
.qh-railnote { margin: 6px 0 0; font-size: 13px; }
.qh-proj { margin-bottom: 12px; }
.qh-projname { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .16em;
  color: var(--accent2, #4DD7CF); margin: 0 0 6px; }
.qh-projname em { font-style: normal; color: var(--dim, #4a566b); }
.qh-open { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0;
  font-size: 13.5px; line-height: 1.45; color: var(--text2, #c3cddb); cursor: pointer; }
.qh-open input { margin-top: 3px; accent-color: var(--accent, #00A99D); }
.qh-pipe { border: 1px solid var(--line2, #131c26); background: var(--sunk, #070a0f); padding: 6px 14px; }
.qh-pipestep { display: flex; gap: 10px; align-items: center; padding: 8px 0;
  border-bottom: 1px solid var(--line2, #131c26); font-size: 13px; }
.qh-pipestep:last-child { border-bottom: 0; }
.qh-pipemark { font-family: 'IBM Plex Mono', monospace; }
.qh-pipestep.is-ok .qh-pipemark { color: var(--accent, #00A99D); }
.qh-pipestep.is-bad .qh-pipemark { color: var(--danger, #ff5964); }
.qh-pipestep.is-bad .qh-pipelabel { color: var(--danger, #ff5964); }
`;
