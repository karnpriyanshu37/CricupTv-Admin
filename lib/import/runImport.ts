import { guessSportName } from "@/lib/import/sportGuess";
import { autoEndHours, FINISHED_KEEP_MS } from "@/lib/matchEnd";
import { matchStartMs } from "@/lib/matchTime";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeName,
  parseStartTime,
  playerSlot,
  slugify,
  statusOf,
  streamDrm,
  streamType,
  streamUrl,
  teamNames,
  text,
} from "@/lib/import/sportsJson";
import type { FeedMatch, FeedStream, ParsedFeed } from "@/lib/import/sportsJson";
import { canonSport, pairsMatch, titleKey, validPair } from "@/lib/import/matchTeams";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type Report = {
  ok: boolean;
  text: string;
  createdMatches: number;
  skippedOldMatches: number;
  /** new matches that were not created because the feed gave no usable streaming link for them */
  skippedNoStreamMatches: number;
  updatedMatches: number;
  createdStreams: number;
  updatedStreams: number;
  createdTeams: number;
  updatedTeams: number;
  createdCompetitions: number;
  createdSports: number;
  warnings: string[];
  /** true when the run stopped early because of the time limit */
  partial?: boolean;
};

function infoValue(info: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(info?.[key]);
    if (value) return value;
  }
  return "";
}

function parseMetadata(stream: FeedStream): Record<string, string> | null {
  const referer = text(stream.referer);
  const userAgent = text(stream.user_agent ?? stream.userAgent);
  if (!referer && !userAgent) return null;
  return {
    ...(referer ? { referer } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
  };
}

/** Two teams as one order-independent key. Empty when the pair can't identify a match (TBD, or both sides the same). */
function pairKey(a: string, b: string): string {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y || x === y || x === "tbd" || y === "tbd") return "";
  return [x, y].sort().join("|");
}

/** Whole days between two YYYY-MM-DD dates; 0 when either date is unknown. */
function daysApart(d1: string | null, d2: string | null): number {
  if (!d1 || !d2) return 0;
  const t1 = Date.parse(`${d1}T00:00:00Z`), t2 = Date.parse(`${d2}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.abs(Math.round((t1 - t2) / 86400000));
}

/**
 * Reads each channel's "auto-add" list (one match per line, "India vs West Indies") into rules.
 * Only enabled channels that have a type and a link are used.
 */
function buildChannelRules(channels: Row[]): { channel: Row; pairs: Set<string>; titles: Set<string> }[] {
  const rules: { channel: Row; pairs: Set<string>; titles: Set<string> }[] = [];
  for (const ch of channels) {
    if (ch.enabled === false || !ch.url || (ch.type !== "hls" && ch.type !== "dash")) continue;
    const pairs = new Set<string>();
    const titles = new Set<string>();
    for (const line of String(ch.match_names ?? "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      titles.add(normalizeName(t));
      const parts = t.split(/\s+(?:vs\.?|v\.?|versus)\s+/i);
      if (parts.length >= 2) {
        const k = pairKey(parts[0], parts.slice(1).join(" vs "));
        if (k) pairs.add(k);
      }
    }
    if (pairs.size || titles.size) rules.push({ channel: ch, pairs, titles });
  }
  return rules;
}

type KnownMatch = { row: Row; a: string; b: string; title: string; date: string | null; sport: string };


/**
 * The whole JSON import: used by the JSON Import tab (browser, logged-in admin) and by the hourly
 * auto-import (server, /api/cron/import). A match that already exists is never duplicated: only its
 * streaming links / channels are added or changed.
 */
export async function runFeedImport(
  sb: SupabaseClient,
  parsed: ParsedFeed,
  opts: { onProgress?: (message: string) => void; deadlineMs?: number } = {},
): Promise<Report> {
  const result: Report = {
    ok: true, text: "", createdMatches: 0, skippedOldMatches: 0, skippedNoStreamMatches: 0, updatedMatches: 0, createdStreams: 0,
    updatedStreams: 0, createdTeams: 0, updatedTeams: 0, createdCompetitions: 0,
    createdSports: 0, warnings: [],
  };
  opts.onProgress?.("Loading existing data…");

  try {
      const STREAM_COLS = "id,match_id,name,type,url,quality,language,enabled,sort_order,player_slot,drm";
      const [sportsRes, compsRes, teamsRes, matchesRes, streamsWithMeta, channelsRes] = await Promise.all([
        sb.from("sports").select("id,name,slug,sort_order"),
        sb.from("competitions").select("id,name,sport_id,logo_url"),
        sb.from("teams").select("id,name,short_name,sport_id,logo_url"),
        sb.from("matches").select("id,title,status,match_date,team1_id,team2_id,competition_id,sport_id"),
        sb.from("streams").select(`${STREAM_COLS},metadata`),
        sb.from("channels").select("id,name,type,url,quality,language,enabled,drm,match_names"),
      ]);
      // The metadata column is optional (older databases): fall back to the plain list without it.
      const hasMetadata = !streamsWithMeta.error;
      const streamsRes = hasMetadata ? streamsWithMeta : await sb.from("streams").select(STREAM_COLS);
      for (const r of [sportsRes, compsRes, teamsRes, matchesRes, streamsRes]) if (r.error) throw new Error(r.error.message);
      // Channels are optional too: if the match_names column was not added yet, the import still works, just without auto-add.
      const channelAutoRules = channelsRes.error ? [] : buildChannelRules((channelsRes.data ?? []) as Row[]);
      if (channelsRes.error && /match_names/i.test(channelsRes.error.message)) {
        result.warnings.push("Channels were not auto-added: run supabase/add-hot-and-channel-matches.sql in the Supabase SQL editor first.");
      }

      const sports = (sportsRes.data ?? []) as Row[];
      const competitions = (compsRes.data ?? []) as Row[];
      const teams = (teamsRes.data ?? []) as Row[];
      const matches = (matchesRes.data ?? []) as Row[];
      const streams = (streamsRes.data ?? []) as Row[];

      const sportByKey = new Map<string, Row>();
      sports.forEach((r) => sportByKey.set(`${normalizeName(r.name)}|${r.slug}`, r));
      const compByKey = new Map<string, Row>();
      competitions.forEach((r) => compByKey.set(`${normalizeName(r.name)}|${r.sport_id ?? ""}`, r));
      const teamByKey = new Map<string, Row>();
      teams.forEach((r) => teamByKey.set(`${normalizeName(r.name)}|${r.sport_id ?? ""}`, r));
      const teamNameById = new Map<string, string>(teams.map((r) => [r.id, r.name]));
      const sportNameById = new Map<string, string>(sports.map((r) => [r.id, r.name]));
      // Every match already in the database. A match in a feed is "the same match" when it has the same two
      // teams (any order, spelled loosely: "Athletic" = "Athletic Club") or the same title, on the same day
      // (+/- 1 day, so small time-zone shifts don't matter) and not clearly a different sport.
      const known: KnownMatch[] = matches.map((r) => ({
        row: r,
        a: teamNameById.get(r.team1_id) ?? "",
        b: teamNameById.get(r.team2_id) ?? "",
        title: r.title ?? "",
        date: r.match_date ?? null,
        sport: canonSport(sportNameById.get(r.sport_id) ?? ""),
      }));
      const findKnown = (date: string | null, a: string, b: string, title: string, sport: string): KnownMatch | null => {
        const canPair = validPair(a, b);
        const tk = titleKey(title);
        let best: KnownMatch | null = null;
        let bestGap = Infinity;
        for (const k of known) {
          if (sport && k.sport && sport !== k.sport) continue;
          const sameTeams = canPair && validPair(k.a, k.b) && pairsMatch(a, b, k.a, k.b);
          const sameTitle = !!tk && titleKey(k.title) === tk;
          if (!sameTeams && !sameTitle) continue;
          const gap = daysApart(date, k.date);
          if (gap > 1 || gap >= bestGap) continue;
          best = k;
          bestGap = gap;
        }
        return best;
      };
      const streamByKey = new Map<string, Row>();
      streams.forEach((r) => streamByKey.set(`${r.match_id}|${text(r.url)}`, r));
      // Streams that came from a channel's "auto-add" list: one per (match, channel).
      const channelStreamByKey = new Map<string, Row>();
      streams.forEach((r) => {
        const cid = r.metadata && typeof r.metadata === "object" ? (r.metadata as Row).channel_id : null;
        if (cid) channelStreamByKey.set(`${r.match_id}|${cid}`, r);
      });
      // The same channel name inside one match is the same stream: a new link for it replaces the old link.
      const streamByName = new Map<string, Row>();
      streams.forEach((r) => streamByName.set(`${r.match_id}|${normalizeName(r.name)}`, r));
      const maxSortByMatch = new Map<string, number>();
      streams.forEach((r) => maxSortByMatch.set(r.match_id, Math.max(maxSortByMatch.get(r.match_id) ?? 0, Number(r.sort_order ?? 0))));
      const streamSlotsByMatch = new Map<string, Set<number>>();
      streams.forEach((r) => {
        if (r.player_slot === 1 || r.player_slot === 2) {
          const set = streamSlotsByMatch.get(r.match_id) ?? new Set<number>();
          set.add(r.player_slot);
          streamSlotsByMatch.set(r.match_id, set);
        }
      });

      const ensureSport = async (category: string) => {
        const name = category || "Other Sports";
        const slug = slugify(name);
        const key = `${normalizeName(name)}|${slug}`;
        const existing = sportByKey.get(key);
        if (existing) return existing;
        const sortOrder = sports.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0) + result.createdSports;
        const { data, error } = await sb.from("sports").insert({ name, slug, enabled: true, sort_order: sortOrder }).select().single();
        if (error) {
          // A duplicate slug can exist under a differently named row. Re-read it.
          const retry = await sb.from("sports").select("id,name,slug,sort_order").eq("slug", slug).maybeSingle();
          if (retry.data) return retry.data;
          throw new Error(`Could not create sport “${name}”: ${error.message}`);
        }
        sportByKey.set(key, data);
        result.createdSports++;
        return data;
      };

      const ensureCompetition = async (name: string, sportId: string, logoUrl: string) => {
        const compName = name || "General";
        const key = `${normalizeName(compName)}|${sportId}`;
        const existing = compByKey.get(key);
        if (existing) {
          if (logoUrl && existing.logo_url !== logoUrl) {
            const { error } = await sb.from("competitions").update({ logo_url: logoUrl, sport_id: sportId }).eq("id", existing.id);
            if (error) throw new Error(`Could not update competition “${compName}”: ${error.message}`);
            existing.logo_url = logoUrl;
            result.createdCompetitions += 0;
          }
          return existing;
        }
        const { data, error } = await sb.from("competitions").insert({ name: compName, sport_id: sportId, logo_url: logoUrl || null, enabled: true }).select().single();
        if (error) throw new Error(`Could not create competition “${compName}”: ${error.message}`);
        compByKey.set(key, data);
        result.createdCompetitions++;
        return data;
      };

      const ensureTeam = async (name: string, sportId: string, logoUrl: string, shortName: string) => {
        const teamName = name || "TBD";
        const key = `${normalizeName(teamName)}|${sportId}`;
        const existing = teamByKey.get(key);
        if (existing) {
          const update: Row = {};
          if (logoUrl && existing.logo_url !== logoUrl) update.logo_url = logoUrl;
          if (shortName && existing.short_name !== shortName) update.short_name = shortName.slice(0, 6);
          if (existing.sport_id !== sportId) update.sport_id = sportId;
          if (Object.keys(update).length) {
            const { error } = await sb.from("teams").update(update).eq("id", existing.id);
            if (error) throw new Error(`Could not update team “${teamName}”: ${error.message}`);
            Object.assign(existing, update);
            result.updatedTeams++;
          }
          return existing;
        }
        const { data, error } = await sb.from("teams").insert({ name: teamName, short_name: shortName ? shortName.slice(0, 6) : null, sport_id: sportId, logo_url: logoUrl || null }).select().single();
        if (error) throw new Error(`Could not create team “${teamName}”: ${error.message}`);
        teamByKey.set(key, data);
        result.createdTeams++;
        return data;
      };

      for (let mi = 0; mi < parsed.matches.length; mi++) {
        const fm: FeedMatch = parsed.matches[mi];
        if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
          result.partial = true;
          result.warnings.push(`Stopped after ${mi} of ${parsed.matches.length} matches to stay inside the time limit; the rest is imported on the next run.`);
          break;
        }
        opts.onProgress?.(`Importing match ${mi + 1} of ${parsed.matches.length}…`);
        const info = fm.eventInfo ?? {};
        const names = teamNames(fm);
        const eventName = text(fm.event_name ?? fm.name);
        const when = parseStartTime(info.startTime ?? fm.startTime ?? fm.date_time ?? fm.datetime);
        const matchTitle = eventName || `${names.a} vs ${names.b}`;

        const feedSport = text(fm.Category ?? fm.category ?? fm.sport) || "Other Sports";
        // A feed that files e.g. "TENNIS | EVENTO" under "Other" still gets the real sport (Tennis).
        const guessedSport = /^other/i.test(feedSport)
          ? guessSportName(`${eventName} ${infoValue(info, "eventName", "competition", "tournament", "league")} ${names.a} ${names.b}`)
          : null;
        const sportName = guessedSport ?? feedSport;
        const competitionName = infoValue(info, "eventName", "competition", "tournament", "league") || eventName || "General";

        let match: Row;
        const existingMatch = findKnown(when.date, names.a, names.b, matchTitle, canonSport(sportName));
        if (existingMatch) {
          // This match is already on the site: no second card. Only its streaming links / channels are added or changed.
          match = existingMatch.row;
          result.updatedMatches++;
        } else {
          // A match that already ended 3+ hours ago would be deleted again straight away, so it is not added back.
          if (when.date) {
            const feedStatus = statusOf(fm.status);
            const hours = autoEndHours(sportName, competitionName, matchTitle) ?? (feedStatus === "FINISHED" ? 5 : null);
            const start = matchStartMs(when.date, when.time ?? null, "23:59");
            if (hours !== null && !Number.isNaN(start) && Date.now() >= start + hours * 3600_000 + FINISHED_KEEP_MS) {
              result.skippedOldMatches++;
              continue;
            }
          }
          // No streaming link in the feed = no new card. (A match that already exists is not affected.)
          const feedStreamList = Array.isArray(fm.streams) ? fm.streams : [];
          const hasUsableStream = feedStreamList.some((fs) => {
            const u = streamUrl(fs);
            return !!u && !!streamType(fs, u);
          });
          if (!hasUsableStream) {
            result.skippedNoStreamMatches++;
            continue;
          }
          const sport = await ensureSport(sportName);
          const compLogo = infoValue(info, "event_logo", "competitionLogo", "logo");
          const competition = await ensureCompetition(competitionName, sport.id, compLogo);
          const teamALogo = infoValue(info, "teamAFlag", "teamALogo", "homeLogo", "homeTeamLogo");
          const teamBLogo = infoValue(info, "teamBFlag", "teamBLogo", "awayLogo", "awayTeamLogo");
          const teamAShort = infoValue(info, "teamAShort", "team1Short", "homeShort");
          const teamBShort = infoValue(info, "teamBShort", "team2Short", "awayShort");
          const teamA = await ensureTeam(names.a, sport.id, teamALogo, teamAShort);
          const teamB = await ensureTeam(names.b, sport.id, teamBLogo, teamBShort);
          const status = statusOf(fm.status);
          const stadium = infoValue(info, "stadium", "venue", "ground");
          const round = infoValue(info, "round", "stage");
          const broadcaster = infoValue(info, "broadcaster", "broadcast", "channel");
          const banner = infoValue(info, "banner_url", "banner", "eventBanner", "image");
          const { data, error } = await sb.from("matches").insert({
            sport_id: sport.id,
            competition_id: competition.id,
            team1_id: teamA.id,
            team2_id: teamB.id,
            title: matchTitle,
            status,
            match_date: when.date ?? null,
            match_time: when.time ?? null,
            stadium: stadium || null,
            round: round || null,
            broadcaster: broadcaster || null,
            banner_url: banner ? unwrapMaybe(banner) : null,
          }).select().single();
          if (error) throw new Error(`Could not create match “${matchTitle}”: ${error.message}`);
          match = data;
          known.push({ row: match, a: teamA.name, b: teamB.name, title: matchTitle, date: when.date, sport: canonSport(sportName) });
          result.createdMatches++;
        }

        const feedStreams = Array.isArray(fm.streams) ? fm.streams : [];
        const usedSlots = new Set(streamSlotsByMatch.get(match.id) ?? []);
        const sortBase = maxSortByMatch.get(match.id) ?? 0;
        let autoSlotCursor = 1;
        for (let si = 0; si < feedStreams.length; si++) {
          const fs = feedStreams[si];
          const url = streamUrl(fs);
          if (!url) continue;
          const type = streamType(fs, url);
          if (!type) {
            result.warnings.push(`${eventName || "Match"}: skipped unsupported stream URL ${url.slice(0, 100)}`);
            continue;
          }
          const drm = streamDrm(fs);
          if (!drm.ok) result.warnings.push(`${eventName || "Match"}: ${text(fs.channel_name ?? fs.name) || `stream ${si + 1}`} has invalid DRM — imported without DRM config (${drm.error}).`);

          const name = (text(fs.channel_name ?? fs.name) || `Stream ${si + 1}`).slice(0, 60);
          const metadata = parseMetadata(fs);
          // Same link, or same channel name, already on this match = the same stream.
          const existing = streamByKey.get(`${match.id}|${url}`) ?? streamByName.get(`${match.id}|${normalizeName(name)}`);

          if (existing) {
            // Change the link / details only. Its position, player slot and enabled switch stay as they are.
            const update: Row = {
              name,
              type,
              url,
              quality: text(fs.quality) || null,
              language: text(fs.language) || null,
              drm: drm.ok ? drm.value : null,
            };
            if (metadata) update.metadata = metadata;
            const changed = (["name", "type", "url", "quality", "language", "drm"] as const).some(
              (k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(update[k] ?? null),
            );
            if (!changed) continue; // same link and details as last time: nothing to write
            let { error } = await sb.from("streams").update(update).eq("id", existing.id);
            if (error && /metadata/i.test(error.message)) {
              delete update.metadata;
              const retry = await sb.from("streams").update(update).eq("id", existing.id);
              error = retry.error;
            }
            if (error) throw new Error(`Could not update stream “${name}”: ${error.message}`);
            streamByKey.delete(`${match.id}|${text(existing.url)}`);
            Object.assign(existing, update);
            streamByKey.set(`${match.id}|${url}`, existing);
            streamByName.set(`${match.id}|${normalizeName(name)}`, existing);
            result.updatedStreams++;
            continue;
          }

          // A new channel for this match: add it after the ones it already has.
          const explicitSlot = playerSlot(fs);
          let slot = explicitSlot;
          if (!slot) {
            while (autoSlotCursor <= 2 && usedSlots.has(autoSlotCursor)) autoSlotCursor++;
            slot = autoSlotCursor <= 2 ? autoSlotCursor as 1 | 2 : null;
            if (slot) { usedSlots.add(slot); autoSlotCursor++; }
          } else if (usedSlots.has(slot)) {
            result.warnings.push(`${eventName || "Match"}: duplicate player slot Stream ${slot}; kept the first assignment.`);
            slot = null;
          } else usedSlots.add(slot);

          const payload: Row = {
            match_id: match.id,
            name,
            type,
            url,
            quality: text(fs.quality) || null,
            language: text(fs.language) || null,
            enabled: true,
            sort_order: sortBase + si + 1,
            player_slot: slot,
            drm: drm.ok ? drm.value : null,
          };
          if (metadata) payload.metadata = metadata;
          let insert = await sb.from("streams").insert(payload);
          if (insert.error && /metadata/i.test(insert.error.message)) {
            const fallback = { ...payload };
            delete fallback.metadata;
            insert = await sb.from("streams").insert(fallback);
          }
          if (insert.error) throw new Error(`Could not create stream “${name}”: ${insert.error.message}`);
          result.createdStreams++;
          const created = { id: crypto.randomUUID(), ...payload };
          streamByKey.set(`${match.id}|${url}`, created);
          streamByName.set(`${match.id}|${normalizeName(name)}`, created);
        }

        // Channels whose "auto-add" list names this match get added as the first stream.
        if (channelAutoRules.length && hasMetadata) {
          const thisPair = pairKey(names.a, names.b);
          const thisTitle = normalizeName(matchTitle);
          for (const rule of channelAutoRules) {
            if (!(rule.pairs.has(thisPair) && thisPair) && !rule.titles.has(thisTitle)) continue;
            const ch = rule.channel;
            const drmValue = ch.drm && typeof ch.drm === "object" ? ch.drm : null;
            const key = `${match.id}|${ch.id}`;
            const current = channelStreamByKey.get(key);
            const wanted: Row = {
              name: String(ch.name).slice(0, 60),
              type: ch.type,
              url: ch.url,
              quality: ch.quality ?? null,
              language: ch.language ?? null,
              drm: drmValue,
            };
            if (current) {
              // Already added before: only follow changes made to the channel (new link, name, …).
              const changed = (["name", "type", "url", "quality", "language", "drm"] as const).some(
                (k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(wanted[k] ?? null),
              );
              if (!changed) continue;
              const { error } = await sb.from("streams").update(wanted).eq("id", current.id);
              if (error) throw new Error(`Could not update channel stream “${wanted.name}”: ${error.message}`);
              Object.assign(current, wanted);
              result.updatedStreams++;
              continue;
            }
            // The same link is already on this match (e.g. it also came in the JSON): do not add it twice.
            if (streamByKey.has(`${match.id}|${text(ch.url)}`)) continue;
            const payload: Row = {
              match_id: match.id, ...wanted, enabled: true, sort_order: 0, player_slot: null,
              metadata: { pinned: true, channel_id: ch.id },
            };
            const insert = await sb.from("streams").insert(payload).select().single();
            if (insert.error) throw new Error(`Could not add channel “${wanted.name}” to “${matchTitle}”: ${insert.error.message}`);
            channelStreamByKey.set(key, insert.data);
            streamByKey.set(`${match.id}|${text(ch.url)}`, insert.data);
            result.createdStreams++;
          }
        }
      }

      const feedName = text(parsed.feed.name);
      const owner = text(parsed.feed.owner);
      const telegramRaw = text(parsed.feed.telegram_channel);
      const telegram = unwrapMaybe(telegramRaw);
      const updatedAt = text(parsed.feed.last_update_time);
      const meta = {
        ...(feedName ? { name: feedName } : {}),
        ...(owner ? { owner } : {}),
        ...(telegram ? { telegram_channel: telegram } : {}),
        ...(updatedAt ? { last_update_time: updatedAt } : {}),
        ...(parsed.feed.total_matches != null ? { total_matches: Number(parsed.feed.total_matches) || parsed.feed.total_matches } : {}),
        ...(parsed.feed.live_match != null ? { live_match: Number(parsed.feed.live_match) || parsed.feed.live_match } : {}),
      };
      // Only the main feed describes the site (owner, Telegram, ...): Tapmad / SonyLIV must not overwrite it.
      if (Object.keys(meta).length && (!parsed.source || parsed.source === "main")) {
        const { error } = await sb.from("site_settings").upsert({ key: "sports_feed_metadata", value: JSON.stringify(meta) });
        if (error) result.warnings.push(`Feed metadata was not saved to site settings: ${error.message}`);
      }

      result.text = `Import finished: ${result.createdMatches} new matches, ${result.updatedMatches} matches already existed (no duplicate cards, only their streams were touched), ${result.skippedOldMatches} already-ended matches skipped, ${result.skippedNoStreamMatches} matches without a streaming link not created, ${result.createdStreams} streams added, ${result.updatedStreams} streams changed.`;
      if (parsed.note) result.text += ` ${parsed.note}`;
      if (result.warnings.length) result.text += ` ${result.warnings.length} warning(s).`;
  } catch (error) {
    result.ok = false;
    result.text = error instanceof Error ? error.message : "Import failed.";
  }
  return result;
}

function unwrapMaybe(value: string): string {
  const m = value.match(/^\[.*?\]\((https?:\/\/[^)]+)\)$/i);
  return m ? m[1] : value;
}
