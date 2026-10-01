# Quantlys Meeting

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SantoshA1/quantlys-meet)

Browser video meeting that writes a markdown PRD from the recorded session. Guests join from a link; only the host signs in.

## Setup (~10 min)

1. **LiveKit Cloud** → project → Settings→Keys → copy URL / API key / secret.
   Settings→Webhooks → add `https://YOUR-APP.vercel.app/api/livekit/webhook`.
2. **Supabase** → new project → API keys (url, anon, service_role).
   Auth→Providers→Email: enable magic link. SQL Editor: run `supabase/schema.sql`.
3. **Cloudflare R2** → private bucket `quantlys-recordings` → API token → keys + endpoint.
4. **Deepgram** → API key.
5. **Vercel** → click **Deploy** above (or `vercel`), paste vars from `.env.example`, redeploy.
   Set `APP_URL` to the deployment URL. Optional: Resend for invites / email-the-spec.

Self-hosting the SFU (no LiveKit Cloud account) is documented under `selfhost/`.

## Local smoke path

1. `git clone https://github.com/SantoshA1/quantlys-meet.git && cd quantlys-meet`
2. `cp .env.example .env.local` — fill **LiveKit**, **Deepgram**, **Supabase**, and (for deploy) **Vercel**/R2 vars
3. `npm install`
4. `npm test` — offline Maya / lib guards (needs Node 22+ for `.ts` import stripping)
5. `npm run dev` → open two browser tabs: `/host` (sign in, create meeting, copy link) and paste the link in the second tab as a guest

## Guest join flag

- `ALLOW_GUEST_JOIN` (server) gates unsigned token mint. **Unset / true = guests ON** (product default). Set `false` to require sign-in.
- `NEXT_PUBLIC_ALLOW_GUEST_JOIN` mirrors that for the landing guest card — keep both in sync on Vercel.
- Waiting room, meeting lock, and host admit still apply when guests are allowed.

## MODNet matte spike

See `public/models/README.md` and `scripts/download-modnet.sh`.
Toggle: matte query param or `quantlys-matte` storage key. Chroma path unchanged.

## Sample PRD

In-app specimen: `/example-prd` (labeled not a customer recording).
In-repo mirror for OSS pin: [`examples/sample-prd.md`](examples/sample-prd.md).

## Whiteboard recording sidecars

When a meeting was drawn on, stopping the recording also uploads (same stem as the video):

- `*.board.jpg` — JPEG snapshot of the board (for multimodal PRD)
- `*.board.json` — raw stroke JSON (kept even after workflow conversion)

The meeting summary (`.summary.json`) also stores `strokes`, `workflow`, and `boardSnapshotPath`.
