# PRD export: GitHub Issues, Linear, Jira, Notion

Open a PRD on the host console (or your own shared PRD link) and press **Export ▾**.

## Quick export (no setup)

| Button | What happens |
| --- | --- |
| Copy as Markdown / Download .md | The PRD as markdown. |
| New GitHub issue ↗ | Type `owner/repo`. Opens GitHub's new-issue form with the title and body filled in. Acceptance criteria become checkboxes. |
| New Linear issue ↗ | Opens `linear.app/new` with the title and description filled in. |
| Copy + open Jira ↗ | Type `yourteam.atlassian.net`. Copies the markdown and opens Jira's create dialog. Jira has no prefill URL that works across project types, so you paste it in. |
| Copy + open Notion ↗ | Copies the markdown and opens a new Notion page. Paste it, and Notion turns it into blocks. |

Links are capped at 8 KB. A longer PRD is cut at a line, with a link back to the full PRD: the shareable link if sharing is on, otherwise the host console.

## Direct push (your own credentials)

Shown only when the server has `INTEGRATIONS_ENCRYPTION_KEY` and the `20261019_integrations` migration.

| Service | Credential | Where it goes | What it creates |
| --- | --- | --- | --- |
| GitHub | Fine-grained personal access token, **Issues: Read and write** on the chosen repos | A repository | One PRD issue, plus one issue per user story with its criteria as `- [ ]` checklists. Stories are linked from the PRD issue and attached as sub-issues where supported. |
| Linear | Personal API key (Settings → Security & access) | A team | A PRD issue with one sub-issue per story. |
| Jira Cloud | Site URL, Atlassian email, API token (id.atlassian.com → Security) | A project | An Epic for the PRD and a Story per user story under it, with descriptions in Atlassian Document Format. |
| Notion | Internal integration token (notion.so/my-integrations). **Share the parent page with the integration.** | A parent page | One page with the PRD as headings, lists and to-dos. |

- **Preview** shows exactly what will be created or updated. Nothing is sent until you press **Push**.
- **Re-push** updates the same items. Item ids are stored per project and destination, so nothing is duplicated. Anything deleted on the other side is recreated. In Notion, a fresh page is written first, then the old one is moved to Notion's trash.
- Up to 25 stories per push. Stories are read from the PRD's "User stories" section, either as bullets (with criteria as nested bullets) or as `###` headings.
- **Disconnect & delete token** removes the stored credential.

## Security

- Tokens are sent to the server once, checked with the provider, and stored **encrypted** (AES-256-GCM, bound to your user and the provider). The browser only ever sees the last 4 characters.
- All provider calls happen server-side, to fixed hosts (`api.github.com`, `api.linear.app`, `api.notion.com`) and to your own `https://<name>.atlassian.net` site. Nothing else is accepted, and redirects are refused.
- Host only: every action needs sign-in, and the PRD is read from your own storage. RLS on both tables limits rows to their owner, and the browser can't read the ciphertext or write either table.

## Server setup

```bash
# 1. Database (Supabase SQL editor or psql). Safe to run twice.
supabase/migrations/20261019_integrations.sql

# 2. Encryption key: 32 random bytes
openssl rand -base64 32     # → set as INTEGRATIONS_ENCRYPTION_KEY, then redeploy
```

Keep the key stable and secret. Rotating it means every host has to reconnect.
