// The weekly digest — what a project actually committed to, gathered from the
// week's meetings, with the ones still open from before it.
//
// Pure functions on purpose. The grouping and the "still open from before"
// rule are the parts that can be quietly wrong, so they are the parts that get
// unit-tested (lib/digest.test.mjs). Nothing here touches the network, the
// database, or the clock except through arguments.

export type Item = {
  id: string;
  project: string | null;
  room_name: string;
  meeting_title: string | null;
  text: string;
  owner: string | null;
  ts_seconds: number | null;
  status: string;
  met_at: string;          // when the MEETING happened — not when the row was written
  video_path?: string | null;
};

export type Group = {
  project: string;
  meetings: Array<{
    room_name: string;
    title: string;
    met_at: string;
    items: Item[];
  }>;
};

export type Digest = {
  from: string;
  to: string;
  openCount: number;
  meetingCount: number;
  thisWeek: Group[];
  carried: Group[];        // still open from BEFORE this week
  projects: string[];
};

export const PROJECT_FALLBACK = "General";

/** mm:ss, or h:mm:ss past an hour — the way a person reads a recording. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** "Fri, Aug 14" — short, because the digest is a list, not a report. */
export function shortDay(iso: string, tz?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: tz,
  });
}

export function rangeLabel(fromISO: string, toISO: string, tz?: string): string {
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: tz };
  return `${new Date(fromISO).toLocaleDateString("en-US", opt)} – ${new Date(toISO).toLocaleDateString("en-US", opt)}`;
}

/**
 * Group open items into project → meeting → items.
 *
 * Meetings sort newest-first inside a project, and projects sort by how much
 * is outstanding — the one with the most open work is the one you scroll to
 * first, which is the only ordering that survives a busy week.
 */
export function group(items: Item[]): Group[] {
  const byProject = new Map<string, Map<string, Group["meetings"][number]>>();
  for (const it of items) {
    const project = (it.project || "").trim() || PROJECT_FALLBACK;
    if (!byProject.has(project)) byProject.set(project, new Map());
    const meetings = byProject.get(project)!;
    // Key on the ROOM, not the title: two meetings can share a name, and one
    // meeting must never be split in half because someone renamed it.
    if (!meetings.has(it.room_name)) {
      meetings.set(it.room_name, {
        room_name: it.room_name,
        title: (it.meeting_title || "").trim() || "Quantlys Meeting",
        met_at: it.met_at,
        items: [],
      });
    }
    const m = meetings.get(it.room_name)!;
    if (it.met_at < m.met_at) m.met_at = it.met_at;   // earliest timestamp wins
    m.items.push(it);
  }
  const out: Group[] = [];
  for (const [project, meetings] of byProject) {
    const list = [...meetings.values()].sort((a, b) => (a.met_at < b.met_at ? 1 : -1));
    for (const m of list) {
      m.items.sort((a, b) => (a.ts_seconds ?? 0) - (b.ts_seconds ?? 0));
    }
    out.push({ project, meetings: list });
  }
  out.sort((a, b) => {
    const n = (g: Group) => g.meetings.reduce((t, m) => t + m.items.length, 0);
    const d = n(b) - n(a);
    return d !== 0 ? d : a.project.localeCompare(b.project);
  });
  return out;
}

/**
 * Build the whole digest from every OPEN item the person owns.
 *
 * The carry-forward is the point. An action item that quietly ages out of the
 * week it was said in is an action item nobody ever does — so anything still
 * open from before the window gets its own section rather than disappearing.
 */
export function build(items: Item[], fromISO: string, toISO: string): Digest {
  const open = items.filter((i) => i.status === "open");
  const inWeek = open.filter((i) => i.met_at >= fromISO && i.met_at <= toISO);
  const before = open.filter((i) => i.met_at < fromISO);
  const rooms = new Set(open.map((i) => i.room_name));
  const projects = [...new Set(open.map((i) => (i.project || "").trim() || PROJECT_FALLBACK))].sort();
  return {
    from: fromISO,
    to: toISO,
    openCount: open.length,
    meetingCount: rooms.size,
    thisWeek: group(inWeek),
    carried: group(before),
    projects,
  };
}

/** The Monday-to-Sunday window that just ended, in ISO. `now` is injected so
 *  the boundary is testable instead of "whatever the server thinks today is". */
export function lastWeek(now: Date): { from: string; to: string } {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  // Walk back to the most recent Monday, then take the seven days before it.
  const dow = end.getUTCDay();                  // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1;
  end.setUTCDate(end.getUTCDate() - backToMonday);
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - 7);
  const to = new Date(end.getTime() - 1);       // Sunday 23:59:59.999
  return { from: from.toISOString(), to: to.toISOString() };
}

const esc = (t: string) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function itemsHtml(g: Group[], links: Record<string, string>): string {
  return g
    .map(
      (grp) => `
    <div style="margin:0 0 30px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#00a99d;font-weight:700;margin:0 0 14px">${esc(grp.project)}</div>
      ${grp.meetings
        .map(
          (m) => `
        <div style="margin:0 0 20px">
          <div style="font-size:15px;font-weight:600;color:#e9edf5">${esc(m.title)}</div>
          <div style="font-size:12px;color:#8b93a5;margin:2px 0 9px">${esc(shortDay(m.met_at))}</div>
          ${m.items
            .map((it) => {
              const t = clock(it.ts_seconds);
              const href = links[it.room_name];
              const stamp = t
                ? href
                  ? `<a href="${href}#t=${it.ts_seconds}" style="color:#8b93a5;text-decoration:none;font-variant-numeric:tabular-nums">${t}</a>`
                  : `<span style="color:#8b93a5;font-variant-numeric:tabular-nums">${t}</span>`
                : "";
              return `<div style="display:flex;gap:10px;padding:5px 0;font-size:14px;color:#cfd6e4;line-height:1.5">
                <span style="color:#4a5262">—</span>
                <span style="flex:1">${esc(it.text)}${it.owner ? ` <span style="color:#8b93a5">(${esc(it.owner)})</span>` : ""}</span>
                <span style="flex:0 0 auto;font-size:12px">${stamp}</span>
              </div>`;
            })
            .join("")}
        </div>`
        )
        .join("")}
    </div>`
    )
    .join("");
}

/** The email. Same shape as the on-screen list, because a digest that reads
 *  differently in two places is two digests to keep true. */
export function html(d: Digest, opts: { intro: string; links?: Record<string, string>; appUrl?: string }): string {
  const links = opts.links || {};
  const title = d.projects.length === 1 ? d.projects[0] : "All projects";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0d13;color:#e9edf5;padding:30px;max-width:640px;margin:0 auto">
  <div style="font-size:13px;color:#8b93a5;margin:0 0 4px">Quantlys · Action items · ${esc(rangeLabel(d.from, d.to))}</div>
  <h1 style="font-size:24px;margin:0 0 16px;font-weight:700">${esc(title)}</h1>
  ${opts.intro ? `<p style="font-size:15px;line-height:1.6;color:#cfd6e4;margin:0 0 24px">${esc(opts.intro)}</p>` : ""}

  <div style="display:flex;gap:34px;padding:16px 0;border-top:1px solid #262b36;border-bottom:1px solid #262b36;margin:0 0 28px">
    <div><div style="font-size:26px;font-weight:700">${d.openCount}</div><div style="font-size:12px;color:#8b93a5">Open</div></div>
    <div><div style="font-size:26px;font-weight:700">${d.meetingCount}</div><div style="font-size:12px;color:#8b93a5">Conversation${d.meetingCount === 1 ? "" : "s"}</div></div>
  </div>

  ${d.thisWeek.length ? itemsHtml(d.thisWeek, links) : `<p style="color:#8b93a5;font-size:14px">Nothing new was committed to this week.</p>`}

  ${
    d.carried.length
      ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b93a5;font-weight:700;margin:34px 0 16px;padding-top:22px;border-top:1px solid #262b36">Still open from before</div>${itemsHtml(d.carried, links)}`
      : ""
  }

  <p style="font-size:12px;color:#6f7789;margin:32px 0 0;padding-top:18px;border-top:1px solid #262b36">
    Tick things off on your host page${opts.appUrl ? ` — <a href="${opts.appUrl}/host" style="color:#00a99d">${esc(opts.appUrl.replace(/^https?:\/\//, ""))}/host</a>` : ""}.
    Anything you don't tick off comes back next week, which is the point.
  </p>
</div>`;
}

/** Plain text, for the people whose mail client wins that argument. */
export function text(d: Digest, intro: string): string {
  const lines: string[] = [];
  lines.push(`Quantlys · Action items · ${rangeLabel(d.from, d.to)}`);
  if (intro) lines.push("", intro);
  lines.push("", `${d.openCount} open · ${d.meetingCount} conversation${d.meetingCount === 1 ? "" : "s"}`);
  const section = (g: Group[]) => {
    for (const grp of g) {
      lines.push("", grp.project.toUpperCase());
      for (const m of grp.meetings) {
        lines.push("", `${m.title} — ${shortDay(m.met_at)}`);
        for (const it of m.items) {
          const t = clock(it.ts_seconds);
          lines.push(`  — ${it.text}${it.owner ? ` (${it.owner})` : ""}${t ? `  ${t}` : ""}`);
        }
      }
    }
  };
  if (d.thisWeek.length) section(d.thisWeek);
  else lines.push("", "Nothing new was committed to this week.");
  if (d.carried.length) {
    lines.push("", "STILL OPEN FROM BEFORE");
    section(d.carried);
  }
  return lines.join("\n");
}
