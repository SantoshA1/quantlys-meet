// Email-the-spec: optional, off by default, one shot when a session ends
// and a markdown PRD exists. Pure functions so the rules can be tested
// without a network, a mailbox, or a meeting.

export type RequestStatus = "pending" | "approved" | "denied" | "unsubscribed";

export type SpecRequest = {
  id?: string;
  email: string;
  name?: string;
  status: RequestStatus;
  requestedAt: string;
};

export type SpecSettings = {
  on: boolean;
  hostCopy: boolean;
  hostEmail: string;
  sentAt: string | null;
  endedAt: string | null;
  requests: SpecRequest[];
};

const ADDR = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): string {
  const angled = String(raw || "").match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : String(raw || ""))
    .replace(/^mailto:/i, "")
    .trim()
    .replace(/[.,;]+$/, "");
  return candidate.toLowerCase();
}

export function isEmail(raw: string): boolean {
  return ADDR.test(normalizeEmail(raw));
}

/** Guest UI is in the live room only, and only while the feature is on. */
export function guestUiVisible(on: boolean, sessionLive: boolean): boolean {
  return Boolean(on) && Boolean(sessionLive);
}

export function canCreateRequest(opts: {
  on: boolean;
  sessionLive: boolean;
  email: string;
  existing?: SpecRequest | null;
}): { ok: boolean; reason?: "off" | "ended" | "bad_email" | "already" } {
  if (!opts.on) return { ok: false, reason: "off" };
  if (!opts.sessionLive) return { ok: false, reason: "ended" };
  if (!isEmail(opts.email)) return { ok: false, reason: "bad_email" };
  if (opts.existing) return { ok: false, reason: "already" };
  return { ok: true };
}

export function guestStateLabel(status: RequestStatus | "already" | ""): string {
  if (status === "pending") return "Requested";
  if (status === "approved") return "Approved";
  if (status === "denied") return "Denied";
  if (status === "already") return "Already requested for this email";
  if (status === "unsubscribed") return "Approved";
  return "";
}

/** "Requested just now" — the only relative phrase the screen spec asks for. */
export function requestedWhen(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Requested just now";
  const ago = nowMs - t;
  if (ago < 90_000) return "Requested just now";
  const mins = Math.round(ago / 60_000);
  if (mins < 60) return `Requested ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `Requested ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Requested ${days} day${days === 1 ? "" : "s"} ago`;
}

export function pendingCount(requests: SpecRequest[]): number {
  return (requests || []).filter((r) => r.status === "pending").length;
}

/** Who actually gets the one-shot mail. Unsubscribed rows are skipped even
 *  if they were previously approved. Off → nobody, even if the list is full. */
export function recipientsForSend(s: SpecSettings): string[] {
  if (!s.on) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const e = normalizeEmail(raw);
    if (!isEmail(e) || seen.has(e)) return;
    seen.add(e);
    out.push(e);
  };
  for (const r of s.requests || []) {
    if (r.status === "approved") add(r.email);
  }
  if (s.hostCopy) add(s.hostEmail);
  return out;
}

export function shouldSend(opts: {
  on: boolean;
  hasPrd: boolean;
  alreadySent: boolean;
  recipientCount: number;
}): boolean {
  return Boolean(opts.on) && opts.hasPrd && !opts.alreadySent && opts.recipientCount > 0;
}

export function specSubject(meetingTitle: string): string {
  const title = String(meetingTitle || "").trim() || "the session";
  return `Spec from ${title}`;
}

export function specFilename(meetingTitle: string): string {
  const slug = String(meetingTitle || "spec")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "spec";
  return `${slug}-spec.md`;
}

/** A markdown PRD from one recorded session's notes. Empty notes → no spec. */
export function sessionPrdMarkdown(notes: {
  title?: string;
  overview?: string;
  decisions?: string[];
  actions?: string[];
  followups?: string[];
  topics?: Array<{ title?: string; points?: string[] }>;
  transcript?: string;
}, meetingTitle: string): string | null {
  const title = String(notes?.title || meetingTitle || "").trim();
  const overview = String(notes?.overview || "").trim();
  const decisions = (notes?.decisions || []).map((x) => String(x || "").trim()).filter(Boolean);
  const actions = (notes?.actions || []).map((x) => String(x || "").trim()).filter(Boolean);
  const followups = (notes?.followups || []).map((x) => String(x || "").trim()).filter(Boolean);
  const topics = (notes?.topics || []).filter((t) => String(t?.title || "").trim());
  const transcript = String(notes?.transcript || "").trim();
  const hasBody = Boolean(overview || decisions.length || actions.length || topics.length || transcript);
  if (!hasBody) return null;
  const lines: string[] = [];
  lines.push(`# ${title || "Spec"}`);
  lines.push("");
  if (overview) {
    lines.push(overview);
    lines.push("");
  } else {
    lines.push("Markdown PRD from the recorded session.");
    lines.push("");
  }
  if (topics.length) {
    lines.push("## What was discussed");
    lines.push("");
    for (const t of topics) {
      lines.push(`### ${String(t.title).trim()}`);
      lines.push("");
      for (const p of t.points || []) {
        const s = String(p || "").trim();
        if (s) lines.push(`- ${s}`);
      }
      lines.push("");
    }
  }
  if (decisions.length) {
    lines.push("## Decisions");
    lines.push("");
    for (const d of decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (actions.length) {
    lines.push("## Action items");
    lines.push("");
    for (const a of actions) lines.push(`- ${a}`);
    lines.push("");
  }
  if (followups.length) {
    lines.push("## Follow-up");
    lines.push("");
    for (const f of followups) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

const esc = (t: string) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function specEmailHtml(opts: {
  meetingTitle: string;
  hostLabel: string;
  downloadUrl: string;
  unsubUrl: string;
}): string {
  const name = esc(opts.meetingTitle || "this session");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0d13;color:#e9edf5;padding:30px;max-width:600px;margin:0 auto">
  <div style="font-size:13px;color:#8b93a5;margin:0 0 6px">Quantlys Meeting</div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;color:#e9edf5;line-height:1.3">${esc(specSubject(opts.meetingTitle))}</h1>
  <p style="font-size:15.5px;line-height:1.65;color:#cfd6e4;margin:0 0 18px">
    Here is the markdown PRD from the recorded session for <b>${name}</b>.
    It is the spec the room wrote — not a recap of who said what.
  </p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
    <tr><td style="background:#00a99d;border-radius:8px">
      <a href="${esc(opts.downloadUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#04120f;text-decoration:none">Download the spec</a>
    </td></tr>
  </table>
  <p style="font-size:12px;color:#6f7789;margin:28px 0 0;padding-top:18px;border-top:1px solid #262b36">
    You asked for this in the room. Host: ${esc(opts.hostLabel || "the host")}.
    <a href="${esc(opts.unsubUrl)}" style="color:#8b93a5">Unsubscribe</a>.
  </p>
</div>`;
}

export function specEmailText(opts: {
  meetingTitle: string;
  hostLabel: string;
  downloadUrl: string;
  unsubUrl: string;
}): string {
  const name = String(opts.meetingTitle || "this session").trim();
  return [
    specSubject(name),
    "",
    `Here is the markdown PRD from the recorded session for ${name}.`,
    "It is the spec the room wrote — not a recap of who said what.",
    "",
    `Download the spec: ${opts.downloadUrl}`,
    "",
    `You asked for this in the room. Host: ${opts.hostLabel || "the host"}.`,
    `Unsubscribe: ${opts.unsubUrl}`,
  ].join("\n");
}

export function afterEndCopy(opts: {
  on: boolean;
  myStatus?: RequestStatus | "";
  email?: string;
}): string {
  if (!opts.on) return "";
  if (opts.myStatus === "approved" && opts.email) {
    return `The spec is on its way to ${opts.email}.`;
  }
  return "";
}

export const COPY = {
  title: "Email the spec",
  helper: "Guests can ask for the PRD at this email. You approve each one. Nothing is sent until you end this session.",
  hostCopy: "Also send me a copy",
  guestAsk: "Request the spec",
  guestHelper: "The host has to approve this. You'll get the PRD after they end the session, not a Zoom-style recap.",
  guestButton: "Request",
};

/**
 * How long the room waits before asking /api/spec-email again.
 * Fast only while the feature is on and the session is live; slow while it is
 * off (a guest still notices the host turning it on); slower in a hidden tab;
 * stopped after End. Returns null to stop polling.
 */
export const SPEC_POLL_MS = { live: 5_000, off: 30_000, hidden: 60_000 } as const;
export function specPollDelay(opts: { on: boolean; ended: boolean; hidden: boolean }): number | null {
  if (opts.ended) return null;
  if (opts.hidden) return SPEC_POLL_MS.hidden;
  return opts.on ? SPEC_POLL_MS.live : SPEC_POLL_MS.off;
}
