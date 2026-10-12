// Lightweight fixed-window rate limiter for costly API routes.
//
// In-memory, per server instance: no new paid service, no new table. On
// Vercel each warm function instance keeps its own window, so this is a
// speed bump against scripted abuse (LLM / Deepgram / LiveKit / Resend spend),
// not a global quota. Swap the store for Supabase/KV later if needed.

type Bucket = { count: number; resetAt: number };
const store: Map<string, Bucket> = ((globalThis as any).__qmRateStore ||= new Map());

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

/** Returns a 429 Response when the caller is over budget, else null. */
export function rateLimit(req: Request, bucket: string, lim: Limit): Response | null {
  if (process.env.RATE_LIMIT_DISABLED === "1") return null;
  const r = hit(`${bucket}:${clientIp(req)}`, lim);
  if (r.ok) return null;
  const retry = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retry) } }
  );
}
