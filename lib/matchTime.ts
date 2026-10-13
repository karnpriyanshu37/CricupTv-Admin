/**
 * Match dates/times are stored as plain "wall clock" values (e.g. 2026-10-08 19:30) with no time zone.
 * They are in MATCH_TIME_ZONE (Nepal time by default). Servers like Vercel run in UTC, so comparing the
 * wall clock with the server clock directly is hours off; this turns the stored value into a real moment in time.
 * Change it with the NEXT_PUBLIC_MATCH_TIME_ZONE environment variable (any IANA name, e.g. "Asia/Kolkata").
 */
export const MATCH_TIME_ZONE = process.env.NEXT_PUBLIC_MATCH_TIME_ZONE || "Asia/Kathmandu";

function offsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/** Real time (ms since 1970) of a stored match date + time. NaN when the value is not a valid date. */
export function matchStartMs(date: string, time?: string | null, fallbackTime = "00:00"): number {
  const t = time ? String(time).slice(0, 5) : fallbackTime;
  const wall = Date.parse(`${date}T${t}:00Z`);
  if (Number.isNaN(wall)) return NaN;
  try {
    let ms = wall - offsetMs(wall, MATCH_TIME_ZONE);
    const again = offsetMs(ms, MATCH_TIME_ZONE);
    if (wall - again !== ms) ms = wall - again; // daylight-saving edge
    return ms;
  } catch {
    return new Date(`${date}T${t}:00`).getTime(); // unknown zone name: fall back to the machine's clock
  }
}
