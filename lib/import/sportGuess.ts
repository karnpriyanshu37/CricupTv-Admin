/**
 * Some feeds file every match under "Other" even though the event name says what it is (e.g. "TENNIS | EVENTO").
 * This reads the competition / title / team names and returns the real sport name, or null when it can't tell.
 * The names match the sports of the website (slug = lower-case name with "-" between words).
 */
const RULES: [RegExp, string][] = [
  [/\bamerican football\b|\bnfl\b|\bncaa\b/, "American football"],
  [/\btennis\b|\batp\b|\bwta\b|\bgrand slam\b/, "Tennis"],
  [/\bcricket\b|\bt20\b|\bodi\b/, "Cricket"],
  [/\bbasketball\b|\bnba\b|\bwnba\b/, "Basketball"],
  [/\bbaseball\b|\bmlb\b/, "Baseball"],
  [/\bhockey\b|\bnhl\b/, "Hockey"],
  [/\bboxing\b/, "Boxing"],
  [/\bufc\b|\bmma\b/, "UFC"],
  [/\bformula (?:1|one)\b|\bf1\b/, "F1"],
  [/\bsoccer\b|\bfootball\b/, "Football"],
];

export function guessSportName(text: string): string | null {
  const t = text.toLowerCase();
  for (const [re, name] of RULES) if (re.test(t)) return name;
  return null;
}

export function sportSlugOf(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
