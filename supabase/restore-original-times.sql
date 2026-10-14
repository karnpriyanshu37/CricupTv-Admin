-- Run ONCE in Supabase (SQL Editor). Puts match times back to exactly what the JSON feed gave.
-- It undoes the earlier time shifts that were applied by the SQL files (checked through site_settings flags):
--   shift-times-to-nepal.sql  (+5h45)   and   fix-times-to-nepal.sql (-6h, or -15min if the first was never run)
-- Only matches that are not FINISHED were touched by those files, so only those are moved.
do $$
declare applied interval := interval '0';
        s boolean; f boolean;
begin
  if exists (select 1 from public.site_settings where key = 'times_restored_original') then
    raise notice 'Already done, nothing changed.'; return;
  end if;
  s := exists (select 1 from public.site_settings where key = 'times_shifted_to_nepal');
  f := exists (select 1 from public.site_settings where key = 'times_fixed_nepal_v2');
  if s and f then applied := interval '-15 minutes';
  elsif s then applied := interval '5 hours 45 minutes';
  elsif f then applied := interval '-15 minutes';
  end if;
  if applied <> interval '0' then
    update public.matches
       set match_date = ((match_date + match_time) - applied)::date,
           match_time = ((match_date + match_time) - applied)::time
     where status <> 'FINISHED' and match_date is not null and match_time is not null;
  end if;
  insert into public.site_settings (key, value) values ('times_restored_original', now()::text)
    on conflict (key) do nothing;
  raise notice 'Done. Undid a shift of %', applied;
end $$;
