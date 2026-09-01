-- meetings + participants (Phase 1)
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text default 'default',          -- latent, preserves resale option
  room_name text unique not null,
  title text not null,
  created_by uuid references auth.users(id),
  active boolean default true,
  started_at timestamptz default now(),
  ended_at timestamptz
);
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  user_id uuid references auth.users(id),        -- null for guests
  livekit_identity text not null,
  display_name text not null,
  is_guest boolean default false,
  joined_at timestamptz default now(), left_at timestamptz
);

-- recordings + tracks + transcripts (Phase 3/4)
create table if not exists recordings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  room_name text not null, egress_id text,
  status text default 'recording',
  storage_prefix text, duration_s int,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
create table if not exists recording_tracks (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references recordings(id) on delete cascade,
  egress_id text not null, participant_identity text not null,
  display_name text not null, storage_key text not null,
  transcribed boolean default false
);
create table if not exists transcripts (
  id bigserial primary key,
  recording_id uuid references recordings(id) on delete cascade,
  participant_identity text, speaker_name text,
  ts_start real not null, ts_end real not null, text_original text not null
);

-- pending straggler approvals (Phase 6)
create table if not exists pending_admissions (
  id uuid primary key default gen_random_uuid(),
  room_name text not null, display_name text not null,
  requested_at timestamptz default now(),
  status text default 'pending'                  -- pending | admitted | denied
);

alter table meetings enable row level security;
alter table recordings enable row level security;
alter table recording_tracks enable row level security;
alter table transcripts enable row level security;
alter table pending_admissions enable row level security;

create policy "own meetings insert" on meetings for insert with check (auth.uid() = created_by);
create policy "own meetings update" on meetings for update using (auth.uid() = created_by);
create policy "active meetings visible" on meetings for select using (active = true or auth.uid() = created_by);

-- Phase 6 reversal: ATTENDEES + creator replay (not whole domain)
create policy "attendees replay" on recordings for select using (
  exists (select 1 from meetings m where m.id = recordings.meeting_id and m.created_by = auth.uid())
  or exists (select 1 from participants p where p.meeting_id = recordings.meeting_id and p.user_id = auth.uid())
);
create policy "attendees read tracks" on recording_tracks for select using (
  exists (select 1 from recordings r join meetings m on m.id=r.meeting_id
          where r.id=recording_tracks.recording_id and m.created_by=auth.uid())
  or exists (select 1 from recordings r join participants p on p.meeting_id=r.meeting_id
             where r.id=recording_tracks.recording_id and p.user_id=auth.uid())
);
create policy "attendees read transcripts" on transcripts for select using (
  exists (select 1 from recordings r join meetings m on m.id=r.meeting_id
          where r.id=transcripts.recording_id and m.created_by=auth.uid())
  or exists (select 1 from recordings r join participants p on p.meeting_id=r.meeting_id
             where r.id=transcripts.recording_id and p.user_id=auth.uid())
);

-- Host controls (2026-08-17). A locked meeting stops the link letting new
-- people in — the small version of a waiting room, with nobody left standing
-- outside. Existing meetings default to unlocked, so nothing changes until a
-- host presses the button.
alter table meetings add column if not exists locked boolean default false;

-- Waiting room (2026-08-18). The `locked` flag above is the cheap version: it
-- turns the link off and anybody who arrives after that is told to go away by
-- a machine, with no way to appeal to the human twenty feet away. A waiting
-- room is the opposite bargain — the door is never open to strangers AND
-- nobody who belongs is ever turned away, because a person decides.
alter table meetings add column if not exists waiting_room boolean default false;

-- pending_admissions already exists (Phase 6) and was never wired to anything.
-- These are what make it usable as a queue.
alter table pending_admissions add column if not exists decided_at timestamptz;
create index if not exists pending_admissions_room_idx
  on pending_admissions (room_name, status, requested_at);


-- Email the spec (optional, off by default). Guests request; the host
-- approves; one mail goes out when End finishes and a PRD exists. Delete
-- never sends. Service-role API routes enforce who may toggle / request;
-- guests are not signed in, so RLS here matches pending_admissions: on,
-- and the route is the door.
alter table meetings add column if not exists spec_email_on boolean default false;
alter table meetings add column if not exists spec_email_host_copy boolean default true;
alter table meetings add column if not exists spec_email_host_address text;
alter table meetings add column if not exists spec_email_sent_at timestamptz;

create table if not exists spec_email_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  email text not null,
  display_name text,
  status text default 'pending',          -- pending | approved | denied | unsubscribed
  requested_at timestamptz default now(),
  decided_at timestamptz
);
create unique index if not exists spec_email_requests_meeting_email
  on spec_email_requests (meeting_id, lower(email));
create index if not exists spec_email_requests_meeting_status
  on spec_email_requests (meeting_id, status, requested_at);

alter table spec_email_requests enable row level security;
