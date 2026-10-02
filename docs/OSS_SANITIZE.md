# OSS sanitize checklist (before making the repo public)

Use this the day you flip GitHub visibility. Check every box.

## Secrets & credentials

- [ ] No `.env`, `.env.local`, or real API keys in the tree (`git status`, `git grep`)
- [ ] No private keys / `.pem` / service-account JSON tracked
- [ ] Git history reviewed for accidental secret commits (if any: rotate keys + consider `git filter-repo` / BFG before public)
- [ ] Production `quantlys-meeting.com` Supabase / LiveKit / Deepgram / R2 / OpenRouter / Resend keys are **only** in Vercel (or your secret store), never in GitHub Variables visible to forks
- [ ] `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` never appear in client bundles (`NEXT_PUBLIC_*` only for anon/url)

## Repo hygiene

- [ ] `.gitignore` covers `.env*`, `node_modules/`, `.vercel`, `*.pem`, `public/ort/`, extra ONNX weights
- [x] `LICENSE` file added (MIT — Copyright (c) 2026 Santosh Adari)
- [ ] README Deploy button URL matches the public repo path
- [ ] Remove or keep intentionally: `public/googled*.html`, IndexNow/`f080*.txt` (domain verification for hosted product — fine if you still operate that domain)
- [ ] `package.json` `"private": true` is OK (blocks npm publish); GitHub visibility is separate

## Product / Conclave boundary

- [ ] Confirm no private Quantlys API packages or git submodules
- [ ] Conclave remains closed; this repo only has mirrored PRD rubrics + paste handoff copy
- [ ] Landing / marketing no longer says “Source is private until dated” (see `app/HomeLanding.tsx`, `app/meeting-that-writes-prd/page.tsx`)

## Docs & community

- [ ] `.env.example` lists every key builders need (no real values)
- [ ] README + `docs/SELF_HOST.md` match current routes (no stale `/api/livekit/webhook` unless you add that route)
- [ ] `CONTRIBUTING.md` present
- [ ] Optional README badges: license shield, deploy, Node version
- [ ] Optional: GitHub Discussions / Issues templates

## Go-public sequence

1. Merge OSS docs PR to `main` (LICENSE included)
2. Final secret scan on `main`
3. Settings → Change repository visibility → **Public**
4. Tag a release (e.g. `v1.0.0-oss`) with the GH release blurb in `docs/ANNOUNCE_DRAFT.md`
5. Post X thread from that draft (do not reuse production secrets in screenshots)
