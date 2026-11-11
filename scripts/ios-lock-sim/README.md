# iPhone lock / tab-return simulation (Playwright)

Real-browser pressure test for PR #104. It drives a **local** build with
Playwright WebKit (iPhone 15 profile) and Chromium (fake media), against a
local `livekit-server --dev`. Deepgram and `/api/captions/token` are mocked
in the page (`routeWebSocket` / `route`), so no keys or cloud services are used.

Not part of `npm test` (it needs browsers and a LiveKit server), and it adds
no dependencies to the repo.

```sh
# 1. a LiveKit dev server (keys devkey / secret)
livekit-server --dev --bind 127.0.0.1 &

# 2. the app, built and started with ONLY the LiveKit dev keys — no
#    Supabase or Deepgram secrets
env -i PATH="$PATH" HOME=/tmp \
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  LIVEKIT_URL=ws://127.0.0.1:7880 NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880 \
  sh -c 'npx next build && npx next start -p 3100' &

# 3. the simulation (in any folder with playwright installed)
npm i playwright && npx playwright install --with-deps webkit chromium
BASE=http://127.0.0.1:3100 node scripts/ios-lock-sim/sim.mjs
```

What it simulates: `visibilityState` hidden → visible (and 25–30 event
storms), AudioContexts forced `suspended` / `interrupted` (stub), the
published mic `stop()` + `ended`, the Deepgram socket closed by the server,
and a rate-limited (429) token endpoint. Linux WebKit has no capture devices
or MediaRecorder, so `lib.mjs` synthesizes a tone + canvas and stands in a
MediaRecorder.

Not covered here (needs a real iPhone): what iOS actually does to capture,
AudioContexts and sockets during a real lock, and recording gap markers
(they need a signed-in host recording; unit-tested in lib/page-life.test.mjs).
