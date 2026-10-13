import { guessSportName } from "@/lib/import/sportGuess";
import { normalizeName, parseJsonFeed, text } from "@/lib/import/sportsJson";
import type { FeedMatch, FeedStream, ParsedFeed } from "@/lib/import/sportsJson";

/**
 * The three feeds have different shapes. The importer understands one shape (the main feed), so the Tapmad and
 * SonyLIV feeds are converted into it here. After that every feed goes through the same import, which never
 * creates a second card for a match that already exists: it only adds / updates that match's streaming links.
 */
export type FeedKind = "main" | "tapmad" | "sonyliv";

/** Guesses which feed a parsed file is, from the fields of its matches. */
export function detectFeedKind(matches: FeedMatch[]): FeedKind {
  const sample = matches.slice(0, 25);
  if (sample.some((m) => "stream_link" in m || "match_name" in m || "broadcast_channel" in m || "contentId" in m)) return "sonyliv";
  if (sample.some((m) => "start_time_bd" in m || ("title" in m && "stream_url" in m && !("streams" in m)))) return "tapmad";
  return "main";
}

/** Parses a feed file of any of the three kinds. `kind` forces the kind (the hourly import knows it); otherwise it is detected. */
export function parseAnyFeed(raw: string, kind?: FeedKind): ParsedFeed {
  const parsed = parseJsonFeed(raw);
  const k = kind ?? detectFeedKind(parsed.matches);
  if (k === "tapmad") return normalizeTapmad(parsed);
  if (k === "sonyliv") return normalizeSonyLiv(parsed);
  return { ...parsed, source: "main" };
}

// ---------- shared helpers ----------

const pad = (n: number) => String(n).padStart(2, "0");

/** "Team A vs Team B - 1st Test" -> { a, b }; null when the title has no "vs". */
function splitVs(title: string): { a: string; b: string } | null {
  const m = title.match(/^(.+?)\s+(?:vs\.?|v\.?|versus)\s+(.+?)(?:\s+-\s+.+)?$/i);
  return m ? { a: m[1].trim(), b: m[2].trim() } : null;
}

/** "LaLiga 2026/27" -> "LaLiga"; "Open de Espana - Day 3" is left alone. */
function stripSeason(name: string): string {
  return name.replace(/\s*\b(?:19|20)\d{2}(?:\s*[\/-]\s*(?:\d{2}|\d{4}))?\s*$/, "").trim();
}

function titleCaseVs(a: string, b: string): string {
  return `${a} Vs ${b}`;
}

const CRICKET_FORMAT = /\b(test|t20i?|odi)\b/i;

// ---------- Tapmad ----------

/** Tapmad times are labelled Bangladesh time (UTC+6); subtracting 6h puts them on the same clock as the main feed (checked: same matches line up). */
function bangladeshToUtc(raw: string): string {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - 6 * 3600_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Tapmad has no sport field: read it from the competition / title. */
function tapmadSport(header: string, title: string): string {
  const t = `${header} ${title}`.toLowerCase();
  if (/\b(ufc|pfl|fight night|mma|bellator)\b/.test(t)) return "UFC";
  if (/\bboxing\b/.test(t)) return "Boxing";
  if (/\b(test|t20i?|odi|ipl|cricket|tri-series|big bash|psl|bpl|cpl|asia cup)\b/.test(t) && !/matchday/.test(t)) return "Cricket";
  if (/\b(tennis|atp|wta|grand slam)\b/.test(t)) return "Tennis";
  if (/\b(nba|basketball)\b/.test(t)) return "Basketball";
  if (/\b(f1|formula (?:1|one))\b/.test(t)) return "F1";
  if (/matchday|league|liga|serie a|bundesliga|ligue|cup|premier|champions|uefa|fifa|football|soccer|division|friendly/.test(t)) return "Football";
  return guessSportName(t) ?? "Other Sports";
}

function normalizeTapmad(parsed: ParsedFeed): ParsedFeed {
  const matches: FeedMatch[] = [];
  let noTeams = 0;
  for (const raw of parsed.matches) {
    const title = text(raw.title);
    const teams = splitVs(title);
    if (!teams) { noTeams++; continue; }

    const header = text(raw.header_name);
    // "MATCHDAY 8 - LaLiga 2026/27" -> round "MATCHDAY 8", competition "LaLiga"
    const dash = header.indexOf(" - ");
    const round = dash > 0 ? header.slice(0, dash).trim() : "";
    let competition = stripSeason(dash > 0 ? header.slice(dash + 3).trim() : header) || "Tapmad";
    // Keep the cricket format (Test / T20 / ODI) in the competition name: the auto-end time depends on it.
    if (round && CRICKET_FORMAT.test(round) && !CRICKET_FORMAT.test(competition)) competition = `${competition} - ${round}`;

    const url = text(raw.stream_url);
    const stream: FeedStream[] = url ? [{ channel_name: "Tapmad", stream_url: url }] : [];
    matches.push({
      status: raw.status,
      Category: tapmadSport(header, title),
      event_name: titleCaseVs(teams.a, teams.b),
      eventInfo: {
        teamA: teams.a,
        teamB: teams.b,
        eventName: competition,
        round: round && !CRICKET_FORMAT.test(round) ? round : "",
        startTime: bangladeshToUtc(text(raw.start_time_bd)),
      },
      streams: stream,
    });
  }
  const note = noTeams ? `${noTeams} Tapmad item(s) without "A vs B" in the title were skipped.` : "";
  return { feed: parsed.feed, matches, source: "tapmad", note };
}

// ---------- SonyLIV ----------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const LANGUAGES: Record<string, string> = { ENG: "English", HIN: "Hindi", TAM: "Tamil", TEL: "Telugu", BEN: "Bengali", MAL: "Malayalam", KAN: "Kannada", MAR: "Marathi", BHO: "Bhojpuri", GUJ: "Gujarati", PUN: "Punjabi" };

/** "Bengaluru FC vs Sporting Club Delhi - 10 Oct 2026 [HIN]" -> { title, date, lang } */
function parseSonyName(matchName: string): { title: string; date: string; lang: string } {
  let s = matchName.trim();
  let lang = "";
  const l = s.match(/\[([A-Za-z]{2,4})\]\s*$/);
  if (l) { lang = l[1].toUpperCase(); s = s.slice(0, l.index).trim(); }
  let date = "";
  const d = s.match(/[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s*$/);
  if (d) {
    const mon = MONTHS[d[2].slice(0, 4).toLowerCase()] ?? MONTHS[d[2].slice(0, 3).toLowerCase()];
    if (mon) date = `${d[3]}-${pad(mon)}-${pad(Number(d[1]))}`;
    s = s.slice(0, d.index).trim();
  }
  return { title: s, date, lang };
}

function normalizeSonyLiv(parsed: ParsedFeed): ParsedFeed {
  // One item of this feed is one language stream of a match; items of the same match are grouped.
  const groups = new Map<string, FeedMatch>();
  let withoutLink = 0;
  let withoutName = 0;
  for (const raw of parsed.matches) {
    const link = text(raw.stream_link);
    if (!link) { withoutLink++; continue; } // upcoming: no link and no date yet, nothing to add
    const name = text(raw.match_name);
    if (!name) { withoutName++; continue; }

    const { title, date, lang: bracketLang } = parseSonyName(name);
    if (!title) { withoutName++; continue; }
    const code = (bracketLang || text(raw.contentId).split("_")[1] || text(raw.audioLanguageName)).toUpperCase();
    const channel = text(raw.broadcast_channel) || "SonyLIV";
    const teams = splitVs(title);
    const key = `${normalizeName(title)}|${date}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        status: raw.status,
        Category: text(raw.event_category) || "Other Sports",
        event_name: teams ? titleCaseVs(teams.a, teams.b) : title,
        eventInfo: {
          // a single event with no two sides (a golf round, ...) shows its title on both sides, like the main feed
          teamA: teams?.a ?? title,
          teamB: teams?.b ?? title,
          eventName: stripSeason(text(raw.event_name).replace(/^upcoming\s*-\s*/i, "")) || "SonyLIV",
          startTime: date,
        },
        streams: [],
      };
      groups.set(key, group);
    }
    (group.streams as FeedStream[]).push({
      channel_name: code ? `${channel} (${code})` : channel,
      stream_url: link,
      language: LANGUAGES[code] ?? (code || undefined),
    });
  }
  const bits: string[] = [];
  if (withoutLink) bits.push(`${withoutLink} SonyLIV item(s) without a stream link (upcoming) were skipped`);
  if (withoutName) bits.push(`${withoutName} without a match name were skipped`);
  return { feed: parsed.feed, matches: [...groups.values()], source: "sonyliv", note: bits.length ? `${bits.join("; ")}.` : "" };
}
