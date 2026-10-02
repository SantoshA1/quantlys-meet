# Self-hosted LiveKit SFU (Phase 0)

Run meetings against a `livekit-server` binary on your machine — no LiveKit Cloud account. The Next.js app needs **no code changes**; only environment variables.

Full white-label / data-plane notes: [`docs/SELF_HOST.md`](../docs/SELF_HOST.md).

## What was proved (2026-08-18)

| | |
|---|---|
| livekit-server | 1.9.12, one binary, `livekit.yaml`, keys generated locally |
| App changes required | **none** — environment variables only |
| Two browsers joined | yes — real Chromium, WebRTC, ICE |
| Audio / video across SFU | yes (measured packet/frame counts in the original spike) |
| Forged token | refused — `invalid token` |

## Reproduce

```bash
# 1. the server — one binary, no account
curl -sSL -o lk.tar.gz \
  https://github.com/livekit/livekit/releases/download/v1.9.12/livekit_1.9.12_linux_amd64.tar.gz
tar xzf lk.tar.gz
# Edit livekit.yaml — set your own API key + 44-char secret
./livekit-server --config livekit.yaml

# 2. the app, pointed at it
cd ..   # repo root
cp selfhost/env.selfhost.example .env.local
# Align LIVEKIT_* with livekit.yaml; add Supabase/Deepgram/model/S3 for full features
npm install
npm run dev

# 3. optional proof (Playwright)
cd selfhost
npm i playwright   # if not already available
node selfhost.test.mjs
```

Also see `railcheck.mjs` and `client.html` for low-level join checks.

## Limits of the single binary

**Recording.** `StartRoomCompositeEgress` without `livekit-egress` can hang ~20s then return `503 no response from servers`. Egress is a separate service (Redis + storage). The app surfaces this in pre-flight (`lib/hosting.ts`) instead of letting a host discover it by pressing Record.

**Storage, mail, transcription, notes.** Waiting room, lock, history, and notes need a database (Supabase); captions need Deepgram or the browser; notes need a model provider; invites need Resend.

**Privacy is not automatic.** Self-hosting the SFU stops *media* leaving via LiveKit Cloud. It does not stop *words*: without Deepgram, live captions may fall back to the browser speech API (Chrome can upload audio to Google). The app discloses destinations in `dataLeaving()`.
