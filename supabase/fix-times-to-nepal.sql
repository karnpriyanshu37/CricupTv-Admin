-- Run this ONCE in Supabase (SQL Editor), BEFORE you push the new admin version (v20).
-- Why: the JSON feeds are in Bangladesh time (UTC+6), not UTC. Nepal time is 15 minutes behind it.
-- The earlier version wrongly added 5 hours 45 minutes to the live and upcoming matches.
--   If you already ran "shift-times-to-nepal.sql": this moves those matches back by 6 hours (5h45m + 15m) = correct Nepal time.
--   If you never ran it: this moves them back by 15 minutes only.
-- Finished matches are left alone. A second run does nothing.
do $$
declare delta interval;
begin
  if exists (select 1 from public.site_settings where key = 'times_fixed_nepal_v2') then
    raise notice 'Already done earlier. Nothing changed.';
    return;
  end if;

  if exists (select 1 from public.site_settings where key = 'times_shifted_to_nepal') then
    delta := interval '6 hours';
  else
    delta := interval '15 minutes';
  end if;

  update public.matches
  set match_date = ((match_date + match_time) - delta)::date,
      match_time = ((match_date + match_time) - delta)::time
  where status <> 'FINISHED' and match_date is not null and match_time is not null;

  insert into public.site_settings (key, value) values ('times_fixed_nepal_v2', now()::text);
  raise notice 'Done: moved live and upcoming match times back by %.', delta;
end $$;
