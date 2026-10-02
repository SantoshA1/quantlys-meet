# Announce drafts — do not post from automation

Copy-paste only. Intended for tomorrow’s announce (after repo is public + LICENSE present).

## X / Twitter thread

1/  
Quantlys Meeting is open. Clone it, plug your own keys, run your own meeting stack.

LiveKit + Deepgram + Supabase + your model key + S3-compatible storage. White-label video that writes a markdown PRD from the session.

2/  
Guests join from a link. Hosts sign in. Recordings, captions, notes, Memory chapters — on infrastructure you control.

We dogfood this as Quantlys Meeting. The Quantlys Conclave platform stays separate and closed. This repo is the meeting product builders can self-host.

3/  
~10 minutes to a local smoke path:

git clone → cp .env.example .env.local → fill keys → npm i → npm run dev

Deploy button for Vercel is in the README. Self-hosted LiveKit SFU notes under /selfhost.

4/  
Repo: https://github.com/SantoshA1/quantlys-meet  

Built with Quantlys — https://www.quantlys.ai

## GitHub release blurb

**Quantlys Meeting — open for builders**

Browser video conferencing you can white-label: bring your own LiveKit, Deepgram, Supabase, OpenAI/OpenRouter, and S3-compatible storage. Guests join from a link; recorded sessions roll into a markdown PRD (plus notes, Memory chapters/clips).

- Quickstart and env template in the README / `.env.example`
- Self-hosted SFU path under `selfhost/` and `docs/SELF_HOST.md`
- Quantlys Conclave and other platform guts are **not** included — paste handoff only

Clone, plug keys, run.
