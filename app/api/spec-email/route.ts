// Email-the-spec: host toggle/list/approve, guest pending request.
// Guests are not signed in, so this uses the service role the same way
// waiting-room knocks do. Guests never see anyone else's address.

import { createClient } from "@supabase/supabase-js";
import {
  normalizeEmail, isEmail, canCreateRequest, guestUiVisible, pendingCount,
  requestedWhen, type SpecRequest,
} from "@/lib/spec-email";

function originOf(req: Request): string {
  try { return new URL(req.url).origin; } catch { return ""; }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function meetingByRoom(sb: any, room: string) {
  const full = await sb
    .from("meetings")
    .select("id, room_name, title, created_by, ended_at, spec_email_on, spec_email_host_copy, spec_email_host_address, spec_email_sent_at")
    .eq("room_name", room)
    .maybeSingle();
  if (!full.error) return full.data;
  const basic = await sb
    .from("meetings")
    .select("id, room_name, title, created_by, ended_at")
    .eq("room_name", room)
    .maybeSingle();
  return basic.data;
}

async function who(sb: any, req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const got = await sb.auth.getUser(jwt);
  return got?.data?.user || null;
}

function mapReq(r: any): SpecRequest {
  return {
    id: r.id,
    email: r.email,
    name: r.display_name || "",
    status: r.status,
    requestedAt: r.requested_at,
  };
}

async function listRequests(sb: any, meetingId: string) {
  const { data } = await sb
    .from("spec_email_requests")
    .select("id, email, display_name, status, requested_at")
    .eq("meeting_id", meetingId)
    .order("requested_at", { ascending: true });
  return ((data || []) as any[]).map(mapReq);
}

export async function GET(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ on: false, live: false });
  }
  const url = new URL(req.url);
  const room = String(url.searchParams.get("room") || "").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });
  const sb = admin();
  const meeting = await meetingByRoom(sb, room);
  if (!meeting) return Response.json({ on: false, live: false, tracked: false });

  const user = await who(sb, req);
  const isHost = Boolean(user && meeting.created_by === user.id);
  const live = !meeting.ended_at;
  const on = Boolean(meeting.spec_email_on);
  const guestEmail = normalizeEmail(url.searchParams.get("email") || "");

  if (!isHost) {
    let mine: SpecRequest | null = null;
    if (guestEmail && isEmail(guestEmail)) {
      const { data } = await sb
        .from("spec_email_requests")
        .select("id, email, display_name, status, requested_at")
        .eq("meeting_id", meeting.id)
        .eq("email", guestEmail)
        .maybeSingle();
      if (data) mine = mapReq(data);
    }
    return Response.json({
      on,
      live,
      ended: !live,
      guestUi: guestUiVisible(on, live),
      my: mine ? { status: mine.status, email: mine.email } : null,
    });
  }

  const requests = await listRequests(sb, meeting.id);
  const hostEmail = meeting.spec_email_host_address || user?.email || "";
  return Response.json({
    on,
    live,
    ended: !live,
    host: true,
    hostCopy: meeting.spec_email_host_copy !== false,
    hostEmail,
    sentAt: meeting.spec_email_sent_at || null,
    pending: pendingCount(requests),
    requests: requests.map((r) => ({
      ...r,
      when: requestedWhen(r.requestedAt, Date.now()),
    })),
  });
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server storage is not configured." }, { status: 503 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const room = String(body.room || "").trim();
  const action = String(body.action || "request").trim();
  if (!room) return Response.json({ error: "Which meeting?" }, { status: 400 });

  const sb = admin();
  const meeting = await meetingByRoom(sb, room);
  if (!meeting) return Response.json({ error: "No such meeting." }, { status: 404 });
  const user = await who(sb, req);
  const isHost = Boolean(user && meeting.created_by === user.id);
  const live = !meeting.ended_at;
  const on = Boolean(meeting.spec_email_on);

  if (action === "request") {
    const email = normalizeEmail(body.email || "");
    const name = String(body.name || "").trim().slice(0, 80);
    const { data: existing } = await sb
      .from("spec_email_requests")
      .select("id, email, display_name, status, requested_at")
      .eq("meeting_id", meeting.id)
      .eq("email", email)
      .maybeSingle();
    const gate = canCreateRequest({
      on, sessionLive: live, email, existing: existing ? mapReq(existing) : null,
    });
    if (!gate.ok) {
      if (gate.reason === "already") {
        return Response.json({ ok: false, status: "already", my: mapReq(existing) });
      }
      if (gate.reason === "off") return Response.json({ error: "The host has not turned this on." }, { status: 403 });
      if (gate.reason === "ended") return Response.json({ error: "This session has ended." }, { status: 409 });
      return Response.json({ error: "That does not look like an email address." }, { status: 400 });
    }
    const { data, error } = await sb
      .from("spec_email_requests")
      .insert({
        meeting_id: meeting.id,
        email,
        display_name: name || null,
        status: "pending",
      })
      .select("id, email, display_name, status, requested_at")
      .single();
    if (error) {
      return Response.json({ error: "Couldn't record that request. Has the spec_email_requests table been added?" }, { status: 500 });
    }
    return Response.json({ ok: true, status: "pending", my: mapReq(data) });
  }

  if (!isHost) {
    return Response.json({ error: "Only the person who created this meeting can do that." }, { status: 403 });
  }

  if (action === "toggle") {
    const next = Boolean(body.on);
    const patch: any = { spec_email_on: next };
    if (next) {
      if (meeting.spec_email_host_copy == null) patch.spec_email_host_copy = true;
      if (!meeting.spec_email_host_address && user?.email) {
        patch.spec_email_host_address = user.email;
      }
    }
    const { error } = await sb.from("meetings").update(patch).eq("id", meeting.id);
    if (error) {
      return Response.json({ error: "Couldn't save that. Has the spec_email_on column been added?" }, { status: 500 });
    }
    return GET(new Request(`${originOf(req)}/api/spec-email?room=${encodeURIComponent(room)}`, {
      headers: { authorization: req.headers.get("authorization") || "" },
    }));
  }

  if (action === "host_copy") {
    const hostEmail = normalizeEmail(body.hostEmail || user?.email || "");
    if (body.hostEmail && !isEmail(hostEmail)) {
      return Response.json({ error: "That does not look like an email address." }, { status: 400 });
    }
    const { error } = await sb.from("meetings").update({
      spec_email_host_copy: Boolean(body.hostCopy),
      spec_email_host_address: hostEmail || user?.email || null,
    }).eq("id", meeting.id);
    if (error) return Response.json({ error: "Couldn't save that." }, { status: 500 });
    return GET(new Request(`${originOf(req)}/api/spec-email?room=${encodeURIComponent(room)}`, {
      headers: { authorization: req.headers.get("authorization") || "" },
    }));
  }

  if (action === "approve" || action === "deny") {
    const id = String(body.requestId || "").trim();
    if (!id) return Response.json({ error: "Which request?" }, { status: 400 });
    if (!live && action === "approve") {
      // After End the list is read-only. Deny/approve both freeze.
    }
    if (!live) {
      return Response.json({ error: "The list is read-only after this session ends." }, { status: 409 });
    }
    const { error } = await sb
      .from("spec_email_requests")
      .update({ status: action === "approve" ? "approved" : "denied", decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("meeting_id", meeting.id);
    if (error) return Response.json({ error: "Couldn't record that." }, { status: 500 });
    return GET(new Request(`${originOf(req)}/api/spec-email?room=${encodeURIComponent(room)}`, {
      headers: { authorization: req.headers.get("authorization") || "" },
    }));
  }

  return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
