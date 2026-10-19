# Changelog

All notable changes to Quantlys Meeting. Dates are US Eastern.

## v1.1.3 (2026-10-19)

**The agent's question shows up, recordings include everyone, and Deepgram captions work on the hosted site.** Found while recording the product demo.

### Fixed
- **The PRD / Memory agent's question card was off-screen.** It was positioned inside the header's action row, so it rendered about 330px above the top of the window at every screen size, and the agent's questions were never seen. The card (and the agent's status box) are now fixed to the window: under the header and the "gaps still open" strip, on the left so they don't sit over Live notes, full-width on phones, and never taller than the space above the control bar. A tall card scrolls inside itself, and long answer options wrap instead of being cut off at the card's edge.
- **Recordings missed the other people in the call.** In Chrome, the recorder's audio mix came from the page's `<audio>` elements, which record remote WebRTC voices as silence, and it only looked when Record was pressed. The audio copy (the one that gets transcribed into notes, PRDs and Memory) had only the recorder's own voice. The mix is now built from the LiveKit audio tracks themselves and kept up to date for the whole take: people who join after Record, a re-published or switched mic, and screen-share audio are included, and your own mic still is.
- **Spec sessions had no captions.** The spec session and the PRD agent both switched captions on at the same moment; two browser speech recognisers started and stopped each other every 300ms, so no words ever appeared. Starting captions is now single-flight: a second "on" while starting or running does nothing, and turning them off cancels a start that's still in progress.
- **Spec sessions saved a second, empty recording.** Auto-record re-armed whenever recording stopped, including the stop inside Save & leave, so an empty take was saved after the real one. A spec session now auto-starts recording once per visit, and stopping it stays stopped.
- **Deepgram captions fell back to the browser on the hosted site.** The deployed `DEEPGRAM_API_KEY` can transcribe but can't create temporary browser keys (`keys:write`) or grants (`/v1/auth/grant`), so every meeting used the browser's recogniser and the caption glossary did nothing. Captions now try a grant, then a temporary key, and otherwise go through the new `/api/captions/relay`: your browser cuts your own mic into sentences at pauses and the server sends each one to Deepgram (nova-3, with names and the glossary as keyterms). The key never leaves the server. The relay requires the room's LiveKit token, fails closed when rooms aren't configured, is rate limited, and accepts only audio up to 400 KB. If it stops answering, captions switch to the browser's recogniser.

### Changed
- **The caption bar names the engine that's running:** "Deepgram", "Deepgram · via server" or "Browser speech". The captions panel and the button's tooltip say where your audio goes. With the relay, a line appears when the speaker pauses rather than word by word.

### Notes
- No database migration and no new environment variables. A Deepgram key with `keys:write` (or Member access, for grants) still gets word-by-word streaming captions. Any key that can transcribe gets the relay.

## v1.1.2 (2026-10-19)

**Privacy and access fixes. Recommended for every self-hosted install.** Found while testing a fresh self-host.

### Fixed
- **Deleting a meeting now deletes its recordings.** Delete used to look only at Egress bookkeeping rows, which the in-browser recorder never writes, so it said "deleted" while the video, audio copy, whiteboard snapshot and `.summary.json` transcript stayed in storage. It now removes everything under the host's `<hostId>/<room>/` folder plus the meeting's caption glossary, then re-lists storage and only reports success when the files are actually gone. If listing or removing fails, nothing is deleted and the meeting stays in the list with an error. Scope is strictly that host and that room: other rooms, other people's folders, and project-level PRD / Memory files (which can span several meetings) are left alone.
- **Retention actually deletes.** The nightly `/api/cron/cleanup` now deletes browser recordings older than `RECORDING_RETENTION_DAYS` (dated by the video's upload time — the same date the meeting history shows as "DELETES …"), video, audio, board and transcript together. Unset or `0` means off, matching the history page's "No automatic deletion is configured". Expired Egress rows are only removed once their files are confirmed gone. At most 500 recordings per run. `GET /api/cron/cleanup?dry=1` (with `CRON_SECRET`) lists what the next run would delete without deleting anything. The job reports failures with a 500 instead of `ok: true`.
- **Room tokens fail closed.** If the meeting lookup errors or hangs (database down, a missing table, a wrong service key), `/api/room/token` now answers `503` with a clear message instead of letting anyone into any room. Lookups time out after 6 seconds. The deliberate no-database mode (no Supabase env at all) is unchanged.

### Notes
- **Upgrading with `RECORDING_RETENTION_DAYS` set?** The first nightly run after you deploy will delete every recording older than that window (the ones your meeting history already showed a past "DELETES" date for). Check `GET /api/cron/cleanup?dry=1` with `Authorization: Bearer $CRON_SECRET` first, or unset the variable to keep everything.
- No database migration.
- If you deleted meetings on an earlier version, their recording files may still be in your `recordings` bucket under `<hostId>/<room>/`. They're no longer listed anywhere; remove them from the Supabase dashboard if you want them gone.
- Recordings made by someone other than the host are stored in that person's own folder, so they aren't removed by the host's Delete.

## v1.1.1 (2026-10-19)

**Recordings no longer get lost.** Prompted by three Memory sessions on Oct 17 that saved nothing.

### Fixed
- **Memory mode records automatically for the host**, like spec sessions already did. It starts about a second after the host is in the room (or switches into Memory). The red *Recording* badge goes up for everyone, and the join-screen notice is unchanged. If the host presses *Stop recording* it stays stopped; switching to Meeting and back to Memory turns it on again.
- **A recording survives a closed or crashed tab.** Every ~2-second piece of the recording, plus the audio twin, is also written to the host's browser storage (IndexedDB) as it's recorded. That copy holds who was there, the live captions so far and the duration. The next time the host opens the host page, any unfinished recording is uploaded automatically through the normal save path, and its summary, PRD or Memory story is written. The room page offers *Upload now* / *Discard*. The copy is deleted as soon as the video upload succeeds. A Web Lock held by the recording tab makes sure a recording that's still live in another tab is never picked up. At most the last few seconds are lost.
- **Leave asks first.** If you're recording, *Leave* asks to *Save & leave* and stops and uploads before disconnecting. Closing the tab still shows the browser's "leave site?" prompt while a recording is running or saving.
- **"This session wasn't recorded."** If the host leaves a Memory session that recorded nothing, the room says so before they go (with a *Record now* option), and the host page shows a notice afterwards.

### Notes
- Live saves are now named after the time the recording **started** (it was the time it stopped), so a recovered take lands on the same file instead of a duplicate.
- No database migration. No server or API changes; room-token gating, rate limits and security headers are untouched.

## v1.1.0 (2026-10-16)

### Added
- **"What did I miss?"** — a button in the room that recaps the last ~5 minutes of live captions: a short summary, decisions, open questions, and what changed in the PRD (or, in Memory mode, what's new in the story). Only the person who clicked sees it. Needs a valid room token and is rate-limited like the other AI endpoints. Without a model key it shows the last few lines as said.
- **Name + glossary boosting for live captions.** Participant names and an optional host-edited glossary (up to 50 terms, in *Manage people*) are sent to Deepgram so names and jargon are spelled right. `keywords` is used for nova-2 (the current caption model) and `keyterm` for nova-3. The glossary is saved as a small JSON file in the host's storage folder, so **no database migration is needed**.

## v1.0.1 (2026-10-12)

**Security update. Recommended for every self-hosted install.**

### Security
- **Room tokens are only issued for real meetings.** A link to a room that doesn't exist now returns an error instead of opening an empty room.
- **Only the host can reopen an ended meeting.** Rejoining as host also re-arms the end-of-meeting spec email; guests can no longer do either.
- **Rate limits on costly endpoints**: AI notes/search/PRD, email, and the room, caption and knock tokens. They return `429` with `Retry-After`.
  - The limit is shared across all server instances through a new Supabase table and function.
  - **This needs the migration `supabase/migrations/20261012_rate_limits.sql`.**
  - Without it, the app still works but falls back to a per-instance in-memory limit.
- **Live-caption keys now require a valid room token.** Knowing a room name is no longer enough.
- **Security headers on every page:** `X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera, mic and screen share for self only) and HSTS with `includeSubDomains`. A full Content-Security-Policy ships in **report-only** mode for now.

### Platform
- **Next.js 16 and React 19** (from Next 14 / React 18). This clears the outstanding critical/high npm advisories.
- **Node.js 22 or newer is now required** (`engines.node >= 22`).
- **LiveKit client and components updated** (`livekit-client` 2.22.4, `@livekit/components-react` 2.9.24), with a fix so in-room data messages (recording badge, reactions, captions sync) are delivered under React 19.
- **MediaPipe background-blur files now ship with the app.** The model is in `public/mediapipe/`, and the WASM is copied at build time by a `prebuild` step. This replaces the 404s and the CDN fallback.
- **`next build` no longer needs Supabase env vars at build time.**

### Fixes
- **Meeting Delete works again.** It no longer refuses every meeting as "still running"; it only refuses when people are actually in the room.
- **Errors show on the meeting's own row.**
- **The previously failing unit tests are fixed**, and `npm test` passes on Node 22.

### Upgrading
1. `git pull` (main) and `npm install`. Use Node 22+.
2. Run `supabase/migrations/20261012_rate_limits.sql` on your Supabase project, either in the SQL editor or with `supabase db push`.
   - It only adds the table `public.rate_limits` (RLS on, no anon access) and two functions callable by `service_role`.
3. Redeploy.

### Behavior changes
- **Links to rooms that don't exist** now show "This meeting does not exist" instead of an empty room.
- **Guests can't join a meeting the host has ended** until the host rejoins it.
- **Legitimate heavy use from one shared IP** (an office NAT) can hit `429` on AI endpoints. Raise or lower the limits in `lib/rate-limit.ts` (`LIMITS`) if needed.

## v1.0.0-oss (2026-10-02)

First open-source release.
