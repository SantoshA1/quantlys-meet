// Short opaque ids for new meeting rooms.
//
// crypto.randomUUID arrived late in Safari (15.4). Calling it bare on an older
// Mac Safari throws, leaves the host Start button stuck on STARTING…, and the
// person never leaves /host — which reads as "Safari won't let me host".

/** 12 hex chars, always. Prefer randomUUID; fall back to getRandomValues. */
export function randomHex(n: number): string {
  const len = Math.max(1, Math.floor(n));
  const bytes = new Uint8Array(Math.ceil(len / 2));
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

/** Room name: qm- + 12 hex. Safe when crypto.randomUUID is missing. */
export function newRoomId(prefix = "qm-"): string {
  let raw = "";
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      raw = crypto.randomUUID().replace(/-/g, "");
    }
  } catch {
    raw = "";
  }
  if (!raw || raw.length < 12) raw = randomHex(16);
  return prefix + raw.slice(0, 12);
}
