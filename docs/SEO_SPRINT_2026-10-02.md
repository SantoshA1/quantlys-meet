# SEO sprint — 2026-10-02 (OSS + Memory)

Repo is **public**. X / WhatsApp / Facebook already posted by human. This pack is for indexing + remaining paste channels. **No auto-post. No invented GSC metrics.**

## Live audit (pre-ship)

| Check | Result |
|---|---|
| `robots.txt` | Allow marketing URLs; Disallow `/host`, `/api`, `/meeting/`, `/prd/`, … Prefix-safe. |
| `sitemap.xml` | 200 via curl; listed `/`, PRD cluster, `/privacy`. |
| Homepage title | `Quantlys Meeting \| Leave the call with a spec, not notes` |
| Already indexed (operator note) | `/prd-from-meeting`, `/meeting-that-writes-prd` |

## Shipped in this sprint

| URL | Intent |
|---|---|
| `/open-source-video-meeting` | Open-source / self-host / Zoom-alt / BYO keys |
| `/memory-mode` | Podcast chapters/clips, oral history, book-from-conversations |
| Homepage | Memory section + stronger OSS/GitHub/release/quantlys.ai links + FAQ |
| `sitemap.ts` / `robots.ts` | New URLs; `Disallow: /memory/` (app shares); Allow new pages |
| `scripts/indexnow-ping.mjs` | IndexNow + Google sitemap ping |

Reuse (no thin duplicates): `/prd-from-meeting`, `/meeting-that-writes-prd`, `/notes-vs-prd`, `/recap-vs-prd`, `/example-prd`.

## IndexNow

Key file already at `public/f080927f5b95483a90aea040615e1e49.txt`.

After deploy is live:

```bash
node scripts/indexnow-ping.mjs
```

## GSC — URLs to inspect / request indexing (parent in browser)

Paste into Google Search Console → URL Inspection → Request indexing (one at a time; no fake metrics):

1. `https://quantlys-meeting.com/`
2. `https://quantlys-meeting.com/sitemap.xml`
3. `https://quantlys-meeting.com/open-source-video-meeting`
4. `https://quantlys-meeting.com/memory-mode`
5. `https://quantlys-meeting.com/meeting-that-writes-prd` *(re-check)*
6. `https://quantlys-meeting.com/prd-from-meeting` *(re-check)*
7. `https://quantlys-meeting.com/notes-vs-prd`
8. `https://quantlys-meeting.com/recap-vs-prd`
9. `https://quantlys-meeting.com/example-prd`
10. `https://quantlys-meeting.com/robots.txt`

Also: Sitemaps → submit `https://quantlys-meeting.com/sitemap.xml` if not already.

## Live verification checklist (post-deploy)

- [ ] `/open-source-video-meeting` 200; `<title>` contains “Open-source video meeting”
- [ ] `/memory-mode` 200; `<title>` contains “Memory mode”
- [ ] Homepage shows Memory block + GitHub + v1.0.0-oss + quantlys.ai
- [ ] `robots.txt` Allows both new URLs; Disallows `/memory/`
- [ ] `sitemap.xml` lists both new URLs with lastmod ~2026-10-02
- [ ] `https://quantlys-meeting.com/f080927f5b95483a90aea040615e1e49.txt` returns the key
- [ ] IndexNow script returns 200/202
- [ ] OG: `/og.png` still resolves; Twitter card tags present

## Paste packs still needed (human only)

Canonical full pack: [`ANNOUNCE_DRAFT.md`](ANNOUNCE_DRAFT.md) · short: [`GO_VIRAL_PACK.md`](GO_VIRAL_PACK.md).

X / Facebook / WhatsApp: already posted — do not re-blast identical walls.

### LinkedIn (personal voice — paste when ready)

I open-sourced Quantlys Meeting.

I’m Santosh Adari. I built this as dogfood for Quantlys (https://www.quantlys.ai). Live product: quantlys-meeting.com. The MIT repo lets builders plug their own keys and run a white-label video stack.

• Browser meetings (LiveKit); guests from a link  
• Captions (Deepgram); auth/history (Supabase); S3 recordings  
• Session → markdown PRD/notes (OpenAI or OpenRouter)  
• Memory mode for podcasts, books, oral history  

Clone → .env.example → run. Conclave stays closed; Meeting ships compatible PRD rubrics + paste-handoff. No invented customer claims.

https://github.com/SantoshA1/quantlys-meet/releases/tag/v1.0.0-oss

#OpenSource #WebRTC #LiveKit #BuildInPublic

### Show HN

**Title:** Show HN: Quantlys Meeting – open-source video meetings that write a PRD (BYO LiveKit/Deepgram)

**First comment:**  
I’m Santosh. Quantlys Meeting is dogfood for Quantlys (quantlys.ai) — browser meetings on LiveKit, captions via Deepgram, auth/history on Supabase, recordings to S3. After a session the app can write a markdown PRD/notes with your OpenAI or OpenRouter key. Memory mode covers podcasts (chapters/clips), books, and oral history.

MIT, plug-your-own-keys. Live dogfood at quantlys-meeting.com. Quantlys Conclave isn’t in the repo — Conclave-compatible rubrics + paste-handoff only.

Repo: https://github.com/SantoshA1/quantlys-meet  
Tag: v1.0.0-oss

Happy to talk about the guest-join model, egress/self-host tradeoffs, or the PRD writer.

### Reddit — one sub at a time (author disclosure)

**r/opensource title:** Quantlys Meeting — MIT open-source browser video meetings that write a PRD (+ Memory mode for podcasts/stories)

**r/selfhosted title:** [Release] Quantlys Meeting — self-hostable browser meetings (LiveKit) + PRD/Memory writers (BYO keys)

Bodies: see ANNOUNCE_DRAFT.md (disclose authorship; no sockpuppet “I found this”).
