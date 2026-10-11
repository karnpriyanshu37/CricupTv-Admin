# Youno TV Admin

Standalone content-management app for Youno TV, separate from the public site
(`youno-tv/`). Deploy it on its own (e.g. a private URL or subdomain like
`admin.younotv.example`) so the admin UI isn't bundled into the public site's
JavaScript at all.

Both apps talk to the **same Supabase project**; run `supabase/schema.sql`
(and optionally `supabase/seed.sql`) once, from either project — they're
identical copies. Already ran it before on an older version? It's safe to
just run the whole file again — every statement is written to skip anything
that already exists and only add what's new (e.g. the Channels stream
fields and Channel mapping table added later).

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

## Connect Supabase

1. In your Supabase project's SQL editor, run `supabase/schema.sql`, then
   optionally `supabase/seed.sql`.
2. Auth > Users: create your admin user, then run:
   `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
3. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the same two values used by the
   public site's `.env.local`.
4. Open the app, sign in, and manage sports, teams, competitions, channels,
   matches and streams. A stream's Name and Quality fields here are shown
   verbatim on the public site's match and watch pages — there's no limit
   on how many streams a match can have.

## Channels, Channel mapping, and quick-add

- **Channels** (tab): a reusable streaming source — name, logo, and its stream URL/type/
  quality/language. Not tied to any one match. If the URL's extension doesn't match the chosen
  type (e.g. a `.m3u8` link with type set to DASH), saving asks you to confirm before continuing
  — the type you pick is what the player actually uses, so it's worth double-checking here if a
  stream won't play.
- **Channel mapping** (tab): attach channels to a Competition once. Every match you create
  under that competition automatically shows those channels as streaming sources on the
  public site — no need to re-add the same stream URL for every match in a league.
- **Match streams** (tab): only for something extra or match-specific that isn't already
  covered by the competition's channels (e.g. a one-off commentary feed).
- **Quick-add**: in the New/Edit Match form, the Team 1 / Team 2 / Competition dropdowns have
  a "+ New …" button that creates the row right there (name, and a logo for teams/competitions)
  without leaving the match form, then selects it automatically.
- **Image crop**: every logo/banner upload opens a crop step first (drag to reposition, slider
  to zoom) — square for logos, 16:9 for match banners — before it's uploaded.

## Security model

This app only ever uses the public **anon key** — never the service role
key, so there's nothing secret to leak even if this app is deployed openly.
All access control is enforced by Supabase Row Level Security: only accounts
listed in the `admins` table can write, upload or delete anything. Everyone
else (including a signed-in, non-admin account) gets read-only access or
less, exactly as the public site does.

## Relationship to the public site

- `youno-tv/` (the public site) reads match/team/sport data with the anon
  key, and reads stream URLs + DRM config server-side with the service role
  key (`SUPABASE_SERVICE_ROLE_KEY`) — never exposed to the browser.
- `youno-tv-admin/` (this app) never needs the service role key: every
  write goes through the anon key and is checked by RLS.
- You can deploy this app to a different host, a different domain, or not
  publish it at all (run it locally only) — the public site keeps working
  either way.

## Cricup TV additions

- Website Settings stores the WhatsApp channel URL in `site_settings` under `whatsapp_channel_url`.
- Match Streams supports player slots `Stream 1` and `Stream 2`.
- Competition Channel Mapping can also assign player slots for reusable channels.
- ClearKey input accepts the normal `{"clearKeys":{"KID":"KEY"}}` form and `KID:KEY` shorthand. Only ClearKey values supplied by the authorized stream owner should be used.
- Re-run `supabase/schema.sql` after updating to add the new settings/player-slot fields.


## Hourly auto-import from GitHub

Three feeds are imported by themselves every hour: the main sports feed (`SPORTS_FEED_URL`), Tapmad (`TAPMAD_FEED_URL`) and SonyLIV (`SONYLIV_FEED_URL`); defaults are the sm-monirulislam repositories. A match that exists in more than one feed gets one card with all the links; a match only Tapmad/SonyLIV has gets its own card. Single feed by hand: `/api/cron/import?feed=main|tapmad|sonyliv`.
Matches that already exist are not duplicated; only their streaming links / channels are added or changed.

1. In the admin's **Vercel project** > Settings > Environment Variables add: `CRON_SECRET` (long random text),
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API > service_role), optional `SPORTS_FEED_URL`. Redeploy.
2. In this **GitHub repository** > Settings > Secrets and variables > Actions > New repository secret add:
   `IMPORT_URL` (the admin address, e.g. `https://your-admin.vercel.app`, no `/` at the end) and `CRON_SECRET` (same text as in Vercel).
3. GitHub > Actions > "Hourly sports import" > Run workflow to test it. After that it runs every hour by itself.

Test by hand: `curl -X POST https://your-admin.vercel.app/api/cron/import -H "Authorization: Bearer YOUR_CRON_SECRET"`.
