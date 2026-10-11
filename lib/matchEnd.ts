import { matchStartMs } from "./matchTime";

/**
 * Hours after kickoff when a match counts as ended automatically, or null = never (Test matches:
 * those are ended from the JSON or by hand).
 *  - football and every other sport: 5h
 *  - cricket T20 (and cricket with no format in its name): 6h
 *  - cricket ODI: 9h
 *  - cricket Test / first-class: never automatic
 * Same rule as the public website, so both always agree.
 */
export function autoEndHours(sport: string, competition: string, title: string): number | null {
  const text = `${competition} ${title}`.toLowerCase();
  const isCricket = sport.toLowerCase().includes("cricket") || /\bcricket\b/.test(text);
  if (!isCricket) return 5;
  if (/\b(test|first[- ]class|4[- ]day|four[- ]day|ranji|sheffield|county championship)\b/.test(text)) return null;
  if (/\b(odi|one[- ]day|50[- ]over)\b/.test(text)) return 9;
  return 6;
}

/** Finished matches are deleted for good this long after they ended. */
export const FINISHED_KEEP_MS = 3 * 60 * 60 * 1000;

/** The moment (ms) an UPCOMING / LIVE match counts as ended, or null when it never ends by itself. */
export function autoEndAtMs(
  m: { status?: string; match_date?: string | null; match_time?: string | null },
  sport: string,
  competition: string,
  title: string,
): number | null {
  if (m.status === "FINISHED" || !m.match_date) return null;
  const hours = autoEndHours(sport, competition, title);
  if (hours === null) return null;
  const start = matchStartMs(m.match_date, m.match_time, "23:59");
  if (Number.isNaN(start)) return null;
  return start + hours * 3600_000;
}

/** True when an UPCOMING / LIVE match is past its auto-end time. */
export function isAutoEnded(
  m: { status?: string; match_date?: string | null; match_time?: string | null },
  sport: string,
  competition: string,
  title: string,
): boolean {
  const end = autoEndAtMs(m, sport, competition, title);
  return end !== null && Date.now() >= end;
}

/** True when an UPCOMING match with a start time has reached that time (it counts as LIVE; check "ended" first). */
export function isAutoLive(m: { status?: string; match_date?: string | null; match_time?: string | null }): boolean {
  if (m.status !== "UPCOMING" || !m.match_date || !m.match_time) return false;
  const start = matchStartMs(m.match_date, m.match_time, "00:00");
  return !Number.isNaN(start) && Date.now() >= start;
}
