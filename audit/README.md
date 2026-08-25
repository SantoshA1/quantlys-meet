# Maya suites — black-box, offline, against the real routes

`lib/*.test.mjs` guard the DECISIONS: pure functions, no network, no browser.
They are fast and they are where most of the rules live.

The files here guard the ROUTES. Maya's first invariant is that a feature is
tested the way a user meets it — through the endpoint the product actually
calls — so these import the real handler out of `app/api/**/route.ts`, hand it
a real `Request`, and read a real `Response`. Only the cloud is faked.

    npm test          # every lib guard + every Maya suite
    npm run test:maya # just these

## How a Next route runs under plain node

`audit/alias.mjs` is a module resolver hook doing two narrow jobs:

1. `@/lib/x` → `<repo>/lib/x.ts`, because Next resolves that through tsconfig
   paths and node does not read those.
2. `@supabase/supabase-js` → `audit/fake-cloud.mjs`, so no suite can reach a
   real project even by accident.

Node's own type-stripping handles the TypeScript. Nothing transforms code —
the handler under test is byte-for-byte the one that ships.

## The fake cloud

`audit/fake-cloud.mjs` is a store, not a mock: routes call `list`, `download`
and `upload`, and the suites assert on what actually landed. Every provider
response in it traces to a captured real one (MAYA V2-1) — in particular the
OpenRouter retired-model 404, `{"error":{"message":"No endpoints found for
anthropic/claude-3.5-sonnet.","code":404}}`, which is the failure from FIELD
2026-08-18 that killed every model-backed feature while the setup check stayed
green.

`fakeFetch` THROWS on any URL it does not recognise. That is deliberate: it is
what stops one of these quietly becoming an integration test.

## What these suites do NOT cover

- Whether the in-meeting agent interrupts. That decision is `lib/agent.ts`,
  running in the browser against live captions, and it is guarded by
  `lib/agent.test.mjs` — 35 checks, most of them refusals. A green run here
  says nothing about it.
- Anything that needs a real browser: the LiveKit room, the video pipeline,
  the background compositor. `lib/backgrounds.render.mjs` and
  `lib/effects.render.mjs` cover the pixels; they need `npm i -D playwright`.

## Negative controls, and the two bugs these caught

Every check has been proven to fail against sabotaged code. Five that were
run: fabricate a PRD on model failure (PRD-12), drop the ownership check
(PRD-10), stop topping up options (PRD-04), make the agent forget the
project's saved assessment (AG-05), remove the per-dimension cap (AG-06).

Two real bugs were caught here before shipping, both invisible to the pure
guards:

- **PRD-02** — the score. `round(0.3125, 3)` is `0.312` in Python and `0.313`
  in JavaScript, because Python rounds a tie to the even digit. The same
  project would have shown a different score in Conclave and in this app, for
  ever. `roundHalfEven` in `lib/prd.ts` exists because of that row.
- **AG-04** — the agent's relevance matcher compared substrings, so the cue
  `who` matched `the WHOLE thing` and the agent asked about target users in
  the middle of a conversation about risk.
