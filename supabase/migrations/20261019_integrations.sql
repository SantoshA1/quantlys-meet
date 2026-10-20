-- PRD export integrations (v1.2.0): GitHub Issues, Linear, Jira Cloud, Notion.
-- Adds TWO new tables. Touches nothing else in the project. Safe to run twice.
--
-- integration_credentials: one row per host per provider. `secret` is
--   AES-256-GCM ciphertext made with INTEGRATIONS_ENCRYPTION_KEY (server env),
--   bound to (user_id, provider); the database never sees a plaintext token.
--   Only the server (service role) writes it. A host may read their own rows'
--   metadata and delete them; the ciphertext column is not granted to clients.
-- integration_exports: which external item each PRD part became, so a
--   re-push updates instead of duplicating. Host may read and delete own rows.

create table if not exists public.integration_credentials (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  provider      text        not null check (provider in ('github','linear','jira','notion')),
  secret        text        not null,
  hint          text,
  account_label text,
  site          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.integration_exports (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  project_slug text        not null,
  provider     text        not null check (provider in ('github','linear','jira','notion')),
  target       text        not null,
  item_key     text        not null,
  external_id  text        not null,
  external_url text,
  title        text,
  updated_at   timestamptz not null default now(),
  primary key (user_id, project_slug, provider, target, item_key)
);

alter table public.integration_credentials enable row level security;
alter table public.integration_exports enable row level security;

-- Clients never write these; the server does, with the service role.
revoke all on table public.integration_credentials from anon, authenticated;
revoke all on table public.integration_exports from anon, authenticated;
grant select (user_id, provider, hint, account_label, site, created_at, updated_at), delete
  on table public.integration_credentials to authenticated;
grant select, delete on table public.integration_exports to authenticated;

drop policy if exists "own integration credentials read" on public.integration_credentials;
create policy "own integration credentials read" on public.integration_credentials
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own integration credentials delete" on public.integration_credentials;
create policy "own integration credentials delete" on public.integration_credentials
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "own integration exports read" on public.integration_exports;
create policy "own integration exports read" on public.integration_exports
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own integration exports delete" on public.integration_exports;
create policy "own integration exports delete" on public.integration_exports
  for delete to authenticated using (auth.uid() = user_id);

-- PostgREST picks up the new tables without a restart.
notify pgrst, 'reload schema';
