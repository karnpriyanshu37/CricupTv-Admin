import { detectFromUrl } from "@/lib/player/detectStreamType";
import { iframeEmbedUrl } from "@/lib/player/iframeEmbed";
import { parseDrm } from "@/lib/streams/validate";

export interface FeedStream {
  channel_name?: unknown;
  name?: unknown;
  stream_url?: unknown;
  url?: unknown;
  type?: unknown;
  stream_type?: unknown;
  quality?: unknown;
  language?: unknown;
  kid?: unknown;
  key?: unknown;
  drm?: unknown;
  clearKeys?: unknown;
  player_slot?: unknown;
  playerSlot?: unknown;
  slot?: unknown;
  referer?: unknown;
  user_agent?: unknown;
  userAgent?: unknown;
  [key: string]: unknown;
}

export interface FeedMatch {
  status?: unknown;
  Category?: unknown;
  category?: unknown;
  sport?: unknown;
  event_name?: unknown;
  name?: unknown;
  eventInfo?: Record<string, unknown>;
  streams?: FeedStream[];
  [key: string]: unknown;
}

export interface SportsFeed {
  name?: unknown;
  owner?: unknown;
  telegram_channel?: unknown;
  last_update_time?: unknown;
  total_matches?: unknown;
  live_match?: unknown;
  matches?: FeedMatch[];
}

export interface ParsedFeed {
  feed: SportsFeed;
  matches: FeedMatch[];
  /** which feed it came from (set by feedAdapters) */
  source?: string;
  /** a short note for the import report (e.g. items that were skipped) */
  note?: string;
}

export function cleanFeedText(input: string): string {
  return input
    .replace(/&#x20;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function unwrapUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const markdown = trimmed.match(/^\[.*?\]\((https?:\/\/[^)]+)\)$/i);
  return markdown ? markdown[1].trim() : trimmed;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function normalizeName(value: unknown): string {
  return text(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "sport";
}

export function parseJsonFeed(raw: string): ParsedFeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanFeedText(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Could not parse JSON: ${message}`);
  }

  // A bare list (the SonyLIV feed) is a feed with no header.
  if (Array.isArray(parsed)) parsed = { matches: parsed };
  const feed = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed as SportsFeed : null;
  if (!feed) throw new Error("JSON root must be an object.");
  if (!Array.isArray(feed.matches)) throw new Error("JSON must contain a matches array.");

  return { feed, matches: feed.matches.filter((m): m is FeedMatch => !!m && typeof m === "object") };
}

export function statusOf(value: unknown): "LIVE" | "UPCOMING" | "FINISHED" {
  const s = normalizeName(value).replace(/ /g, "_");
  if (s === "live" || s === "in_progress" || s === "ongoing") return "LIVE";
  if (s === "finished" || s === "ended" || s === "complete" || s === "completed") return "FINISHED";
  return "UPCOMING";
}

function pad(n: number) { return String(n).padStart(2, "0"); }

/**
 * The JSON feeds give Bangladesh-time wall-clock times (UTC+6). Checked against real kick-offs: Bundesliga 15:30 CEST is
 * 19:30 in the feed, Premier League 12:30 BST is 17:30, a Test day starts 11:30 for 09:30 in the UAE. (The Tapmad adapter
 * brings its own column to the same clock.) The website works in Nepal time, UTC+5:45 all year, which is 15 minutes
 * behind Bangladesh, so every feed time moves back by 15 minutes. A date without a time stays as it is.
 */
export const FEED_TO_NEPAL_MIN = -15;
export function utcToNepal(when: { date: string | null; time: string | null }): { date: string | null; time: string | null } {
  if (!when.date || !when.time) return when;
  const [y, mo, d] = when.date.split("-").map(Number);
  const [h, mi, s] = when.time.split(":").map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s || 0) + FEED_TO_NEPAL_MIN * 60_000;
  if (Number.isNaN(ms)) return when;
  const t = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`,
    time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`,
  };
}

export function parseStartTime(value: unknown): { date: string | null; time: string | null } {
  const raw = text(value);
  if (!raw) return { date: null, time: null };

  // ISO / browser-readable formats. We intentionally extract the clock/date
  // from the parsed value rather than converting to a different timezone.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [datePart, timePart = ""] = raw.split(/[T ]/, 2);
    const m = timePart.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
    return { date: /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null, time: m ? `${m[1]}:${m[2]}:${m[3] ?? "00"}` : null };
  }

  // DD/MM/YYYY 10:00:00 PM (the format used in the supplied example).
  const m12 = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m12) {
    let hour = Number(m12[4]);
    const minute = Number(m12[5]);
    const second = Number(m12[6] ?? 0);
    const ap = (m12[7] ?? "").toUpperCase();
    if (ap === "AM") hour = hour === 12 ? 0 : hour;
    if (ap === "PM") hour = hour === 12 ? 12 : hour + 12;
    const day = Number(m12[1]);
    const month = Number(m12[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && hour <= 23 && minute <= 59 && second <= 59) {
      return { date: `${m12[3]}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}:${pad(second)}` };
    }
  }

  // YYYY/MM/DD or YYYY-MM-DD with optional time.
  const m24 = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m24) {
    return { date: `${m24[1]}-${pad(Number(m24[2]))}-${pad(Number(m24[3]))}`, time: `${pad(Number(m24[4]))}:${m24[5]}:${m24[6] ?? "00"}` };
  }

  return { date: null, time: null };
}

export function teamNames(match: FeedMatch): { a: string; b: string } {
  const info = match.eventInfo ?? {};
  let a = text(info.teamA ?? info.team1 ?? info.homeTeam ?? info.home);
  let b = text(info.teamB ?? info.team2 ?? info.awayTeam ?? info.away);
  if (a && b) return { a, b };

  const event = text(match.event_name ?? match.name);
  const parts = event.split(/\s+(?:vs\.?|v\.?|versus)\s+/i);
  if (parts.length >= 2) return { a: parts[0].trim(), b: parts.slice(1).join(" vs ").trim() };
  return { a: a || "TBD", b: b || "TBD" };
}

export function streamUrl(stream: FeedStream): string {
  return unwrapUrl(stream.stream_url ?? stream.url);
}

export function streamType(stream: FeedStream, url: string): "hls" | "dash" | null {
  const raw = normalizeName(stream.stream_type ?? stream.type);
  if (raw === "hls") return "hls";
  if (raw === "dash" || raw === "mpd" || raw === "mpeg dash") return "dash";
  const detected = detectFromUrl(url);
  if (detected === "dash") return "dash";
  if (detected === "hls") return "hls";
  // Rutube-style links (no .m3u8/.mpd) are accepted too: the website plays them in the provider's embed player.
  return iframeEmbedUrl(url) ? "hls" : null;
}

export function streamDrm(stream: FeedStream) {
  let raw: unknown = stream.drm;
  if (raw == null && stream.clearKeys != null) raw = { clearKeys: stream.clearKeys };
  if (raw == null && text(stream.kid) && text(stream.key)) raw = { clearKeys: { [text(stream.kid)]: text(stream.key) } };
  return parseDrm(raw);
}

export function playerSlot(stream: FeedStream): 1 | 2 | null {
  const value = Number(stream.player_slot ?? stream.playerSlot ?? stream.slot ?? 0);
  return value === 1 || value === 2 ? value : null;
}
