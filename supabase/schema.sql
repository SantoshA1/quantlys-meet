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
