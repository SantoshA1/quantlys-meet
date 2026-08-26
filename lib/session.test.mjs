/**
 * MAYA GUARD — one browser session, not two.
 *
 * Maya asks: "The header says I'm signed in and there's a SIGN OUT button
 * right there. Why does the panel underneath it say 'Sign in first'?"
 *
 * FIELD 2026-08-25, with a screenshot showing exactly that, and a second
 * symptom that turned out to be the same line of code: pressing PRD AGENT in
 * a meeting did nothing whatsoever.
 *
 * Two different Supabase clients were in play. The host console signs in with
 * `createClient` from @supabase/supabase-js, which keeps the session in
 * LOCALSTORAGE. The helper my two new components used returned
 * `createBrowserClient` from @supabase/ssr, which reads it from COOKIES.
 * Neither was broken; they simply look in different places, and the session
 * only ever existed in the first. The agent went further than the panel — it
 * switched ITSELF OFF when it found nothing, which is why the button appeared
 * dead rather than complaining.
 *
 * Run: node lib/session.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const helper = code("./supabase-browser.ts");
const host = code("../app/host/page.tsx");
const prd = code("../app/host/Prd.tsx");
const agent = code("../app/room/[room]/Agent.tsx");

// ── 1. the helper matches how sign-in actually happens ───────────────────
ok(/from "@supabase\/supabase-js"/.test(helper),
  "the browser helper uses supabase-js — the same library, and therefore the same LOCALSTORAGE session, that the console signs in with");
ok(!/@supabase\/ssr/.test(helper),
  "NEGATIVE CONTROL, and this is the bug: @supabase/ssr reads the session from COOKIES. It is the right library for an app that hands sessions between server and client that way, and this app does not — it signs in entirely in the browser and sends a bearer token to its own routes");
ok(/signInWithOtp|verifyOtp/.test(host) && /from "@supabase\/supabase-js"/.test(host),
  "…and sign-in really does happen through supabase-js in the browser, which is what makes localStorage the right drawer to look in");

// ── 2. one client, not several ───────────────────────────────────────────
ok(/let _client/.test(helper) && /if \(!_client\)/.test(helper),
  "the helper is a singleton — every supabase-js client starts its own auth listener and refresh timer, and several on one page race over who refreshes the token");

// ── 3. both of the things that broke use it ──────────────────────────────
ok(/supabaseBrowser\(\)/.test(prd), "the PRD panel reads the session through the shared helper");
ok(/supabaseBrowser\(\)/.test(agent), "…and so does the in-meeting agent, which had the identical failure");
ok(!/createBrowserClient/.test(prd) && !/createBrowserClient/.test(agent),
  "neither one reaches for a cookie-based client of its own");

// ── 4. the server side is untouched, and must stay that way ──────────────
const callback = code("../app/auth/callback/route.ts");
ok(/createServerClient/.test(callback),
  "NEGATIVE CONTROL for over-correcting this fix: the SERVER routes still use @supabase/ssr, because a server route genuinely does read cookies. Only the browser half changed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
