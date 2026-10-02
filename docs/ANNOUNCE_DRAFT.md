# Announce drafts — do not post from automation

Copy-paste only. Intended for after the repo is public + LICENSE present.  
Do **not** auto-post to X or open the repo from bots — human paste only.

## X / Twitter thread

1/  
I’m Santosh (@SantoshAdari1). Quantlys Meeting is open source.

I built it as dogfood for Quantlys — https://www.quantlys.ai — our AI vertical platform. We run the live product at quantlys-meeting.com; this repo is so you can plug your own keys and run your own video stack.

2/  
What you get: browser meetings (LiveKit) + captions (Deepgram) + auth/history (Supabase) + S3-compatible recordings + a markdown PRD / notes / Memory chapters from the session (your OpenAI or OpenRouter key).

Guests join from a link. Hosts sign in. White-label on infrastructure you control.

3/  
Quantlys Conclave (and the rest of the platform) stays closed. Meeting ships Conclave-*compatible* PRD rubrics and honest paste-handoff — not a one-click Conclave API. No invented customer claims; this is my dogfood product, open for builders.

4/  
~10 minutes to a local smoke path:

git clone → cp .env.example .env.local → fill keys → npm i → npm run dev

Deploy-to-Vercel button is in the README. Self-hosted LiveKit SFU notes under /selfhost.

5/  
Repo: https://github.com/SantoshA1/quantlys-meet  

Built with Quantlys · Live: quantlys-meeting.com · Me: linkedin.com/in/santoshadari

## GitHub release blurb

**Quantlys Meeting — open for builders (Quantlys dogfood)**

I’m **Santosh Adari**. Quantlys Meeting is a dogfood product of **[Quantlys](https://www.quantlys.ai)** — an AI vertical platform. We use the live app at [quantlys-meeting.com](https://quantlys-meeting.com); this MIT repo lets companies plug their own keys and run their own meeting stack.

Browser video conferencing you can white-label: bring your own LiveKit, Deepgram, Supabase, OpenAI/OpenRouter, and S3-compatible storage. Guests join from a link; recorded sessions roll into a markdown PRD (plus notes, Memory chapters/clips).

- Quickstart and env template in the README / `.env.example`
- Self-hosted SFU path under `selfhost/` and `docs/SELF_HOST.md`
- Quantlys Conclave and other platform guts are **not** included — paste handoff only
- Maintainer: Santosh Adari ([GitHub](https://github.com/SantoshA1) · [LinkedIn](https://www.linkedin.com/in/santoshadari/) · [X](https://x.com/SantoshAdari1))

Clone, plug keys, run.
