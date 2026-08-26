// The ONE browser Supabase client.
//
// FIELD 2026-08-25: the host console showed "admin@agilityserv.com" and a SIGN
// OUT button in its header, and the PRD panel directly below said "Sign in
// first." Pressing PRD AGENT in a meeting did nothing at all. Both were the
// same bug, and it was mine.
//
// Two different clients were in play:
//
//   · The host console signs in with `createClient` from
//     @supabase/supabase-js, which keeps the session in LOCALSTORAGE.
//   · This helper returned `createBrowserClient` from @supabase/ssr, which
//     reads the session from COOKIES.
//
// Nothing was broken about either one. They simply look in different places,
// and the session only ever existed in the first. So the two components I
// built on this helper — the PRD panel and the in-meeting agent — searched a
// drawer the key was never put in, concluded the person was signed out, and
// said so. The agent went further: it switched ITSELF OFF, which is why
// pressing the button appeared to do nothing whatsoever.
//
// @supabase/ssr is the right library for a server-rendered app that hands
// sessions between server and client through cookies. This app does not do
// that: it signs in entirely in the browser and sends the access token to its
// own routes as a bearer header. So supabase-js is the honest choice here,
// and this file now matches how the rest of the app actually works.
//
// A singleton, because every supabase-js client starts its own auth listener
// and refresh timer; several of them on one page produce a console full of
// "Multiple GoTrueClient instances" and a race over who refreshes the token.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export const supabaseBrowser = (): SupabaseClient => {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
};
