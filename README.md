# Quantlys Meeting

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SantoshA1/quantlys-meet)

Browser video meetings that write a markdown PRD from the recorded session. Guests join from a link; only the host signs in. **Plug your own keys** (LiveKit, Deepgram, Supabase, object storage, OpenAI/OpenRouter, Resend) and run a self-hosted / white-label stack.

Live product: [quantlys-meeting.com](https://quantlys-meeting.com)

## About Quantlys

**[Quantlys](https://www.quantlys.ai)** is an AI vertical platform. **Quantlys Meeting** is a dogfood product I built on that stack — a real meeting app we (Quantlys) use to exercise the platform (including Conclave-compatible PRD rubrics), then open-sourced so other companies can plug in their own keys and run their own video stack.

This repository is the meeting product only. Quantlys Conclave and the rest of the platform stay closed; see [What is NOT included](#what-is-not-included).

## Author

I’m **Santosh Adari** — I built Quantlys Meeting as Quantlys dogfood / a side-project-shaped OSS release.

- GitHub: [SantoshA1](https://github.com/SantoshA1)
- LinkedIn: [santoshadari](https://www.linkedin.com/in/santoshadari/)
- X: [@SantoshAdari1](https://x.com/SantoshAdari1)
- Quantlys: [quantlys.ai](https://www.quantlys.ai)

## What you get

- Real-time video/audio via **LiveKit** (Cloud or your own `livekit-server`)
- Live captions / transcription via **Deepgram**
- Auth, meeting history, and RLS via **Supabase**
- Recordings to **S3-compatible** storage (Cloudflare R2, AWS S3, MinIO, …)
- Notes, PRD, Memory chapters/clips, and search write-ups via **OpenRouter** or **OpenAI**
- Optional invites / digests via **Resend**
- Deploy on **Vercel** (or any Node host that can run Next.js 14)

## Architecture (high level)

```
Browser (Next.js app)
  ├─ LiveKit client  ──►  LiveKit SFU (Cloud or self-hosted)
  ├─ Captions         ──►  Deepgram
  └─ Host console     ──►  Next.js API routes
                              ├─ Supabase (Postgres + Auth)
                              ├─ S3-compatible storage (recordings)
                              ├─ OpenRouter / OpenAI (notes, PRD, Memory)
                              └─ Resend (optional mail)
```

Recording uses LiveKit Egress + your bucket. Self-hosting only the SFU binary does **not** include Egress — see [`selfhost/`](selfhost/) and [`docs/SELF_HOST.md`](docs/SELF_HOST.md).

## 10-minute quickstart

1. **LiveKit Cloud** → project → Settings → Keys → copy URL / API key / secret.
2. **Supabase** → new project → API keys (url, anon, service_role).  
   Auth → Providers → Email: enable magic link. SQL Editor: run [`supabase/schema.sql`](supabase/schema.sql).
3. **Object storage** → private bucket (e.g. Cloudflare R2 `quantlys-recordings`) → API token → keys + endpoint.
4. **Deepgram** → API key.
5. **OpenRouter** *or* **OpenAI** → API key (notes / PRD / Memory).
6. Clone and run locally, **or** click **Deploy** above and paste vars from [`.env.example`](.env.example).

```bash
git clone https://github.com/SantoshA1/quantlys-meet.git
cd quantlys-meet
cp .env.example .env.local   # fill LiveKit, Supabase, Deepgram, model key, S3
npm install
npm test                     # offline Maya / lib guards (Node 22+ for .ts import stripping)
npm run dev                  # open /host (sign in) + paste the guest link in a second tab
```

Set `APP_URL` to your public origin (local: `http://localhost:3000`, prod: your Vercel URL).

Full env reference: [`.env.example`](.env.example). Self-hosted SFU: [`docs/SELF_HOST.md`](docs/SELF_HOST.md).

## Required services & keys

| Service | Keys / vars | Needed for |
|---|---|---|
| **LiveKit** | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL` | Anyone joining a room |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Host auth, history, RLS |
| **Deepgram** | `DEEPGRAM_API_KEY` | Live captions / transcripts |
| **OpenRouter or OpenAI** | `OPENROUTER_API_KEY` or `OPENAI_API_KEY` | Notes, PRD, Memory, search write-up |
| **S3-compatible** | `S3_*` | Recordings + board sidecars |
| **App URL** | `APP_URL` | Invite/share/callback links |
| **Cron** | `CRON_SECRET`, `RECORDING_RETENTION_DAYS` | Retention cleanup (Vercel Cron) |
| **Resend** (optional) | `RESEND_API_KEY`, `RESEND_FROM` | Invites, digest, email-the-spec |
| **Guest policy** | `ALLOW_GUEST_JOIN`, `NEXT_PUBLIC_ALLOW_GUEST_JOIN` | Unsigned guest token mint (default on) |

Optional: `NOTES_MODEL`, `AGENT_MODEL`, `ALLOWED_EMAIL_DOMAIN`, `SPEC_EMAIL_SECRET`, `NEXT_PUBLIC_APP_URL`.

## Deploy notes (Vercel)

1. Import the repo (or use the Deploy button).
2. Paste every required key from `.env.example`.
3. Set `APP_URL` / `NEXT_PUBLIC_APP_URL` to the deployment URL.
4. Keep `ALLOW_GUEST_JOIN` and `NEXT_PUBLIC_ALLOW_GUEST_JOIN` in sync.
5. Cron routes are declared in [`vercel.json`](vercel.json) (`/api/cron/cleanup`, `/api/digest/weekly`). Protect them with `CRON_SECRET`.

Any host that can run `next build && next start` works; Vercel is the path this repo dogfoods.

## Guest join

- `ALLOW_GUEST_JOIN` (server) gates unsigned token mint. **Unset / true = guests ON**. Set `false` to require sign-in.
- `NEXT_PUBLIC_ALLOW_GUEST_JOIN` mirrors that for the landing guest card.
- Waiting room, meeting lock, and host admit still apply when guests are allowed.

## What is NOT included

- **Quantlys Conclave** (and the rest of the Quantlys platform / API) stays **closed**. This repo ships a PRD writer whose rubrics are *compatible* with Conclave scoring, plus honest paste-handoff copy. There is **no** one-click “send to Conclave” API — Conclave has no import endpoint for PRDs.
- **Production Quantlys Meeting secrets** (hosted `quantlys-meeting.com` keys, DB, buckets) are not in this repo and must not be.
- **LiveKit Egress** is not bundled. Cloud LiveKit includes it; a bare `livekit-server` binary does not — you need a separate egress service + Redis + storage for recording when fully self-hosting media.
- Brand SEO pages hardcode `quantlys-meeting.com` in metadata/sitemap for the hosted product. White-label operators should point `APP_URL` at their domain and adjust metadata as needed.

## Sample PRD & extras

- In-app specimen: `/example-prd` (labeled not a customer recording).
- In-repo mirror: [`examples/sample-prd.md`](examples/sample-prd.md).
- Whiteboard recording sidecars: `*.board.jpg` / `*.board.json` beside the video.
- Memory chapters & clips: `/host` → Memory (writers / podcasters).
- MODNet matte spike: [`public/models/README.md`](public/models/README.md) and `npm run modnet:download`.

## License

[MIT](LICENSE) — Copyright (c) 2026 Santosh Adari.

MODNet webcam weights under `public/models/` are Apache-2.0 (upstream); see that folder’s README.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Sanitize / go-public checklist: [`docs/OSS_SANITIZE.md`](docs/OSS_SANITIZE.md).
