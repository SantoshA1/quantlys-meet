"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  COPY, guestStateLabel, afterEndCopy, isEmail, specPollDelay, type RequestStatus,
} from "@/lib/spec-email";

function tabHidden(): boolean {
  try { return typeof document !== "undefined" && document.visibilityState === "hidden"; } catch { return false; }
}

/**
 * Poll with an adaptive delay instead of a fixed setInterval. `tick` runs and
 * returns the latest { on, ended }; the next run is scheduled from that.
 * Coming back to a hidden tab refreshes right away.
 */
function useSpecPoll(tick: () => Promise<{ on: boolean; ended: boolean } | null>, deps: unknown[]) {
  const last = useRef({ on: false, ended: false });
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (t) { clearTimeout(t); t = null; }
      try {
        const s = await tick();
        if (s) last.current = s;
      } catch { /* keep last state */ }
      if (!alive) return;
      const d = specPollDelay({ ...last.current, hidden: tabHidden() });
      if (d != null) t = setTimeout(run, d);
    };
    const onVis = () => { if (!tabHidden() && !last.current.ended) run(); };
    run();
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; if (t) clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

type HostReq = {
  id: string;
  email: string;
  name?: string;
  status: RequestStatus;
  when?: string;
};

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || "";
}

async function api(body: any, auth = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${await token()}`;
  const r = await fetch("/api/spec-email", { method: "POST", headers, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

export function SpecEmailHost({
  room, accountEmail, readonly,
}: {
  room: string;
  accountEmail: string;
  readonly?: boolean;
}) {
  const [on, setOn] = useState(false);
  const [hostCopy, setHostCopy] = useState(true);
  const [hostEmail, setHostEmail] = useState(accountEmail);
  const [pending, setPending] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [requests, setRequests] = useState<HostReq[]>([]);
  const [ended, setEnded] = useState(false);
  const [acting, setActing] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/spec-email?room=${encodeURIComponent(room)}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.host) return { on: false, ended: true };
    setOn(Boolean(j.on));
    setHostCopy(j.hostCopy !== false);
    setHostEmail(j.hostEmail || accountEmail);
    setPending(Number(j.pending) || 0);
    setRequests(Array.isArray(j.requests) ? j.requests : []);
    setEnded(Boolean(j.ended));
    // Off: the toggle in this panel updates state directly, so no idle polling.
    return { on: Boolean(j.on), ended: Boolean(j.ended) || !j.on };
  }, [room, accountEmail]);

  useSpecPoll(load, [load, on]);

  const frozen = Boolean(readonly || ended);

  return (
    <div className="qse-block">
      <div className="qmr-panel-head">
        <strong>{COPY.title}</strong>
        <button
          className={`qmr-lock${on ? " qmr-on" : ""}`}
          disabled={acting === "tog" || frozen}
          onClick={async () => {
            setActing("tog");
            const out = await api({ room, action: "toggle", on: !on }, true);
            if (!out?.error) {
              setOn(Boolean(out.on));
              setHostCopy(out.hostCopy !== false);
              setHostEmail(out.hostEmail || accountEmail);
              setPending(Number(out.pending) || 0);
              setRequests(Array.isArray(out.requests) ? out.requests : []);
            }
            setActing("");
          }}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      <p className="qmr-fine" style={{ margin: "0 0 10px" }}>{COPY.helper}</p>
      {on ? (
        <>
          <label className="qse-check">
            <input
              type="checkbox"
              checked={hostCopy}
              disabled={frozen || acting === "copy"}
              onChange={async (e) => {
                const next = e.target.checked;
                setHostCopy(next);
                setActing("copy");
                await api({ room, action: "host_copy", hostCopy: next, hostEmail }, true);
                setActing("");
              }}
            />
            <span>{COPY.hostCopy}</span>
          </label>
          <input
            className="qmr-input"
            type="email"
            value={hostEmail}
            disabled={frozen || !hostCopy}
            onChange={(e) => setHostEmail(e.target.value)}
            onBlur={async () => {
              if (!isEmail(hostEmail)) return;
              await api({ room, action: "host_copy", hostCopy, hostEmail }, true);
            }}
            aria-label="Host copy address"
          />
          <button
            className="qmr-ghost qse-pending"
            onClick={() => setListOpen((v) => !v)}
          >
            Pending: {pending}
          </button>
          {listOpen || pending ? (
            <ul className="qse-list">
              {requests.filter((r) => r.status === "pending" || listOpen).length === 0 ? (
                <li className="qmr-muted">Nobody has asked yet.</li>
              ) : (
                requests.filter((r) => listOpen || r.status === "pending").map((r) => (
                  <li key={r.id}>
                    <span className="qse-who">
                      <b>{r.name || r.email.split("@")[0]}</b>
                      <em>{r.email}</em>
                      <i>{r.when || "Requested just now"}</i>
                    </span>
                    {r.status === "pending" && !frozen ? (
                      <span className="qse-acts">
                        <button
                          className="qmr-ghost qmr-admit"
                          disabled={acting === r.id}
                          onClick={async () => {
                            setActing(r.id);
                            const out = await api({ room, action: "approve", requestId: r.id }, true);
                            if (Array.isArray(out.requests)) setRequests(out.requests);
                            setPending(Number(out.pending) || 0);
                            setActing("");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="qmr-ghost"
                          disabled={acting === r.id}
                          onClick={async () => {
                            setActing(r.id);
                            const out = await api({ room, action: "deny", requestId: r.id }, true);
                            if (Array.isArray(out.requests)) setRequests(out.requests);
                            setPending(Number(out.pending) || 0);
                            setActing("");
                          }}
                        >
                          Deny
                        </button>
                      </span>
                    ) : (
                      <em className="qse-st">{guestStateLabel(r.status)}</em>
                    )}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function SpecEmailGuest({
  room, name, live, disconnected,
}: {
  room: string;
  name: string;
  live: boolean;
  disconnected?: boolean;
}) {
  const key = `qm-spec-email-${room}`;
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<RequestStatus | "already" | "">("");
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    try { setEmail(window.sessionStorage.getItem(key) || ""); } catch { /* private mode */ }
  }, [key]);

  const load = useCallback(async () => {
    const stored = (() => { try { return window.sessionStorage.getItem(key) || ""; } catch { return ""; } })();
    const q = stored ? `&email=${encodeURIComponent(stored)}` : "";
    const r = await fetch(`/api/spec-email?room=${encodeURIComponent(room)}${q}`);
    const j = await r.json().catch(() => ({}));
    setOn(Boolean(j.on));
    setEnded(Boolean(j.ended));
    if (j?.my?.status) {
      setStatus(j.my.status);
      if (j.my.email) setEmail(j.my.email);
    }
    // Untracked room (no meeting row) never gets the feature: stop asking.
    return { on: Boolean(j.on), ended: Boolean(j.ended) || j?.tracked === false };
  }, [room, key]);

  useSpecPoll(load, [load, disconnected]);

  const note = afterEndCopy({ on, myStatus: status as any, email });
  if (disconnected && ended) {
    if (!note) return null;
    return <div className="qse-after" role="status">{note}</div>;
  }
  if (!on || !live || ended) return null;

  return (
    <div className="qse-guest">
      {open ? (
        <div className="qse-panel">
          <label className="qse-lab">Email</label>
          <input
            className="qmr-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
          <p className="qmr-fine">{COPY.guestHelper}</p>
          <button
            className="qmr-primary"
            disabled={!isEmail(email) || status === "pending" || status === "approved"}
            onClick={async () => {
              try { window.sessionStorage.setItem(key, email); } catch { /* */ }
              const out = await api({ room, action: "request", email, name });
              if (out.status === "already") setStatus("already");
              else if (out.my?.status) setStatus(out.my.status);
              else if (out.status) setStatus(out.status);
            }}
          >
            {COPY.guestButton}
          </button>
          {status ? <p className="qse-state">{guestStateLabel(status)}</p> : null}
        </div>
      ) : null}
      <button className={`qmr-ghost qse-ask${open ? " qmr-on" : ""}`} onClick={() => setOpen((v) => !v)}>
        {COPY.guestAsk}
      </button>
    </div>
  );
}

export function SpecEmailChip({
  room, onOpen,
}: {
  room: string;
  onOpen: () => void;
}) {
  const [n, setN] = useState(0);
  useSpecPoll(async () => {
    const r = await fetch(`/api/spec-email?room=${encodeURIComponent(room)}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.host) { setN(0); return { on: false, ended: true }; }
    setN(Number(j.pending) || 0);
    return { on: Boolean(j.on), ended: Boolean(j.ended) };
  }, [room]);
  if (!n) return null;
  return (
    <button className="qmr-ghost qmr-on" onClick={onOpen} title="Approve who gets the spec">
      {n} waiting
    </button>
  );
}

export const SPEC_EMAIL_CSS = `
.qse-block { margin-top:14px; padding-top:14px; border-top:1px solid #262b36; }
.qse-check { display:flex; align-items:center; gap:8px; font-size:13.5px; color:#cfd6e4;
  margin:8px 0; cursor:pointer; }
.qse-check input { accent-color:#00a99d; }
.qse-pending { margin-top:10px; font-size:12.5px; padding:6px 12px; }
.qse-list { list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:8px; }
.qse-list li { display:flex; align-items:flex-start; gap:8px; font-size:13px; }
.qse-who { display:flex; flex-direction:column; min-width:0; flex:1; }
.qse-who b { font-size:13.5px; }
.qse-who em, .qse-who i { font-style:normal; color:#8b93a5; font-size:12px; }
.qse-acts { display:flex; gap:6px; flex:0 0 auto; }
.qse-acts button { padding:4px 10px; font-size:12px; }
.qse-st { font-style:normal; color:#8b93a5; font-size:12px; }
.qse-guest { position:absolute; left:50%; transform:translateX(-50%); bottom:78px; z-index:28;
  display:flex; flex-direction:column; align-items:center; gap:8px;
  width:min(420px, calc(100% - 32px)); }
.qse-ask { font-size:12.5px; padding:6px 12px; }
.qse-panel { width:100%; background:#10131a; border:1px solid #262b36; border-radius:12px;
  padding:12px 14px; box-shadow:0 14px 36px rgba(0,0,0,.55); }
.qse-lab { display:block; font-size:12px; color:#8b93a5; margin:0 0 6px; }
.qse-state { margin:8px 0 0; font-size:13px; color:#7fe0d6; }
.qse-after { position:absolute; left:50%; transform:translateX(-50%); top:72px; z-index:35;
  background:#0d2a2a; border:1px solid #00a99d; color:#c8f5f0; border-radius:11px;
  padding:11px 15px; font-size:14px; max-width:min(520px, calc(100% - 24px)); }
`;
