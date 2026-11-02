-- MESSAGE TO VIEWERS (shown in the middle of the playing screen, in real time)
-- Run this ONCE in the Supabase SQL editor. Safe to run again.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(trim(message)) between 1 and 500),
  button_label text check (button_label is null or length(button_label) <= 40),
  button_url text check (button_url is null or (button_url ~* '^https://' and length(button_url) <= 2048)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists announcements_active_idx on public.announcements(active, created_at desc);

alter table public.announcements enable row level security;

-- Everyone may READ messages (they are public by nature: they are shown to every viewer). Only admins may write.
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements for select using (true);
drop policy if exists "announcements admin write" on public.announcements;
create policy "announcements admin write" on public.announcements for all using (public.is_admin()) with check (public.is_admin());

-- Real time: viewers who are already watching get a new message (or its removal) at once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;
