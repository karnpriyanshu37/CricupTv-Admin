"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Opt = { value: string; label: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Attach reusable Channels (with their stream URL) to a Competition.
 * Every match created under that competition automatically shows these as
 * its streaming sources — nothing to re-enter per match.
 */
export default function CompetitionChannels({ sb, competitions }: { sb: SupabaseClient; competitions: Opt[] }) {
  const [competitionId, setCompetitionId] = useState(competitions[0]?.value ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [allChannels, setAllChannels] = useState<Row[]>([]);
  const [addChannelId, setAddChannelId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!competitionId && competitions[0]) setCompetitionId(competitions[0].value); }, [competitions, competitionId]);

  const load = useCallback(async () => {
    if (!competitionId) return setRows([]);
    const [mapRes, channelsRes] = await Promise.all([
      sb.from("competition_channels").select("id, sort_order, player_slot, enabled, channel:channels(id,name,type,url,quality,language,enabled)").eq("competition_id", competitionId).order("sort_order"),
      sb.from("channels").select("id,name,type,url").order("name"),
    ]);
    if (mapRes.error) setMsg({ ok: false, text: mapRes.error.message });
    setRows(mapRes.data ?? []);
    setAllChannels(channelsRes.data ?? []);
  }, [sb, competitionId]);

  useEffect(() => { setMsg(null); void load(); }, [load]);

  const mappedIds = new Set(rows.map((r) => r.channel?.id));
  const available = allChannels.filter((c) => !mappedIds.has(c.id));

  const addMapping = async () => {
    if (!addChannelId) return;
    setBusy(true);
    const nextOrder = rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1;
    const { error } = await sb.from("competition_channels").insert({ competition_id: competitionId, channel_id: addChannelId, sort_order: nextOrder, player_slot: null });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setAddChannelId("");
    setMsg({ ok: true, text: "Channel attached." });
    await load();
  };

  const toggle = async (r: Row) => {
    const { error } = await sb.from("competition_channels").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) setMsg({ ok: false, text: error.message });
    await load();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Remove ${r.channel?.name ?? "this channel"} from this competition?`)) return;
    const { error } = await sb.from("competition_channels").delete().eq("id", r.id);
    if (error) setMsg({ ok: false, text: error.message });
    await load();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = rows[i], b = rows[i + dir];
    if (!a || !b) return;
    const [ao, bo] = [b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order, a.sort_order];
    const r1 = await sb.from("competition_channels").update({ sort_order: ao }).eq("id", a.id);
    const r2 = await sb.from("competition_channels").update({ sort_order: bo }).eq("id", b.id);
    if (r1.error || r2.error) setMsg({ ok: false, text: (r1.error ?? r2.error)!.message });
    await load();
  };

  if (!competitions.length) return <p className="muted">Create a competition first, then map its channels here.</p>;

  return (
    <div>
      <p className="muted">
        Pick a competition, then attach the channels it usually streams on. Every match you add under that
        competition will automatically show these as streaming sources — you only set this up once per competition.
      </p>
      <label className="form" style={{ maxWidth: 520 }}>
        <span>Competition</span>
        <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
          {competitions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>

      {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}

      {rows.length === 0 ? <p className="muted">No channels attached to this competition yet.</p> : (
        <ul className="admin-list">
          {rows.map((r, i) => {
            const c = r.channel;
            const broken = !c || !c.type || !c.url;
            return (
              <li key={r.id} className={r.enabled ? "" : "off"}>
                <div className="grow">
                  <strong>{c?.name ?? "(deleted channel)"}</strong>
                  <small>
                    {broken ? "Missing stream URL — edit this channel in the Channels tab" : `${c.type.toUpperCase()}, ${c.quality || "-"}${c.language ? `, ${c.language}` : ""}`}
                    {r.player_slot ? `, Player: Stream ${r.player_slot}` : ""}{r.enabled ? "" : ", Disabled"}
                  </small>
                </div>
                <select
                  aria-label={`Player button for ${c?.name ?? "channel"}`}
                  value={r.player_slot ? String(r.player_slot) : ""}
                  onChange={async (e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    if (value && rows.some((x) => x.id !== r.id && x.enabled !== false && Number(x.player_slot ?? 0) === value)) {
                      setMsg({ ok: false, text: `Stream ${value} is already assigned for this competition.` });
                      return;
                    }
                    const { error } = await sb.from("competition_channels").update({ player_slot: value }).eq("id", r.id);
                    if (error) setMsg({ ok: false, text: error.message });
                    await load();
                  }}
                  style={{ maxWidth: 145 }}
                >
                  <option value="">Player: Auto</option>
                  <option value="1">Player: Stream 1</option>
                  <option value="2">Player: Stream 2</option>
                </select>
                <button className="btn btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}>Up</button>
                <button className="btn btn-sm" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => void move(i, 1)}>Down</button>
                <button className="btn btn-sm" onClick={() => void toggle(r)}>{r.enabled ? "Disable" : "Enable"}</button>
                <button className="btn btn-sm btn-danger" onClick={() => void remove(r)}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="row-btns" style={{ marginTop: "1rem" }}>
        <select value={addChannelId} onChange={(e) => setAddChannelId(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">{available.length ? "Choose a channel to attach…" : "All channels already attached"}</option>
          {available.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.type || !c.url ? " (no stream URL yet)" : ""}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" disabled={!addChannelId || busy} onClick={() => void addMapping()}>Attach channel</button>
      </div>
    </div>
  );
}
