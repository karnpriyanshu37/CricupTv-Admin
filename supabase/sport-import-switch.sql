-- Run ONCE in Supabase (SQL Editor). Adds the switch "Create match cards for this sport" (Admin > Sports).
alter table public.sports add column if not exists import_enabled boolean not null default true;
