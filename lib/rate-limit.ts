// Fixed-window rate limiter for costly API routes.
//
// Global: backed by Supabase (table public.rate_limits + atomic RPC
// public.rate_limit_hit, see supabase/migrations/20261012_rate_limits.sql),
// so every Vercel instance shares one budget.
// Fallback: if the DB is not configured, the migration is not applied, or
// the call fails/times out, it degrades to a per-instance in-memory window.
// A failure backs the DB path off for 60s so a missing table costs nothing.

type Bucket = { count: number; resetAt: number };
const store: Map<string, Bucket> = ((globalThis as any).__qmRateStore ||= new Map());
const state: { dbOffUntil: number } = ((globalThis as any).__qmRateState ||= { dbOffUntil: 0 });

export type Limit = { limit: number; windowMs: number };

/** Default budgets per route group (requests per window per IP). */
export const LIMITS = {
  llm: { limit: 20, windowMs: 60_000 },
  email: { limit: 10, windowMs: 60_000 },
  token: { limit: 30, windowMs: 60_000 },
  knock: { limit: 120, windowMs: 60_000 },
  read: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, Limit>;

export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
}

/** In-memory window (fallback, and unit-testable). */
export function hit(key: string, { limit, windowMs }: Limit, now = Date.now()) {
  if (store.size > 10_000) {
    for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
  }
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

/** Shared window via Supabase. Returns null when the DB path is unavailable. */
export async function hitDb(key: string, { limit, windowMs }: Limit, now = Date.now()) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc || now < state.dbOffUntil || process.env.RATE_LIMIT_STORE === "memory") return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const r = await fetch(`${url}/rest/v1/rpc/rate_limit_hit`, {
      method: "POST",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: key, p_window_ms: windowMs }),
      signal: ctl.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(t));
    if (!r.ok) throw new Error(`rpc ${r.status}`);
    const rows: any = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    const count = Number(row?.hits);
    const resetAt = Date.parse(row?.reset_at);
    if (!Number.isFinite(count) || !Number.isFinite(resetAt)) throw new Error("rpc shape");
    return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
  } catch {
    state.dbOffUntil = now + 60_000;   // missing table / outage: stay in memory for a minute
    return null;
  }
}

/** Returns a 429 Response when the caller is over budget, else null. */
export async function rateLimit(req: Request, bucket: string, lim: Limit): Promise<Response | null> {
  if (process.env.RATE_LIMIT_DISABLED === "1") return null;
  const key = `${bucket}:${clientIp(req)}`;
  const r = (await hitDb(key, lim)) ?? hit(key, lim);
  if (r.ok) return null;
  const retry = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retry) } }
  );
}
