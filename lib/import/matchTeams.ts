/**
 * "Is this the same match?" helpers for the feed import.
 *
 * The three feeds (main, Tapmad, SonyLIV) write the same team differently ("Athletic" / "Athletic Club",
 * "Sporting Delhi" / "Sporting Club Delhi", "PSG" / "Paris Saint-Germain"), so exact name equality would create a
 * second card for the same match. These helpers compare names loosely, but keep men / women / youth / reserve
 * sides apart (so "Zimbabwe" is never merged with "Zimbabwe Women").
 */

// Words that carry no identity ("FC", "Club", "AC", ...).
const STOP = new Set(["fc", "cf", "sc", "ac", "afc", "fk", "sk", "cd", "ud", "club", "de", "the", "of", "and", "as", "ss", "sv", "rc", "bk", "if", "ik"]);

// Sides that must be equal on both names: a women's / youth / reserve side is a different team.
const QUALIFIERS = new Set(["women", "womens", "woman", "ladies", "reserve", "reserves", "ii", "iii", "b", "academy", "youth", "junior", "juniors", "castilla"]);

// Whole-name aliases (after lower-casing, accents and punctuation removed).
const PHRASES: Record<string, string> = {
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  losc: "lille",
  "losc lille": "lille",
  "lille osc": "lille",
  inter: "inter milan",
  internazionale: "inter milan",
  "man utd": "manchester united",
  "man united": "manchester united",
  "man city": "manchester city",
  spurs: "tottenham hotspur",
  tottenham: "tottenham hotspur",
  wolves: "wolverhampton wanderers",
  newcastle: "newcastle united",
  "west ham": "west ham united",
  leeds: "leeds united",
  brighton: "brighton hove albion",
  atletico: "atletico madrid",
  "atl madrid": "atletico madrid",
  celta: "celta vigo",
  bayern: "bayern munich",
  "bayern munchen": "bayern munich",
  dortmund: "borussia dortmund",
  gladbach: "borussia monchengladbach",
  leverkusen: "bayer leverkusen",
  usa: "united states",
  "usa women": "united states women",
  uae: "united arab emirates",
};

// Single-word aliases.
const TOKEN_ALIAS: Record<string, string> = { utd: "united", intl: "international", st: "saint" };

function baseName(value: string): string {
  let s = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/\bunder[\s-]?(\d{2})s?\b/g, "u$1");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return PHRASES[s] ?? s;
}

export type TeamTokens = { core: string[]; qual: string[] };

const tokenCache = new Map<string, TeamTokens>();

export function teamTokens(name: string): TeamTokens {
  const hit = tokenCache.get(name);
  if (hit) return hit;
  const core: string[] = [];
  const qual: string[] = [];
  for (const raw of baseName(name).split(" ")) {
    if (!raw) continue;
    const t = TOKEN_ALIAS[raw] ?? raw;
    if (QUALIFIERS.has(t) || /^u\d{2}$/.test(t)) qual.push(t);
    else if (t.length > 1 && !STOP.has(t)) core.push(t);
  }
  const out = { core, qual: qual.sort() };
  tokenCache.set(name, out);
  return out;
}

function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a));
}

/** Every token of `small` has its own partner in `big`. */
function covers(small: string[], big: string[]): boolean {
  const used = new Set<number>();
  for (const t of small) {
    const i = big.findIndex((u, idx) => !used.has(idx) && tokenEq(t, u));
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}

/** True when two team names are the same team. */
export function teamsMatch(a: string, b: string): boolean {
  const x = teamTokens(a);
  const y = teamTokens(b);
  if (!x.core.length || !y.core.length) return false;
  if (x.qual.join(",") !== y.qual.join(",")) return false;
  const [s, l] = x.core.length <= y.core.length ? [x.core, y.core] : [y.core, x.core];
  if (s.length === l.length) return covers(s, l);
  // "Newcastle" / "Newcastle United": a one-word name is the first word of the longer one.
  if (s.length === 1) return l.length <= 3 && tokenEq(s[0], l[0]);
  // "Sporting Delhi" / "Sporting Club Delhi" style: at most one extra word.
  return l.length - s.length <= 1 && covers(s, l);
}

/** Both sides present, different, and not a "TBD" placeholder. */
export function validPair(a: string, b: string): boolean {
  const x = teamTokens(a);
  const y = teamTokens(b);
  if (!x.core.length || !y.core.length) return false;
  const j = (t: TeamTokens) => [...t.core, ...t.qual].join(" ");
  return j(x) !== j(y) && x.core.join(" ") !== "tbd" && y.core.join(" ") !== "tbd";
}

export function pairsMatch(a1: string, b1: string, a2: string, b2: string): boolean {
  return (teamsMatch(a1, a2) && teamsMatch(b1, b2)) || (teamsMatch(a1, b2) && teamsMatch(b1, a2));
}

/** Order-independent key of a whole match title, for events that have no two teams ("Open de Espana - Day 3"). */
export function titleKey(title: string): string {
  return baseName(title)
    .split(" ")
    .filter((t) => t && !STOP.has(t) && t !== "vs" && t !== "v" && t !== "versus")
    .sort()
    .join(" ");
}

/** Sport name -> a short key, or "" when it is not one of the well-known sports. Used to avoid merging different sports. */
export function canonSport(name: string): string {
  const t = baseName(name);
  if (!t) return "";
  if (/american football|\bnfl\b|\bncaa\b/.test(t)) return "american football";
  if (/table tennis/.test(t)) return "table tennis";
  if (/\b(football|soccer)\b/.test(t)) return "football";
  if (/\bcricket\b/.test(t)) return "cricket";
  if (/\btennis\b/.test(t)) return "tennis";
  if (/\bbasketball\b/.test(t)) return "basketball";
  if (/\bbaseball\b/.test(t)) return "baseball";
  if (/\bhockey\b/.test(t)) return "hockey";
  if (/\bgolf\b/.test(t)) return "golf";
  if (/\bboxing\b/.test(t)) return "boxing";
  if (/\b(ufc|mma)\b/.test(t)) return "ufc";
  if (/\brugby\b/.test(t)) return "rugby";
  if (/\bvolleyball\b/.test(t)) return "volleyball";
  if (/\bbadminton\b/.test(t)) return "badminton";
  if (/\b(f1|formula|motorsports?|racing)\b/.test(t)) return "motor";
  return "";
}

/**
 * How many days apart two listings of the same match may be and still count as one match.
 * A Test match lasts days and the feeds do not agree on which day they list, so Tests get a wider window
 * (two Tests of one series start 5+ days apart). Everything else: 1 day.
 */
export function testDay(sport: string, text: string): boolean {
  return canonSport(sport) === "cricket" && /\b(test|first[- ]class|4[- ]day|four[- ]day)\b/i.test(text);
}
export const sameMatchWindow = (aIsTest: boolean, bIsTest: boolean) => (aIsTest && bIsTest ? 3 : 1);
