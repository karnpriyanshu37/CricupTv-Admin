-- Blog posts for Cricup TV. Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- (The admin panel repo has a copy of this file too; running it twice is safe.)
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text not null,
  excerpt text,
  content text,
  cover_url text,
  author text,
  seo_description text,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Makes the slug (the post's web address) from the title when it is left empty, and sets the publish time.
create or replace function public.blog_posts_before_write() returns trigger language plpgsql as $$
declare base text; candidate text; n int := 1;
begin
  if new.slug is null or btrim(new.slug) = '' then
    base := regexp_replace(lower(coalesce(new.title, 'post')), '[^a-z0-9]+', '-', 'g');
    base := btrim(base, '-');
    if base = '' then base := 'post'; end if;
  else
    base := btrim(regexp_replace(lower(new.slug), '[^a-z0-9]+', '-', 'g'), '-');
    if base = '' then base := 'post'; end if;
  end if;
  base := left(base, 90);
  candidate := base;
  while exists (select 1 from public.blog_posts where slug = candidate and id <> new.id) loop
    n := n + 1; candidate := base || '-' || n;
  end loop;
  new.slug := candidate;
  if new.published and new.published_at is null then new.published_at := now(); end if;
  if not new.published then new.published_at := null; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists blog_posts_write on public.blog_posts;
create trigger blog_posts_write before insert or update on public.blog_posts
  for each row execute function public.blog_posts_before_write();

create index if not exists blog_posts_published_idx on public.blog_posts (published, published_at desc);

alter table public.blog_posts enable row level security;
drop policy if exists "blog public read" on public.blog_posts;
create policy "blog public read" on public.blog_posts for select
  using (published = true and published_at <= now());
drop policy if exists "blog admin all" on public.blog_posts;
create policy "blog admin all" on public.blog_posts for all
  using (public.is_admin()) with check (public.is_admin());
