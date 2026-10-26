// Keeping a Deepgram caption socket alive, or giving it up cleanly.
//
// FIELD 2026-10-25 (iPhone lock): the socket died while the phone was locked,
// onerror switched captions to the browser's recogniser for the rest of the
// meeting, and a clean close (no error) left them dead with nothing on screen.
//
// The rules, each one a bug it replaces:
//  - A close reconnects with a FRESH key (keys are short-lived).
//  - One reconnect at a time: a close that lands while one is scheduled or
//    fetching its key does not start a second socket.
//  - A hidden page waits for the return; spending the attempts while the
//    phone is locked would only reach the fallback sooner.
//  - Backoff 250ms → 1s → 3s → 6s; after DG_MAX_RECONNECTS in a row, give up
//    (the caller falls back to the browser's recogniser). No endless loop.
//  - A failing key endpoint (429 from the shared rate limit, 5xx, network)
//    is an attempt that backs off, not a reason to switch engines for good.
//  - The server answering "relay" or "browser" means pick again, the same way
//    a fresh start would.
//  - The attempts reset only after a socket has stayed up DG_HEALTHY_MS; one
//    message then a drop is not "healthy" (that was a token-per-loop cycle).
//  - stop() ends everything: no timer, no waiter, no socket, no late open.

import { DG_MAX_RECONNECTS, dgReconnectDelay, dgHealthy } from "./page-life.ts";

export type DgToken = { engine: string; token: string; scheme: "token" | "bearer" };

// Handlers typed loosely so a real WebSocket and a test fake both fit.
export type DgSocketLike = {
  onopen: any;
  onmessage: any;
  onerror: any;
  onclose: any;
  close: () => void;
};

export type DgSessionDeps<S extends DgSocketLike> = {
  connect: (token: string, scheme: "token" | "bearer") => S;
  fetchToken: () => Promise<DgToken>;
  onOpen: (sock: S) => void;
  onMessage: (data: any) => void;
  /** The socket went away (before any reconnect): stop feeding it. */
  onDrop: () => void;
  /** Too many attempts in a row: switch to the browser's recogniser. */
  onGiveUp: () => void;
  /** The server now says another engine: start captions again from scratch. */
  onRepick: () => void;
  isHidden: () => boolean;
  /** Call `cb` once the page is visible again; returns the unsubscribe. */
  whenVisible: (cb: () => void) => () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

export function createDgSession<S extends DgSocketLike>(d: DgSessionDeps<S>) {
  const now = d.now || (() => Date.now());
  const setTimer = d.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer || ((t) => clearTimeout(t as any));
  let stopped = false;
  let ws: S | null = null;
  let retries = 0;
  let timer: unknown = null;
  let fetching = false;
  let waiter: (() => void) | null = null;
  let openedAt = 0;
  let sockets = 0;

  const reconnect = () => {
    if (stopped || timer || fetching || waiter) return;
    if (retries >= DG_MAX_RECONNECTS) { stopped = true; d.onGiveUp(); return; }
    if (d.isHidden()) {
      waiter = d.whenVisible(() => { const w = waiter; waiter = null; w?.(); reconnect(); });
      return;
    }
    const delay = dgReconnectDelay(retries++);
    timer = setTimer(async () => {
      timer = null;
      if (stopped) return;
      fetching = true;
      let t: DgToken | null = null;
      try { t = await d.fetchToken(); } catch { t = null; }
      fetching = false;
      if (stopped) return;
      if (!t) { reconnect(); return; }
      if (t.engine !== "deepgram" || !t.token) { stopped = true; d.onRepick(); return; }
      open(t.token, t.scheme);
    }, delay);
  };

  const open = (tok: string, sch: "token" | "bearer") => {
    if (stopped) return;
    const sock = d.connect(tok, sch);
    sockets++;
    ws = sock;
    sock.onopen = () => {
      if (stopped || ws !== sock) return;
      openedAt = now();
      d.onOpen(sock);
    };
    sock.onmessage = (e: { data: any }) => {
      if (stopped || ws !== sock) return;
      if (dgHealthy(openedAt, now())) retries = 0;
      d.onMessage(e?.data);
    };
    // onerror is always followed by onclose; the close decides.
    sock.onerror = () => {};
    sock.onclose = () => {
      if (stopped || ws !== sock) return;
      ws = null;
      openedAt = 0;
      d.onDrop();
      reconnect();
    };
  };

  return {
    start: (token: string, scheme: "token" | "bearer") => open(token, scheme),
    stop: () => {
      stopped = true;
      if (timer) { clearTimer(timer); timer = null; }
      const w = waiter; waiter = null; w?.();
      const s = ws; ws = null;
      try { s?.close(); } catch { /* already closed */ }
    },
    /** For tests and the simulation: what is alive right now. */
    state: () => ({ stopped, retries, pending: Boolean(timer || fetching), waiting: Boolean(waiter), open: Boolean(ws), sockets }),
  };
}
