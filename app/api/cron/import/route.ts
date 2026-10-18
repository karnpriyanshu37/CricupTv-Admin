import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runFeedImport } from "@/lib/import/runImport";
import { parseAnyFeed } from "@/lib/import/feedAdapters";
import type { FeedKind } from "@/lib/import/feedAdapters";

/**
 * Hourly auto-import. Something (GitHub Actions, see .github/workflows/hourly-import.yml) calls this URL every
 * hour; it downloads the sports JSON feed and imports it exactly like the JSON Import tab does:
 * existing matches are never duplicated, only their streaming links / channels are added or changed.
 *
 * Protected by CRON_SECRET (sent as "Authorization: Bearer <secret>"). Needs SUPABASE_SERVICE_ROLE_KEY on the server.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FEEDS: Record<FeedKind, { env: string; url: string }> = {
  main: { env: "SPORTS_FEED_URL", url: "https://raw.githubusercontent.com/sm-monirulislam/Upcoming-and-Live-Sports-Data/main/Sports_data.json" },
  tapmad: { env: "TAPMAD_FEED_URL", url: "https://raw.githubusercontent.com/sm-monirulislam/Tapmad_Auto_Update_Playlist/main/tapmad_data.json" },
  sonyliv: { env: "SONYLIV_FEED_URL", url: "https://raw.githubusercontent.com/sm-monirulislam/SonyLiv_Event_Playlist/main/sonyLiv_data.json" },
};
// The main feed goes first: it makes the match cards, the other two then add their links to those cards.
const ORDER: FeedKind[] = ["main", "tapmad", "sonyliv"];

/** Accepts a normal GitHub page link (…/blob/main/file.json) and turns it into the raw file link. */
function rawFeedUrl(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : url;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set on the server." }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (!sameSecret(auth, `Bearer ${secret}`)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server." }, { status: 503 });
  }

  // ?feed=main | tapmad | sonyliv  imports one feed; ?feed=all (default) imports all three one after the other.
  const wanted = (new URL(req.url).searchParams.get("feed") ?? "all").toLowerCase();
  if (wanted !== "all" && !ORDER.includes(wanted as FeedKind)) {
    return NextResponse.json({ ok: false, error: "feed must be main, tapmad, sonyliv or all" }, { status: 400 });
  }
  const kinds = wanted === "all" ? ORDER : [wanted as FeedKind];

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const deadlineMs = Date.now() + 50_000;
  const feeds: Record<string, unknown>[] = [];
  let allOk = true;

  for (const kind of kinds) {
    const cfg = FEEDS[kind];
    const feedUrl = rawFeedUrl(process.env[cfg.env]?.trim() || cfg.url);
    if (!/^https:\/\//i.test(feedUrl)) {
      feeds.push({ feed: kind, ok: false, error: `${cfg.env} must start with https://` });
      allOk = false;
      continue;
    }
    let body: string;
    try {
      const res = await fetch(feedUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { feeds.push({ feed: kind, ok: false, error: `Feed download failed: HTTP ${res.status}` }); allOk = false; continue; }
      body = await res.text();
    } catch (e) {
      feeds.push({ feed: kind, ok: false, error: `Feed download failed: ${e instanceof Error ? e.message : String(e)}` });
      allOk = false;
      continue;
    }
    let parsed;
    try {
      parsed = parseAnyFeed(body, kind);
    } catch (e) {
      feeds.push({ feed: kind, ok: false, error: `Feed is not valid: ${e instanceof Error ? e.message : String(e)}` });
      allOk = false;
      continue;
    }
    // One failing feed must not stop the others.
    const result = await runFeedImport(sb, parsed, { deadlineMs });
    if (!result.ok) allOk = false;
    feeds.push({
      feed: kind,
      ok: result.ok,
      text: result.text,
      partial: result.partial ?? false,
      createdMatches: result.createdMatches,
      existingMatches: result.updatedMatches,
      skippedOldMatches: result.skippedOldMatches,
      mergedDuplicates: result.mergedDuplicates,
      skippedNoStreamMatches: result.skippedNoStreamMatches,
      skippedSportOffMatches: result.skippedSportOffMatches,
      skippedCompetitionOffMatches: result.skippedCompetitionOffMatches,
      createdStreams: result.createdStreams,
      updatedStreams: result.updatedStreams,
      warnings: result.warnings.slice(0, 20),
    });
  }
  return NextResponse.json({ ok: allOk, feeds }, { status: allOk ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
