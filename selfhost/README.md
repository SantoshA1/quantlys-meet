# Phase 0 — run it yourself

Everything below runs on one machine with no account anywhere. That is the
point: if a customer can do this, "your own meetings server" is a true
sentence, and the Conclave Meeting Pack has something real to sell.

## What was proved, 2026-08-18

| | |
|---|---|
| livekit-server | 1.9.12, one binary, `livekit.yaml`, keys generated locally |
| App changes required | **none** — four environment variables |
| Two browsers joined | yes, real Chromium, real WebRTC, real ICE |
| Audio crossed the SFU | 298 packets, `totalAudioEnergy` **1.81**, played-out peak **1.10** |
| Video crossed the SFU | 1280×720, **198** frames decoded, 860 KB |
| Forged token | refused — `invalid token` |
| Result | **24 / 24** |

## Reproduce

```bash
# 1. the server — one binary, no account
curl -sSL -o lk.tar.gz \
  https://github.com/livekit/livekit/releases/download/v1.9.12/livekit_1.9.12_linux_amd64.tar.gz
tar xzf lk.tar.gz
./livekit-server --config livekit.yaml          # keys are in the file; change them

# 2. the app, unchanged, pointed at it
cd ../mp4test
set -a && . ../phase0/.env.selfhost && set +a
npx next dev -p 3100

# 3. the proof
cd ../phase0
npm i playwright
node selfhost.test.mjs
```

## What the single binary does NOT do — measured, not assumed

**Recording.** `StartRoomCompositeEgress` hangs for **22.7 seconds** and then
returns `503 no response from servers`. Recording is a separate
`livekit-egress` service; it needs Redis and somewhere to put the file. The
app now says this in the pre-flight instead of letting a host discover it by
pressing Record and waiting.

**Storage, mail, transcription, notes.** Waiting room, lock, meeting history
and notes all need a database (Supabase or any Postgres); captions need
Deepgram or the browser; notes need a model provider; invites need Resend.
None of these are LiveKit's problem — they are the six ports the Meeting Pack
is meant to define, and Phase 0 is what turned that from a guess into a list.

**Privacy is not automatic.** Self-hosting the SFU stops the *media* leaving.
It does not stop the *words*: without a Deepgram key, live captions fall back
to the browser's speech API, which in Chrome uploads audio to Google. The
app now discloses this by name — see `dataLeaving()` in `lib/hosting.ts`.
