"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";
import EntityAdmin, { type EntityConfig, type Field } from "./EntityAdmin";
import StreamsAdmin from "./StreamsAdmin";
import SiteSettings from "./SiteSettings";
import JsonImport from "./JsonImport";

type Opt = { value: string; label: string; sportId?: string | null };
const STATUS: Opt[] = [{ value: "UPCOMING", label: "Upcoming" }, { value: "LIVE", label: "Live" }, { value: "FINISHED", label: "Finished" }];
const STREAM_TYPE: Opt[] = [{ value: "hls", label: "HLS (.m3u8)" }, { value: "dash", label: "DASH (.mpd)" }];

// Minimal forms offered by the "+ New Team" / "+ New Competition" quick-add
// popovers inside the Match form, so you never have to leave it mid-flow.
const TEAM_QUICK_FIELDS: Field[] = [
  { key: "name", label: "Team name", type: "text", required: true },
  { key: "short_name", label: "Short name", type: "text", maxLength: 6 },
  { key: "logo_url", label: "Team logo", type: "image", folder: "teams" },
];
const COMPETITION_QUICK_FIELDS: Field[] = [
  { key: "name", label: "Competition name", type: "text", required: true },
  { key: "logo_url", label: "Competition logo", type: "image", folder: "competitions" },
];

const CONFIGS: Record<string, EntityConfig> = {
  matches: {
    table: "matches", title: "Matches", orderBy: "match_date",
    label: (r) => r.title || `Match ${String(r.id).slice(0, 6)}`,
    sub: (r) => `${r.is_hot ? "🔥 HOT · " : ""}${r.match_date ?? "no date"} ${r.match_time?.slice(0, 5) ?? ""}`.trim(),
    imageKey: "banner_url",
    autoEnd: true,
    sportFilter: true,
    rowToggle: { key: "is_hot", on: "Make HOT", off: "Remove HOT" },
    columns: {
      key: "status",
      items: [
        { value: "LIVE", label: "Live", tone: "live", empty: "No live matches right now." },
        { value: "UPCOMING", label: "Upcoming", tone: "upcoming", empty: "No upcoming matches." },
        { value: "FINISHED", label: "Ended", tone: "finished", empty: "No ended matches." },
      ],
    },
    fields: [
      { key: "title", label: "Title (e.g. India vs Nepal)", type: "text", required: true },
      { key: "sport_id", label: "Sport", type: "select", ref: "sports", required: true },
      {
        key: "competition_id", label: "Competition", type: "select", ref: "competitions",
        quickAdd: { table: "competitions", title: "Competition", fields: COMPETITION_QUICK_FIELDS, inheritSportFrom: "sport_id" },
      },
      {
        key: "team1_id", label: "Team 1", type: "select", ref: "teams", required: true,
        quickAdd: { table: "teams", title: "Team", fields: TEAM_QUICK_FIELDS, inheritSportFrom: "sport_id" },
      },
      {
        key: "team2_id", label: "Team 2", type: "select", ref: "teams", required: true,
        quickAdd: { table: "teams", title: "Team", fields: TEAM_QUICK_FIELDS, inheritSportFrom: "sport_id" },
      },
      { key: "status", label: "Status", type: "select", options: STATUS, required: true },
      { key: "is_hot", label: "HOT match (shows a HOT badge and lists this match first on the website)", type: "checkbox", defaultValue: false },
      { key: "match_date", label: "Date", type: "date" },
      { key: "match_time", label: "Time", type: "time" },
      { key: "stadium", label: "Stadium", type: "text" },
      { key: "round", label: "Round", type: "text" },
      { key: "broadcaster", label: "Broadcaster", type: "text" },
      { key: "banner_url", label: "Match banner", type: "image", folder: "matches", maxMB: 5, aspect: 16 / 9, round: false },
    ],
  },
  teams: {
    table: "teams", title: "Teams", orderBy: "name", label: (r) => r.name, sub: (r) => r.short_name ?? "", imageKey: "logo_url",
    fields: [
      { key: "name", label: "Team name", type: "text", required: true },
      { key: "short_name", label: "Short name", type: "text", maxLength: 6 },
      { key: "sport_id", label: "Sport", type: "select", ref: "sports" },
      { key: "logo_url", label: "Team logo", type: "image", folder: "teams" },
    ],
  },
  competitions: {
    table: "competitions", title: "Competitions", orderBy: "name", label: (r) => r.name, imageKey: "logo_url",
    fields: [
      { key: "name", label: "Competition name", type: "text", required: true },
      { key: "sport_id", label: "Sport", type: "select", ref: "sports" },
      { key: "logo_url", label: "Competition logo", type: "image", folder: "competitions" },
      { key: "enabled", label: "Enabled", type: "checkbox" },
    ],
  },
  sports: {
    table: "sports", title: "Sports", orderBy: "sort_order", label: (r) => r.name, sub: (r) => `/sports/${r.slug}`, imageKey: "image_url",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "URL slug (lowercase letters, numbers, dashes)", type: "text", required: true, maxLength: 40 },
      { key: "sort_order", label: "Order", type: "number" },
      { key: "image_url", label: "Sport image", type: "image", folder: "sports" },
      { key: "enabled", label: "Enabled", type: "checkbox" },
    ],
  },
  blog: {
    table: "blog_posts", title: "Blog posts", orderBy: "created_at",
    label: (r) => r.title || "Untitled post",
    sub: (r) => `${r.published ? "✅ Published" : "📝 Draft"} · /blog/${r.slug ?? "…"}`,
    imageKey: "cover_url",
    fields: [
      { key: "title", label: "Title (write what people would search, e.g. IPL 2027 live: how to watch)", type: "text", required: true, maxLength: 120 },
      { key: "slug", label: "Web address (leave empty to make it from the title; lowercase letters, numbers, dashes)", type: "text", maxLength: 90 },
      { key: "excerpt", label: "Short summary (shown on the blog list, 1-2 sentences)", type: "textarea", rows: 3, maxLength: 300 },
      { key: "content", label: "Post text. Use # Heading, ## Sub-heading, **bold**, *italic*, - bullet, 1. numbered, > quote, [link text](https://...), ![image text](https://image-url)", type: "textarea", rows: 22, maxLength: 60000, placeholder: "Write your post here…\n\n## First heading\nParagraph text…" },
      { key: "cover_url", label: "Cover image (16:9 works best)", type: "image", folder: "blog", maxMB: 5, aspect: 16 / 9, round: false },
      { key: "seo_description", label: "Google description (optional, up to 160 characters; the summary is used if empty)", type: "text", maxLength: 160 },
      { key: "author", label: "Author name (optional)", type: "text", maxLength: 60 },
      { key: "published", label: "Published (untick to keep it as a draft that visitors cannot see)", type: "checkbox", defaultValue: false },
    ],
  },
  channels: {
    table: "channels", title: "Channels", orderBy: "name",
    label: (r) => r.name,
    sub: (r) => (r.type && r.url ? `${String(r.type).toUpperCase()}, ${r.quality || "-"}${r.language ? `, ${r.language}` : ""}${r.enabled === false ? ", Disabled" : ""}` : "No stream URL yet"),
    imageKey: "logo_url",
    fields: [
      { key: "name", label: "Channel name (e.g. Star Sports HD)", type: "text", required: true },
      { key: "logo_url", label: "Channel logo", type: "image", folder: "channels" },
      { key: "type", label: "Stream type", type: "select", options: STREAM_TYPE },
      { key: "url", label: "Stream URL", type: "url", placeholder: "https://…", detectMismatchWith: "type" },
      { key: "quality", label: "Quality", type: "text", maxLength: 12, placeholder: "HD" },
      { key: "language", label: "Language", type: "text", maxLength: 30 },
      { key: "match_names", label: "Auto-add to these matches (one per line, e.g. India vs West Indies). When the JSON brings a match with these two teams, this channel is added to it as Stream 1.", type: "textarea", rows: 5, placeholder: "India vs West Indies\nBangladesh vs Afghanistan\nSouth Africa vs Australia" },
      { key: "enabled", label: "Enabled", type: "checkbox" },
    ],
  },
};

// The Channels tab is back (auto-add a channel to matches by name). Channel mapping stays hidden: add "mapping" here to bring it back.
const TABS = ["matches", "teams", "competitions", "sports", "channels", "blog", "streams", "import", "settings"] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  matches: "Matches", teams: "Teams", competitions: "Competitions", sports: "Sports", channels: "Channels", blog: "Blog",
  streams: "Match streams", import: "JSON Import", settings: "Website settings",
};

export default function AdminApp() {
  const configured = isSupabaseConfigured();
  const sb = useMemo(() => (configured ? getBrowserClient() : null), [configured]);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("matches");
  const [refs, setRefs] = useState<Record<string, Opt[]>>({});
  const [matchOpts, setMatchOpts] = useState<Opt[]>([]);
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    if (!sb) return;

    let disposed = false;
    let refreshTimer: number | null = null;

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (nextSession: Session | null) => {
      clearRefreshTimer();
      if (!nextSession?.expires_at || disposed) return;

      // Refresh five minutes before expiry. This avoids the immediate refresh
      // loop that was producing 429s during initial page load.
      const refreshIn = Math.max(60_000, nextSession.expires_at * 1000 - Date.now() - 5 * 60_000);
      refreshTimer = window.setTimeout(async () => {
        if (disposed) return;

        const { data, error } = await sb.auth.refreshSession();
        if (disposed) return;

        if (!error && data.session) {
          setSession(data.session);
          scheduleRefresh(data.session);
          return;
        }

        // Never turn a transient Auth 429 into an instant logout. Keep the
        // existing session in the UI and retry later with a bounded delay.
        const retryDelay = /429|rate limit|too many requests/i.test(error?.message ?? "")
          ? 60_000
          : 5 * 60_000;
        refreshTimer = window.setTimeout(() => {
          if (disposed) return;
          void sb.auth.refreshSession().then(({ data: retryData, error: retryError }) => {
            if (disposed) return;
            if (!retryError && retryData.session) {
              setSession(retryData.session);
              scheduleRefresh(retryData.session);
            } else {
              scheduleRefresh(nextSession);
            }
          });
        }, retryDelay);
      }, refreshIn);
    };

    // Supabase emits INITIAL_SESSION immediately after the subscription is
    // registered. Using that event avoids an extra getSession() request, which
    // was the request returning 429 and making the admin screen appear logged out.
    const { data } = sb.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) return;
      setReady(true);

      if (event === "SIGNED_OUT") {
        clearRefreshTimer();
        setSession(null);
        return;
      }

      setSession(nextSession);
      scheduleRefresh(nextSession);
    });

    return () => {
      disposed = true;
      clearRefreshTimer();
      data.subscription.unsubscribe();
    };
  }, [sb]);

  useEffect(() => {
    if (!sb || !session) return setIsAdmin(null);
    void sb.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [sb, session]);

  const loadRefs = useCallback(async () => {
    if (!sb) return;
    const [s, c, t, m] = await Promise.all([
      sb.from("sports").select("id,name").order("name"),
      sb.from("competitions").select("id,name").order("name"),
      sb.from("teams").select("id,name").order("name"),
      sb.from("matches").select("id,title,match_date,sport_id").order("match_date", { ascending: false }),
    ]);
    const o = (rows: { id: string; name: string }[] | null): Opt[] => (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
    setRefs({ sports: o(s.data), competitions: o(c.data), teams: o(t.data) });
    setMatchOpts((m.data ?? []).map((r) => ({ value: r.id, label: `${r.title ?? "Match"} (${r.match_date ?? "no date"})`, sportId: r.sport_id ?? null })));
  }, [sb]);

  useEffect(() => { if (isAdmin) void loadRefs(); }, [isAdmin, loadRefs]);

  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!sb || loginBusy) return;
    const fd = new FormData(e.currentTarget);
    setLoginErr("");
    setLoginBusy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: String(fd.get("email")),
        password: String(fd.get("password")),
      });
      if (error) {
        const rateLimited = /rate limit|too many requests|429/i.test(error.message);
        setLoginErr(rateLimited
          ? "Supabase Auth rate limit reached. Please wait a few minutes before trying again; do not repeatedly submit the form."
          : error.message);
      }
    } finally {
      window.setTimeout(() => setLoginBusy(false), 1500);
    }
  };

  if (!configured)
    return <div className="admin"><h1>Admin</h1><p>Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Supabase keys and run <code>supabase/schema.sql</code>.</p></div>;
  if (!ready) return <div className="admin"><p className="muted">Loading…</p></div>;

  if (!session)
    return (
      <div className="admin" style={{ maxWidth: 420 }}>
        <h1>Admin sign in</h1>
        <form className="form card login-card" onSubmit={login}>
          <label>Email<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {loginErr && <p className="form-error" role="alert">{loginErr}</p>}
          <button className="btn btn-primary" type="submit" disabled={loginBusy}>{loginBusy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    );

  if (isAdmin === null) return <div className="admin"><p className="muted">Checking access…</p></div>;
  if (!isAdmin)
    return (
      <div className="admin">
        <h1>No admin access</h1>
        <p>This account is not an admin. Ask the site owner to add it to the <code>admins</code> table.</p>
        <button className="btn" onClick={() => void sb?.auth.signOut()}>Sign out</button>
      </div>
    );

  return (
    <div className="admin">
      <div className="section-head">
        <h1 style={{ margin: 0 }}>Admin</h1>
        <button className="btn btn-sm" onClick={() => void sb?.auth.signOut()}>Sign out</button>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Manage">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="btn btn-sm" onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {sb && tab === "streams" && <StreamsAdmin key={matchOpts.length} sb={sb} matches={matchOpts} sports={refs.sports ?? []} />}
      {sb && tab === "settings" && <SiteSettings sb={sb} />}
      {sb && tab === "import" && <JsonImport sb={sb} onChanged={() => void loadRefs()} />}
      {sb && tab !== "streams" && tab !== "settings" && tab !== "import" && <EntityAdmin key={tab} sb={sb} config={CONFIGS[tab]} refs={refs} onChanged={() => void loadRefs()} />}
    </div>
  );
}
