-- ONE TEAM ROW PER SIDE
-- A match must never have the same team row on both sides (team1_id = team2_id): editing the name or logo of one side
-- would then change the other side too. Run this ONCE in the Supabase SQL editor. Safe to run again.

-- 1) Fix every match that already has the same team row on both sides: Team 2 gets its own copy of the row.
do $$
declare
  r record;
  new_id uuid;
begin
  for r in select id, team2_id from public.matches where team1_id is not null and team1_id = team2_id loop
    insert into public.teams (name, short_name, sport_id, logo_url)
      select name, short_name, sport_id, logo_url from public.teams where id = r.team2_id
      returning id into new_id;
    update public.matches set team2_id = new_id where id = r.id;
  end loop;
end $$;

-- 2) From now on this can not happen again (import, cron, the match form or SQL): the second side is copied automatically.
create or replace function public.match_two_team_rows() returns trigger
language plpgsql as $fn$
declare
  new_id uuid;
begin
  if new.team1_id is not null and new.team1_id = new.team2_id then
    insert into public.teams (name, short_name, sport_id, logo_url)
      select name, short_name, sport_id, logo_url from public.teams where id = new.team2_id
      returning id into new_id;
    new.team2_id := new_id;
  end if;
  return new;
end
$fn$;

drop trigger if exists matches_two_team_rows on public.matches;
create trigger matches_two_team_rows
before insert or update of team1_id, team2_id on public.matches
for each row execute function public.match_two_team_rows();
