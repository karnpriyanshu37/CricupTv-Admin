-- SHARE MESSAGE (the text WhatsApp opens with when a viewer taps "Share" on the playing screen)
-- Run this ONCE in the Supabase SQL editor. Safe to run again.

-- The public site may read the share message (the same way it reads the WhatsApp channel link).
drop policy if exists "site settings public read" on public.site_settings;
create policy "site settings public read" on public.site_settings
  for select using (key in ('whatsapp_channel_url', 'share_message'));

insert into public.site_settings (key, value)
values ('share_message', '')
on conflict (key) do nothing;
