-- REAL VIEWER COUNT ("N ONLINE" under the player)
-- Every open playing screen sends a small "I'm here" message every 40 seconds. The number shown is how many different
-- browsers did that in the last 100 seconds. Closing the page removes the browser from the count at once.
-- Run this ONCE in the Supabase SQL editor. Safe to run again.

create unlogged table if not exists public.watch_sessions (
  id uuid primary key,
  last_seen timestamptz not null default now()
);
create index if not exists watch_sessions_seen_idx on public.watch_sessions(last_seen);

-- nobody reads or writes this table directly; only the two functions below touch it
alter table public.watch_sessions enable row level security;

create or replace function public.watch_heartbeat(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.watch_sessions(id, last_seen) values (p_id, now())
  on conflict (id) do update set last_seen = excluded.last_seen;

  -- housekeeping: every now and then remove browsers that left long ago
  if random() < 0.02 then
    delete from public.watch_sessions where last_seen < now() - interval '10 minutes';
  end if;

  select count(*)::integer into n from public.watch_sessions where last_seen > now() - interval '100 seconds';
  return n;
end;
$$;

create or replace function public.watch_leave(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.watch_sessions where id = p_id;
$$;

revoke all on function public.watch_heartbeat(uuid) from public;
revoke all on function public.watch_leave(uuid) from public;
grant execute on function public.watch_heartbeat(uuid) to anon, authenticated;
grant execute on function public.watch_leave(uuid) to anon, authenticated;
