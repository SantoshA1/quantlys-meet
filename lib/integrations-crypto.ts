// Host integration credentials, encrypted at rest (AES-256-GCM).
//
// The key is INTEGRATIONS_ENCRYPTION_KEY: 32 random bytes, base64 or hex.
// Generate one with:  openssl rand -base64 32
// Without a valid key, direct push (Tier 2) hides itself and nothing is
// ever stored — the no-setup Tier 1 export keeps working.
//
// Each ciphertext is bound to its owner and provider through GCM's
// additional authenticated data, so a row copied onto another user (or from
// "github" to "jira") fails to decrypt instead of quietly working.
//
// Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseKey(raw: string | undefined | null): Buffer | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return b.length === 32 ? b : null;
  }
  return null;
}

export function integrationsKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  return parseKey(env.INTEGRATIONS_ENCRYPTION_KEY);
}

export function aadFor(userId: string, provider: string): string {
  return `qm-int:v1:${String(userId)}:${String(provider)}`;
}

export function encryptSecret(plain: string, key: Buffer, aad: string): string {
  if (!key || key.length !== 32) throw new Error("bad key");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Throws on a wrong key, wrong owner/provider, or any tampering. */
export function decryptSecret(blob: string, key: Buffer, aad: string): string {
  const parts = String(blob || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("bad ciphertext");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("bad ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** What the browser is allowed to see of a stored secret: its last 4. */
export function secretHint(secret: string): string {
  const s = String(secret || "");
  return s.length >= 12 ? `…${s.slice(-4)}` : "…";
}
