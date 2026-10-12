-- Global fixed-window rate limiter for costly API routes (audit 2026-10-12).
-- Adds ONE new table and ONE function. Touches nothing else in the project.
-- RLS on with no policies, and no grants to anon/authenticated: only the
-- service role (server routes) can read or call it.

create table if not exists public.rate_limits (
  key          text        primary key,           -- "<route>:<ip or user>"
  window_start timestamptz not null,
  count        integer     not null default 0
);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- Atomic hit: starts a new window when the old one has expired, otherwise
-- increments. Returns the count in the current window and when it resets.
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

-- Housekeeping: old windows are useless after they expire. Safe to run any time.
create or replace function public.rate_limits_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.rate_limits where window_start < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.rate_limits_prune() from public, anon, authenticated;
grant execute on function public.rate_limits_prune() to service_role;
