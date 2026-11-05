-- Run this ONCE in the Supabase SQL editor (if you already ran announcements.sql before): adds the "cross after N seconds" setting.
alter table public.announcements add column if not exists close_after_seconds integer not null default 2;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_close_after_seconds_chk') then
    alter table public.announcements add constraint announcements_close_after_seconds_chk check (close_after_seconds between 0 and 300);
  end if;
end $$;
