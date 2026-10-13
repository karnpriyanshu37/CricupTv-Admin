-- Run this ONCE in Supabase (SQL Editor), right after the new admin version is live.
-- Before this change the importer saved the feeds' UTC times as they were. From now on it saves Nepal time (UTC+5:45).
-- This moves the matches that are still saved in UTC (live and upcoming ones) forward by 5 hours 45 minutes.
-- Finished matches are left alone. It protects itself: a second run does nothing.
-- If you typed some match times by hand in Nepal time before today, correct those few in the Admin afterwards.
do $$
begin
  if exists (select 1 from public.site_settings where key = 'times_shifted_to_nepal') then
    raise notice 'Already done earlier. Nothing changed.';
    return;
  end if;

  update public.matches
  set match_date = ((match_date + match_time) + interval '5 hours 45 minutes')::date,
      match_time = ((match_date + match_time) + interval '5 hours 45 minutes')::time
  where status <> 'FINISHED' and match_date is not null and match_time is not null;

  insert into public.site_settings (key, value) values ('times_shifted_to_nepal', now()::text);
  raise notice 'Done: live and upcoming match times moved to Nepal time.';
end $$;
