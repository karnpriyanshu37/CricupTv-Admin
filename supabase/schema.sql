-- Youno TV: run this once in the Supabase SQL editor.

-- ---------- admins ----------
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- tables ----------
create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  image_url text,
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport_id uuid references public.sports(id) on delete set null,
  logo_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  sport_id uuid references public.sports(id) on delete set null,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  type text check (type in ('hls','dash')),
  url text check (url is null or (url ~* '^https?://' and length(url) <= 2048)),
  quality text,
  language text,
  enabled boolean not null default true,
  sort_order int not null default 0,
  drm jsonb,  -- optional, e.g. {"clearKeys": {"KID": "KEY"}}. Only owner-supplied credentials.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- safe to re-run against an older install that only had id/name/logo_url/created_at:
alter table public.channels add column if not exists type text check (type in ('hls','dash'));
alter table public.channels add column if not exists url text check (url is null or (url ~* '^https?://' and length(url) <= 2048));
alter table public.channels add column if not exists quality text;
alter table public.channels add column if not exists language text;
alter table public.channels add column if not exists enabled boolean not null default true;
alter table public.channels add column if not exists sort_order int not null default 0;
alter table public.channels add column if not exists drm jsonb;
alter table public.channels add column if not exists updated_at timestamptz not null default now();
alter table public.channels add column if not exists match_names text;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid references public.sports(id) on delete set null,
  competition_id uuid references public.competitions(id) on delete set null,
  team1_id uuid references public.teams(id) on delete restrict,
  team2_id uuid references public.teams(id) on delete restrict,
  title text,
  banner_url text,
  status text not null default 'UPCOMING' check (status in ('LIVE','UPCOMING','FINISHED')),
  match_date date,
  match_time time,
  stadium text,
  round text,
  broadcaster text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists matches_status_idx on public.matches(status, match_date);
alter table public.matches add column if not exists is_hot boolean not null default false;

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  name text not null,
  type text not null check (type in ('hls','dash')),
  url text not null check (url ~* '^https?://' and length(url) <= 2048),
  quality text,
  language text,
  enabled boolean not null default true,
  sort_order int not null default 0,
  player_slot smallint check (player_slot in (1,2)), -- optional player button slot on the watch page
  drm jsonb,  -- optional, e.g. {"clearKeys": {"KID": "KEY"}}. Only owner-supplied credentials.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.streams add column if not exists metadata jsonb;
create index if not exists streams_match_idx on public.streams(match_id, sort_order);

-- Channels a competition typically streams on. Add a match under that
-- competition and it automatically inherits these as streaming sources —
-- no need to re-enter the same stream URL for every match.
create table if not exists public.competition_channels (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  sort_order int not null default 0,
  player_slot smallint check (player_slot in (1,2)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (competition_id, channel_id)
);
alter table public.competition_channels add column if not exists player_slot smallint check (player_slot in (1,2));
create index if not exists competition_channels_comp_idx on public.competition_channels(competition_id, sort_order);

drop trigger if exists teams_updated on public.teams;
create trigger teams_updated before update on public.teams for each row execute function public.set_updated_at();
drop trigger if exists matches_updated on public.matches;
create trigger matches_updated before update on public.matches for each row execute function public.set_updated_at();
drop trigger if exists streams_updated on public.streams;
create trigger streams_updated before update on public.streams for each row execute function public.set_updated_at();
drop trigger if exists channels_updated on public.channels;
create trigger channels_updated before update on public.channels for each row execute function public.set_updated_at();


-- ---------- global site settings ----------
create table if not exists public.site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
drop trigger if exists site_settings_updated on public.site_settings;
create trigger site_settings_updated before update on public.site_settings for each row execute function public.set_updated_at();

-- ---------- row level security ----------
do $$
declare t text;
begin
  foreach t in array array['sports','competitions','teams','channels','matches','streams','competition_channels','site_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format('create policy "admin write" on public.%I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- Public can read everything except streams and channels (URLs / DRM stay
  -- server-side, read with the service role key, or admin-only in the browser).
  foreach t in array array['sports','competitions','teams','matches'] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
  end loop;
  -- In case this is re-run against an older install where channels used to be public:
  execute 'drop policy if exists "public read" on public.channels';
  drop policy if exists "public read whatsapp setting" on public.site_settings;
  create policy "public read whatsapp setting" on public.site_settings for select using (key = 'whatsapp_channel_url');
end $$;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('youno-tv-images', 'youno-tv-images', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "youno images public read" on storage.objects;
create policy "youno images public read" on storage.objects for select using (bucket_id = 'youno-tv-images');
drop policy if exists "youno images admin insert" on storage.objects;
create policy "youno images admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'youno-tv-images' and public.is_admin());
drop policy if exists "youno images admin update" on storage.objects;
create policy "youno images admin update" on storage.objects for update to authenticated using (bucket_id = 'youno-tv-images' and public.is_admin());
drop policy if exists "youno images admin delete" on storage.objects;
create policy "youno images admin delete" on storage.objects for delete to authenticated using (bucket_id = 'youno-tv-images' and public.is_admin());

-- ---------- first admin ----------
-- 1) Create a user in Supabase Auth > Users (email + password).
-- 2) Then run (with that email):
-- insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
