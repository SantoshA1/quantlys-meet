// PRD export: direct push to GitHub Issues, Linear, Jira Cloud and Notion
// with the host's OWN credentials (Tier 2), plus the owner check the shared
// PRD page uses to show the Export menu to its host only.
//
// POST { action, ... } with the host's bearer token. Actions:
//   status                         what's connected (hints only, never tokens)
//   connect   { provider, credentials }   verify with the provider, then store encrypted
//   disconnect{ provider }         delete the stored credential
//   targets   { provider }         repos / teams / projects / pages to choose from
//   preview   { provider, project, target, children }   the mapping, nothing sent
//   push      { provider, project, target, children }   create or update, idempotent
//   share-owner { shareId }        is this signed-in person the share's host?
//
// The PRD is ALWAYS read server-side from the caller's own storage prefix
// (prdPath(user.id, project)), so a host can only export their own PRD and
// the browser never gets to say what the document contains.
//
// Tier 2 needs INTEGRATIONS_ENCRYPTION_KEY and the 20261019 migration. Without
// either, `status` says so and every Tier 2 action answers 503, while the
// no-setup Tier 1 export (client-side) keeps working.

import { createClient } from "@supabase/supabase-js";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { prdPath } from "@/lib/prd";
import { acceptShareMap, isShareId, shareMapPath, shareUrl } from "@/lib/prd-share";
import {
  PROVIDERS, isProvider, acceptCreds, acceptTarget, buildPlan, previewPlan, projectSlug,
  type Provider, type ExistingRef,
} from "@/lib/integrations";
import { integrationsKey, encryptSecret, decryptSecret, aadFor, secretHint } from "@/lib/integrations-crypto";
import { PROVIDER_API, ProviderError, authMsg, type Ctx } from "@/lib/integrations-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CRED_TABLE = "integration_credentials";
const EXPORT_TABLE = "integration_exports";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

function originOf(req: Request): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}

function ctx(): Ctx {
  // Local e2e only: route provider calls to a mock. Ignored on any Vercel
  // deployment (preview or production), so it can never redirect real pushes.
  const testBase = !process.env.VERCEL && process.env.INTEGRATIONS_TEST_API_BASE ? process.env.INTEGRATIONS_TEST_API_BASE : undefined;
  return { fetch: globalThis.fetch.bind(globalThis), testBase };
}

const memo: { at: number; ok: boolean; why: string } = ((globalThis as any).__qmIntAvail ||= { at: 0, ok: false, why: "" });

/** Tier 2 is on only when the key is valid AND the tables exist. */
async function tier2(sb: any): Promise<{ ok: boolean; why: string }> {
  if (!integrationsKey()) return { ok: false, why: "Direct push isn't set up on this server yet (no encryption key)." };
  if (Date.now() - memo.at < 60_000 && memo.ok) return memo;
  // A real (non-HEAD) read: HEAD requests come back without an error body
  // when the table is missing, which would make a missing migration look fine.
  const probe = await sb.from(CRED_TABLE).select("provider").limit(1);
  const r = probe.error
    ? { ok: false, why: "Direct push isn't set up on this server yet (database migration not applied)." }
    : { ok: true, why: "" };
  Object.assign(memo, r, { at: Date.now() });
  return r;
}

const json = (body: any, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readPrd(sb: any, userId: string, project: string): Promise<any | null> {
  try {
    const { data } = await sb.storage.from("recordings").download(prdPath(userId, project));
    if (!data) return null;
    const j = JSON.parse(await data.text());
    return j && typeof j.markdown === "string" && j.markdown.trim() ? j : null;
  } catch { return null; }
}

async function loadCreds(sb: any, userId: string, provider: Provider) {
  const key = integrationsKey()!;
  const { data, error } = await sb.from(CRED_TABLE).select("secret").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (error || !data?.secret) return null;
  try { return JSON.parse(decryptSecret(String(data.secret), key, aadFor(userId, provider))); } catch { return null; }
}

function failure(e: any, provider: Provider) {
  if (e instanceof ProviderError) {
    const label = { github: "GitHub", linear: "Linear", jira: "Jira", notion: "Notion" }[provider];
    const msg = authMsg(e.status, label) || `${label}: ${e.message}`;
    return json({ error: msg }, e.status === 401 || e.status === 403 ? 400 : e.status === 404 ? 404 : 502);
  }
  return json({ error: "Something went wrong talking to the service. Nothing secret was logged." }, 502);
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return json({ error: "Server storage is not configured." }, 503);
  }
  const ipLimited = await rateLimit(req, "integrations", LIMITS.read);
  if (ipLimited) return ipLimited;
  const sb = admin();
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = jwt ? await sb.auth.getUser(jwt) : null;
  const user = who?.data?.user;
  if (!user) return json({ error: "Please sign in." }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Couldn't read that request." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Couldn't read that request." }, 400);
  const action = String(body.action || "").trim().toLowerCase();

  // ── the shared PRD page: is this signed-in person its host? ─────────────
  if (action === "share-owner") {
    const id = String(body.shareId || "").trim().toLowerCase();
    if (!isShareId(id)) return json({ owner: false });
    try {
      const { data } = await sb.storage.from("recordings").download(shareMapPath(id));
      const map = data ? acceptShareMap(JSON.parse(await data.text())) : null;
      if (!map || map.userId !== user.id) return json({ owner: false });
      return json({ owner: true, project: map.project, shareUrl: shareUrl(originOf(req), id) });
    } catch { return json({ owner: false }); }
  }

  const avail = await tier2(sb);
  if (action === "status") {
    if (!avail.ok) return json({ available: false, reason: avail.why, providers: PROVIDERS });
    const { data } = await sb.from(CRED_TABLE).select("provider, hint, account_label, site, updated_at").eq("user_id", user.id);
    const connections: Record<string, any> = {};
    for (const r of data || []) connections[r.provider] = { hint: r.hint, label: r.account_label, site: r.site || "", at: r.updated_at };
    return json({ available: true, providers: PROVIDERS, connections });
  }
  if (!["connect", "disconnect", "targets", "preview", "push"].includes(action)) return json({ error: "Unknown action." }, 400);
  if (!avail.ok) return json({ error: avail.why, available: false }, 503);

  const provider = String(body.provider || "").trim().toLowerCase();
  if (!isProvider(provider)) return json({ error: "Unknown integration." }, 400);
  const heavy = await rateLimit(req, `integrations-${action}:${user.id}`, action === "push" ? { limit: 10, windowMs: 60_000 } : { limit: 20, windowMs: 60_000 });
  if (heavy) return heavy;
  const api = PROVIDER_API[provider];

  if (action === "disconnect") {
    const { error } = await sb.from(CRED_TABLE).delete().eq("user_id", user.id).eq("provider", provider);
    if (error) return json({ error: "Couldn't remove it. Try again." }, 503);
    return json({ ok: true, provider, connected: false });
  }

  if (action === "connect") {
    const acc = acceptCreds(provider, body.credentials);
    if (!acc.ok) return json({ error: acc.why }, 400);
    let label = "";
    try { label = (await api.verify(ctx(), acc.creds)).label; } catch (e) { return failure(e, provider); }
    const secret = encryptSecret(JSON.stringify(acc.creds), integrationsKey()!, aadFor(user.id, provider));
    const row = {
      user_id: user.id, provider, secret, hint: secretHint((acc.creds as any).token),
      account_label: label.slice(0, 120), site: acc.creds.provider === "jira" ? acc.creds.site : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from(CRED_TABLE).upsert(row, { onConflict: "user_id,provider" });
    if (error) return json({ error: "Couldn't save the connection. Try again." }, 503);
    return json({ ok: true, provider, connected: true, label: row.account_label, hint: row.hint, site: row.site || "" });
  }

  const creds = await loadCreds(sb, user.id, provider);
  if (!creds) return json({ error: "Connect this service first.", connected: false }, 400);

  if (action === "targets") {
    try { return json({ targets: (await api.targets(ctx(), creds)).slice(0, 200) }); } catch (e) { return failure(e, provider); }
  }

  // preview / push
  const project = String(body.project || "").trim().slice(0, 120);
  if (!project) return json({ error: "Which project?" }, 400);
  const target = acceptTarget(provider, String(body.target || ""));
  if (!target) return json({ error: provider === "github" ? "Pick a repository as owner/name." : "Pick where it should go." }, 400);
  const stored = await readPrd(sb, user.id, project);
  if (!stored) return json({ error: "Build the PRD first — there is nothing to export yet." }, 404);
  const backlink = /^[a-f0-9]{24}$/.test(String(stored.shareId || "")) ? shareUrl(originOf(req), String(stored.shareId)) : `${originOf(req)}/host#prd`;
  const plan = buildPlan({ project, markdown: String(stored.markdown), backlink, children: provider !== "notion" && body.children !== false });
  const slug = projectSlug(project);
  const { data: rows } = await sb.from(EXPORT_TABLE).select("item_key, external_id, external_url")
    .eq("user_id", user.id).eq("project_slug", slug).eq("provider", provider).eq("target", target);
  const existing: Record<string, ExistingRef> = {};
  for (const r of rows || []) existing[r.item_key] = { external_id: r.external_id, external_url: r.external_url };

  if (action === "preview") {
    return json({ provider, target, title: plan.title, ...previewPlan(plan, existing, provider) });
  }

  let result;
  try { result = await api.push(ctx(), creds, target, plan, existing); } catch (e) { return failure(e, provider); }
  const now = new Date().toISOString();
  const up = result.items.map((it) => ({
    user_id: user.id, project_slug: slug, provider, target, item_key: it.key,
    external_id: it.id, external_url: it.url, title: it.title.slice(0, 300), updated_at: now,
  }));
  const saved = up.length ? await sb.from(EXPORT_TABLE).upsert(up, { onConflict: "user_id,project_slug,provider,target,item_key" }) : { error: null };
  const warnings = [...result.warnings];
  if (saved.error) warnings.push("Pushed, but couldn't remember the links — a re-push may create duplicates.");
  if (plan.droppedStories) warnings.push(`${plan.droppedStories} more stor${plan.droppedStories === 1 ? "y was" : "ies were"} left out (limit 25 per push).`);
  return json({ ok: true, provider, target, items: result.items, warnings });
}
