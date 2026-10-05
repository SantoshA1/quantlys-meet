# Self-host Quantlys Meeting

Two layers people mix up:

1. **App + data plane** — this Next.js app, Supabase, Deepgram, a model key, S3-compatible storage. You always bring your own keys.
2. **Realtime SFU** — LiveKit Cloud *or* a `livekit-server` you run. Media path only.

You can self-host (2) while still using vendor SaaS for (1), or replace each piece over time.

## Path A — Fastest: LiveKit Cloud + your keys

Follow the root [README](../README.md) quickstart. Point `LIVEKIT_*` at LiveKit Cloud, fill Supabase / Deepgram / OpenRouter-or-OpenAI / S3 / `APP_URL`, deploy to Vercel (or run `npm run dev`).

## Path B — Your own LiveKit SFU (no LiveKit Cloud account)

Config and a smoke client live under [`selfhost/`](../selfhost/).

```bash
# 1. LiveKit server — one binary, keys you generate
curl -sSL -o lk.tar.gz \
  https://github.com/livekit/livekit/releases/download/v1.9.12/livekit_1.9.12_linux_amd64.tar.gz
tar xzf lk.tar.gz
# Edit selfhost/livekit.yaml — replace GENERATE-YOUR-OWN-44-CHAR-SECRET
./livekit-server --config selfhost/livekit.yaml

# 2. App pointed at localhost SFU
cp selfhost/env.selfhost.example .env.local
# Also fill Supabase / Deepgram / model / S3 as needed for features beyond join
npm install
npm run dev
```

Match `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` to the `keys:` block in `livekit.yaml`.

Proof harness (optional): `selfhost/selfhost.test.mjs` (Playwright) — see comments in that file.

### What the single SFU binary does **not** do

| Capability | Needs |
|---|---|
| Recording / Egress | Separate `livekit-egress` + Redis + storage. Without it, Record can hang ~20s then 503. |
| Meeting history, waiting room, notes | Supabase (or any Postgres wired the same way) |
| Captions | Deepgram (else browser speech API may upload audio to Google in Chrome) |
| Notes / PRD / Memory | OpenRouter or OpenAI |
| Invites / digest | Resend |

Self-hosting the SFU keeps **media** off LiveKit Cloud. It does **not** automatically keep **words** on-prem — see `dataLeaving()` in `lib/hosting.ts`.

## Path C — Full white-label checklist

1. Clone this repo; set every required key in `.env.example`.
2. Run `supabase/schema.sql` on your Supabase project (or compatible Postgres + Auth).
3. Private S3/R2 bucket for recordings.
4. LiveKit Cloud **or** your SFU (+ egress if you need Record).
5. Deploy Next.js (`vercel` or `next start` behind TLS).
6. Set `APP_URL` to your domain; update marketing metadata/sitemap if you do not want `quantlys-meeting.com` SEO URLs.
7. Decide guest policy (`ALLOW_GUEST_JOIN` + public mirror).
8. Rotate any keys that ever touched a shared or demo environment.

## Not in this repo

Quantlys **Conclave** and other Quantlys platform services stay closed. PRDs from this app are markdown you can paste into Linear, GitHub, or Conclave by hand — there is no Conclave import API.

## Recording size (1080p takes)

The room records one continuous 1920×1080 / 30fps file in the host's browser (MP4 in Chrome/Edge/Safari — H.264 where the browser has an encoder, otherwise VP9-in-MP4 — and WebM in Firefox) at ~6 Mbps — roughly **2.7 GB per hour**. Takes larger than 6 MB upload to Supabase Storage with the resumable (TUS) protocol in 6 MB transport chunks; the stored object is still a single file.

Raise **Supabase → Storage → Settings → Upload file size limit** (and any per-bucket limit on `recordings`) above your longest expected take. The Free plan caps files at 50 MB (≈1 minute of 1080p); when storage refuses a take, the room keeps it in the tab and shows **Download take** so nothing is lost.
