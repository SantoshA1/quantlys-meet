// Global guest-join gate.
//
// Guests joining from a link without an account is the product default
// ("Guests need a link, not an account"). ALLOW_GUEST_JOIN is the kill
// switch: set it to false when you want only signed-in people to mint a
// room token. Waiting room, lock, and host admit still apply on top when
// guests are allowed.
//
// Unset means ON — so a deploy that never copied the env var keeps the
// product behavior. Explicit false/0/off/no closes the door.

/** Explicit false/0/off/no → false; true/1/on/yes → true; empty/unset → defaultOn. */
export function envFlagOn(
  raw: string | undefined | null,
  defaultOn = true,
): boolean {
  if (raw == null) return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultOn;
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  return defaultOn;
}

/** Server-side gate used by token routes. Default ON when unset. */
export function guestJoinAllowed(
  env: Record<string, string | undefined> = process.env as any,
): boolean {
  return envFlagOn(env.ALLOW_GUEST_JOIN, true);
}

/**
 * Client/SSR UI gate. Prefer NEXT_PUBLIC_ALLOW_GUEST_JOIN when set so the
 * landing page can hide the guest card without a round trip; otherwise
 * mirror the server flag.
 */
export function guestJoinUiAllowed(
  env: Record<string, string | undefined> = process.env as any,
): boolean {
  const pub = env.NEXT_PUBLIC_ALLOW_GUEST_JOIN;
  if (pub != null && String(pub).trim() !== "") {
    return envFlagOn(pub, true);
  }
  return guestJoinAllowed(env);
}

export const GUEST_JOIN_CLOSED =
  "Guest join is off on this deployment. Sign in, or ask the host to turn ALLOW_GUEST_JOIN on.";
