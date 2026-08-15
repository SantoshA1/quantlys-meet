import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Guard the redirect target: only allow same-origin relative paths,
  // so ?next= can't be used as an open-redirect to another site.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const cookieStore = cookies();
  // Prepare the response first so the SDK can write refreshed auth cookies onto it.
  const res = NextResponse.redirect(`${origin}${safeNext}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          ),
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  return res; // carries the freshly-set session cookies + the redirect
}
