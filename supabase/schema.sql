-- =============================================================================
-- Quantlys Meeting: complete database + storage setup for a NEW Supabase project.
--
-- Paste this whole file into Supabase -> SQL Editor and press Run. That's it.
-- It creates every table, column, index, function, RLS policy and the private
-- `recordings` storage bucket the app reads and writes.
--
-- Idempotent: safe to run again (and safe to run on an older self-host to fill
-- in what's missing). Tables/columns/indexes use IF NOT EXISTS, the bucket uses
-- ON CONFLICT DO NOTHING, and policies/functions are only created when absent,
-- so a re-run never drops or rewrites anything you've customised.
--
-- Access model (matches the code):
--   * Browser (anon key + the host's session) touches: meetings (own rows),
--     action_items (own rows), the meeting_by_code() lookup, and storage
--     objects under `recordings/<auth.uid()>/...`.
--   * Everything else goes through Next.js API routes with the service role,
--     which bypasses RLS. Those tables have RLS ON and no browser policies.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid() (built in on PG13+, harmless)

-- Helper used below: create a policy only if one with that name doesn't exist.
-- (CREATE POLICY has no IF NOT EXISTS.)
create or replace function pg_temp.ensure_policy(p_schema text, p_table text, p_name text, p_sql text)
returns void language plpgsql as $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = p_schema and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- meetings
-- -----------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text default 'default',
  room_name text unique not null,
  title text not null,
  created_by uuid references auth.users(id),
  active boolean default true,
  started_at timestamptz default now(),
  ended_at timestamptz
);
-- Host controls: lock + waiting room.
alter table public.meetings add column if not exists locked boolean default false;
alter table public.meetings add column if not exists waiting_room boolean default false;
-- Scheduling, projects and invites (host console, calendar invites, digest).
alter table public.meetings add column if not exists scheduled_at timestamptz;
alter table public.meetings add column if not exists project text;
alter table public.meetings add column if not exists invited text[];
alter table public.meetings add column if not exists invite_seq integer default 0;
alter table public.meetings add column if not exists invited_at timestamptz;
-- Email the spec (optional, off by default).
alter table public.meetings add column if not exists spec_email_on boolean default false;
alter table public.meetings add column if not exists spec_email_host_copy boolean default true;
alter table public.meetings add column if not exists spec_email_host_address text;
alter table public.meetings add column if not exists spec_email_sent_at timestamptz;

comment on column public.meetings.invited is 'Addresses this meeting has been sent to (lower-cased, de-duplicated).';
comment on column public.meetings.invite_seq is 'RFC 5545 SEQUENCE: bumped per re-send so calendars replace rather than duplicate.';

create index if not exists meetings_created_by_started_idx on public.meetings (created_by, started_at desc);

-- -----------------------------------------------------------------------------
-- participants (kept for the recordings policies below; written by egress paths)
-- -----------------------------------------------------------------------------
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id),        -- null for guests
  livekit_identity text not null,
  display_name text not null,
  is_guest boolean default false,
  joined_at timestamptz default now(),
  left_at timestamptz
);

-- -----------------------------------------------------------------------------
-- recordings + tracks + transcripts (LiveKit Egress bookkeeping; the in-browser
-- recorder writes files to the `recordings` storage bucket instead)
-- -----------------------------------------------------------------------------
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  room_name text not null,
  egress_id text,
  status text default 'recording',
  storage_prefix text,
  duration_s int,
  created_at timestamptz default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
alter table public.recordings alter column expires_at set default (now() + interval '90 days');
create index if not exists recordings_room_idx on public.recordings (room_name);
create index if not exists recordings_expires_idx on public.recordings (expires_at);

create table if not exists public.recording_tracks (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings(id) on delete cascade,
  egress_id text not null,
  participant_identity text not null,
  display_name text not null,
  storage_key text not null,
  transcribed boolean default false
);
create table if not exists public.transcripts (
  id bigserial primary key,
  recording_id uuid references public.recordings(id) on delete cascade,
  participant_identity text,
  speaker_name text,
  ts_start real not null,
  ts_end real not null,
  text_original text not null
);

-- -----------------------------------------------------------------------------
-- pending_admissions (waiting room queue; API routes only)
-- -----------------------------------------------------------------------------
create table if not exists public.pending_admissions (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  display_name text not null,
  requested_at timestamptz default now(),
  status text default 'pending'                  -- pending | admitted | denied
);
alter table public.pending_admissions add column if not exists decided_at timestamptz;
create index if not exists pending_admissions_room_idx
  on public.pending_admissions (room_name, status, requested_at);

-- -----------------------------------------------------------------------------
-- spec_email_requests (Email the spec; API routes only)
-- -----------------------------------------------------------------------------
create table if not exists public.spec_email_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  email text not null,
  display_name text,
  status text default 'pending',          -- pending | approved | denied | unsubscribed
  requested_at timestamptz default now(),
  decided_at timestamptz
);
create unique index if not exists spec_email_requests_meeting_email
  on public.spec_email_requests (meeting_id, lower(email));
create index if not exists spec_email_requests_meeting_status
  on public.spec_email_requests (meeting_id, status, requested_at);

-- -----------------------------------------------------------------------------
-- action_items (the cross-meeting action queue + Monday weekly digest)
-- Written by /api/recording/finish (service role, upsert on
-- user_id,room_name,fingerprint). Read + ticked off by the host in the browser.
-- -----------------------------------------------------------------------------
create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  room_name text not null,
  project text,
  meeting_title text,
  text text not null,
  fingerprint text not null,
  owner text,
  ts_seconds integer,
  video_path text,
  status text not null default 'open',          -- open | done
  met_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index if not exists action_items_user_room_fingerprint
  on public.action_items (user_id, room_name, fingerprint);
create index if not exists action_items_user_status_met
  on public.action_items (user_id, status, met_at desc);
create index if not exists action_items_room_idx on public.action_items (room_name);

-- -----------------------------------------------------------------------------
-- rate_limits + rate_limit_hit() (global limiter for costly API routes)
-- Same as supabase/migrations/20261012_rate_limits.sql. Service role only.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key          text        primary key,           -- "<route>:<ip or user>"
  window_start timestamptz not null,
  count        integer     not null default 0
);
revoke all on table public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_window_ms integer)
returns table (hits integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window interval    := make_interval(secs => p_window_ms / 1000.0);
begin
  return query
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set window_start = case when r.window_start + v_window <= v_now then v_now else r.window_start end,
        count        = case when r.window_start + v_window <= v_now then 1 else r.count + 1 end
  returning r.count, r.window_start + v_window;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;

create or replace function public.rate_limits_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.rate_limits where window_start < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.rate_limits_prune() from public, anon, authenticated;
grant execute on function public.rate_limits_prune() to service_role;

-- -----------------------------------------------------------------------------
-- meeting_by_code(code): the guest "paste a link or code" lookup and the
-- room's title / "starts at" banner. Returns only public-safe fields of a
-- running meeting, so guests never need SELECT on the meetings table.
-- Created only if absent, so an existing definition is left alone.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'meeting_by_code'
  ) then
    execute $f$
      create function public.meeting_by_code(code text)
      returns table (room_name text, title text, scheduled_at timestamptz)
      language sql stable security definer set search_path = public as $b$
        select m.room_name, m.title, m.scheduled_at
        from public.meetings m
        where m.room_name = trim(code) and m.active is true
        limit 1
      $b$;
    $f$;
    execute 'revoke all on function public.meeting_by_code(text) from public';
    execute 'grant execute on function public.meeting_by_code(text) to anon, authenticated, service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.meetings            enable row level security;
alter table public.participants        enable row level security;
alter table public.recordings          enable row level security;
alter table public.recording_tracks    enable row level security;
alter table public.transcripts         enable row level security;
alter table public.pending_admissions  enable row level security;
alter table public.spec_email_requests enable row level security;
alter table public.action_items        enable row level security;
alter table public.rate_limits         enable row level security;

-- meetings: a signed-in host creates, reads and updates only their own rows.
-- Guests look a room up through meeting_by_code(); room tokens, lock, waiting
-- room and delete are checked server-side with the service role.
select pg_temp.ensure_policy('public','meetings','own meetings insert',
  $p$create policy "own meetings insert" on public.meetings for insert to authenticated
     with check (auth.uid() = created_by)$p$);
select pg_temp.ensure_policy('public','meetings','own meetings update',
  $p$create policy "own meetings update" on public.meetings for update to authenticated
     using (auth.uid() = created_by) with check (auth.uid() = created_by)$p$);
select pg_temp.ensure_policy('public','meetings','own meetings select',
  $p$create policy "own meetings select" on public.meetings for select to authenticated
     using (auth.uid() = created_by)$p$);

-- action_items: the host reads and ticks off their own items.
select pg_temp.ensure_policy('public','action_items','own action items select',
  $p$create policy "own action items select" on public.action_items for select to authenticated
     using (auth.uid() = user_id)$p$);
select pg_temp.ensure_policy('public','action_items','own action items update',
  $p$create policy "own action items update" on public.action_items for update to authenticated
     using (auth.uid() = user_id) with check (auth.uid() = user_id)$p$);

-- recordings / tracks / transcripts: creator + signed-in attendees may read.
select pg_temp.ensure_policy('public','recordings','attendees replay',
  $p$create policy "attendees replay" on public.recordings for select using (
     exists (select 1 from public.meetings m where m.id = recordings.meeting_id and m.created_by = auth.uid())
     or exists (select 1 from public.participants p where p.meeting_id = recordings.meeting_id and p.user_id = auth.uid())
   )$p$);
select pg_temp.ensure_policy('public','recording_tracks','attendees read tracks',
  $p$create policy "attendees read tracks" on public.recording_tracks for select using (
     exists (select 1 from public.recordings r join public.meetings m on m.id = r.meeting_id
             where r.id = recording_tracks.recording_id and m.created_by = auth.uid())
     or exists (select 1 from public.recordings r join public.participants p on p.meeting_id = r.meeting_id
                where r.id = recording_tracks.recording_id and p.user_id = auth.uid())
   )$p$);
select pg_temp.ensure_policy('public','transcripts','attendees read transcripts',
  $p$create policy "attendees read transcripts" on public.transcripts for select using (
     exists (select 1 from public.recordings r join public.meetings m on m.id = r.meeting_id
             where r.id = transcripts.recording_id and m.created_by = auth.uid())
     or exists (select 1 from public.recordings r join public.participants p on p.meeting_id = r.meeting_id
                where r.id = transcripts.recording_id and p.user_id = auth.uid())
   )$p$);
-- participants, pending_admissions, spec_email_requests, rate_limits:
-- RLS on, no browser policies. The API routes (service role) are the door.

-- -----------------------------------------------------------------------------
-- Storage: private `recordings` bucket.
-- The host's browser uploads takes to `<auth.uid()>/<room>/<stamp>.*` (one-shot
-- or resumable/TUS), lists, downloads, signs URLs for and deletes files under
-- its own folder. Server routes use the service role.
-- file_size_limit NULL = use the project-wide limit (Storage -> Settings).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

select pg_temp.ensure_policy('storage','objects','recordings: owner read',
  $p$create policy "recordings: owner read" on storage.objects for select to authenticated
     using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)$p$);
select pg_temp.ensure_policy('storage','objects','recordings: owner insert',
  $p$create policy "recordings: owner insert" on storage.objects for insert to authenticated
     with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)$p$);
select pg_temp.ensure_policy('storage','objects','recordings: owner update',
  $p$create policy "recordings: owner update" on storage.objects for update to authenticated
     using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
     with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)$p$);
select pg_temp.ensure_policy('storage','objects','recordings: owner delete',
  $p$create policy "recordings: owner delete" on storage.objects for delete to authenticated
     using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)$p$);

-- ─────────────────────────────────────────────────────────────────────
-- PRD export integrations (v1.2.0) — same as supabase/migrations/20261019_integrations.sql
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

select pg_temp.ensure_policy('public','integration_credentials','own integration credentials read',
  $p$create policy "own integration credentials read" on public.integration_credentials
  for select to authenticated using (auth.uid() = user_id)$p$);
select pg_temp.ensure_policy('public','integration_credentials','own integration credentials delete',
  $p$create policy "own integration credentials delete" on public.integration_credentials
  for delete to authenticated using (auth.uid() = user_id)$p$);

select pg_temp.ensure_policy('public','integration_exports','own integration exports read',
  $p$create policy "own integration exports read" on public.integration_exports
  for select to authenticated using (auth.uid() = user_id)$p$);
select pg_temp.ensure_policy('public','integration_exports','own integration exports delete',
  $p$create policy "own integration exports delete" on public.integration_exports
  for delete to authenticated using (auth.uid() = user_id)$p$);

-- Make the new tables visible to the API right away.
notify pgrst, 'reload schema';
