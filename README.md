# Quantlys Meeting

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_ORG/quantlys-meeting)

The button goes live once these files sit in YOUR GitHub repo (replace YOUR_ORG).

## Setup (~10 min, all copy-paste)
1. **LiveKit Cloud** → project → Settings→Keys → copy URL/KEY/SECRET.
   Settings→Webhooks → add `https://YOUR-APP.vercel.app/api/livekit/webhook`.
2. **Supabase** → new project → API keys (url, anon, service_role).
   Auth→Providers→Email: enable magic link. SQL Editor: run `supabase/schema.sql`.
3. **Cloudflare R2** → private bucket `quantlys-recordings` → API token → keys+endpoint.
4. **Deepgram** → API key.
5. Click **Deploy**, paste all vars from `.env.example` into Vercel, redeploy.

## This week's 5-person test
- Set ALLOW_GUEST_JOIN=true (both vars). New meeting → Copy meeting link → send to 5.
- Watch per-person quality bars: one red = their wifi, all red = the app.
- Spot-check 3 standups incl. one overlap moment. Transcript accurate+useful? → drop Zoom.
- After test: set ALLOW_GUEST_JOIN=false, redeploy. Drop `/standup` in the calendar.
