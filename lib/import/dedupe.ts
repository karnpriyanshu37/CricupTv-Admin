import type { SupabaseClient } from "@supabase/supabase-js";
import { canonSport, pairsMatch, sameMatchWindow, testDay, titleKey, validPair } from "@/lib/import/matchTeams";
import { normalizeName } from "@/lib/import/sportsJson";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function daysApart(d1: string | null, d2: string | null): number {
  if (!d1 || !d2) return 0;
  const t1 = Date.parse(`${d1}T00:00:00Z`), t2 = Date.parse(`${d2}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.abs(Math.round((t1 - t2) / 86400000));
}

/**
 * Finds match cards that are the same match (same two teams in either order, spelled loosely, within a day or
 * so, same sport) and merges each group into ONE card. The card with the most streaming links stays (on a tie,
 * the older one); the other cards' links are moved onto it, then the extra cards are deleted.
 * Returns how many cards were merged away. It only ever touches cards the import would also have treated as the same match.
 */
export async function mergeDuplicateMatches(sb: SupabaseClient): Promise<number> {
  const [matchesRes, teamsRes, sportsRes, compsRes, streamsRes] = await Promise.all([
    sb.from("matches").select("*").limit(2000),
    sb.from("teams").select("id,name"),
    sb.from("sports").select("id,name"),
    sb.from("competitions").select("id,name"),
    sb.from("streams").select("*").limit(20000),
  ]);
  for (const r of [matchesRes, teamsRes, sportsRes, compsRes, streamsRes]) if (r.error) throw new Error(r.error.message);
  const matches = (matchesRes.data ?? []) as Row[];
  if (matches.length < 2) return 0;
  const teamName = new Map<string, string>(((teamsRes.data ?? []) as Row[]).map((r) => [r.id, r.name]));
  const sportName = new Map<string, string>(((sportsRes.data ?? []) as Row[]).map((r) => [r.id, r.name]));
  const compName = new Map<string, string>(((compsRes.data ?? []) as Row[]).map((r) => [r.id, r.name]));
  const streamsByMatch = new Map<string, Row[]>();
  for (const s of (streamsRes.data ?? []) as Row[]) {
    const list = streamsByMatch.get(s.match_id) ?? [];
    list.push(s);
    streamsByMatch.set(s.match_id, list);
  }

  type Item = { row: Row; a: string; b: string; title: string; tk: string; sport: string; test: boolean; n: number };
  const items: Item[] = matches.map((r) => {
    const sp = sportName.get(r.sport_id) ?? "";
    return {
      row: r,
      a: teamName.get(r.team1_id) ?? "",
      b: teamName.get(r.team2_id) ?? "",
      title: r.title ?? "",
      tk: titleKey(r.title ?? ""),
      sport: canonSport(sp),
      test: testDay(sp, `${compName.get(r.competition_id) ?? ""} ${r.title ?? ""}`),
      n: (streamsByMatch.get(r.id) ?? []).length,
    };
  });
  // The card that stays comes first: most streams, then the oldest.
  items.sort((x, y) => y.n - x.n || String(x.row.created_at ?? "").localeCompare(String(y.row.created_at ?? "")));

  const same = (k: Item, d: Item): boolean => {
    if (k.sport && d.sport && k.sport !== d.sport) return false;
    const gap = daysApart(k.row.match_date ?? null, d.row.match_date ?? null);
    const bothPairs = validPair(k.a, k.b) && validPair(d.a, d.b);
    if (bothPairs && pairsMatch(k.a, k.b, d.a, d.b)) return gap <= sameMatchWindow(k.test, d.test);
    // No two teams to compare (a race, a show): the same title on the same day only.
    return !!k.tk && k.tk === d.tk && normalizeName(k.title) !== "" && gap === 0;
  };

  const gone = new Set<string>();
  let merged = 0;
  for (let i = 0; i < items.length; i++) {
    const keep = items[i];
    if (gone.has(keep.row.id)) continue;
    for (let j = i + 1; j < items.length; j++) {
      const dup = items[j];
      if (gone.has(dup.row.id) || !same(keep, dup)) continue;

      const keepStreams = streamsByMatch.get(keep.row.id) ?? [];
      const urls = new Set(keepStreams.map((s) => String(s.url ?? "")));
      const names = new Set(keepStreams.map((s) => normalizeName(s.name)));
      const slots = new Set(keepStreams.map((s) => s.player_slot).filter((x) => x === 1 || x === 2));
      let sort = keepStreams.reduce((m, s) => Math.max(m, Number(s.sort_order ?? 0)), 0);
      for (const s of streamsByMatch.get(dup.row.id) ?? []) {
        // The same link / channel name is already on the card that stays: that stream is not needed twice.
        if (urls.has(String(s.url ?? "")) || names.has(normalizeName(s.name))) continue;
        const slot = (s.player_slot === 1 || s.player_slot === 2) && !slots.has(s.player_slot) ? s.player_slot : null;
        if (slot) slots.add(slot);
        sort += 1;
        const { error } = await sb.from("streams").update({ match_id: keep.row.id, sort_order: sort, player_slot: slot }).eq("id", s.id);
        if (error) throw new Error(`Could not move stream “${s.name}”: ${error.message}`);
        urls.add(String(s.url ?? ""));
        names.add(normalizeName(s.name));
        keep.n += 1;
      }
      if (dup.row.is_hot === true && keep.row.is_hot !== true) {
        const { error } = await sb.from("matches").update({ is_hot: true }).eq("id", keep.row.id);
        if (!error) keep.row.is_hot = true;
      }
      // Streams that were not moved are deleted together with the card (on delete cascade).
      const { error } = await sb.from("matches").delete().eq("id", dup.row.id);
      if (error) throw new Error(`Could not remove the duplicate card “${dup.title}”: ${error.message}`);
      gone.add(dup.row.id);
      merged++;
    }
  }
  return merged;
}
