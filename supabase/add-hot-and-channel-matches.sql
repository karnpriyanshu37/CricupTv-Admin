-- Run ONCE in the Supabase SQL editor (safe to run again).
-- 1) "HOT match" switch (Admin > Matches) used for the HOT badge + first position on the website.
alter table public.matches add column if not exists is_hot boolean not null default false;
create index if not exists matches_hot_idx on public.matches(is_hot) where is_hot;

-- 2) Channels: list of matches (one per line, e.g. "India vs West Indies") the channel is auto-added to
--    when the JSON import brings that match.
alter table public.channels add column if not exists match_names text;

-- 3) Needed for auto-added streams (usually already there).
alter table public.streams add column if not exists metadata jsonb;
