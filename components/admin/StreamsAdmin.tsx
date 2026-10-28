"use client";

import FormModal from "./FormModal";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectFromUrl } from "@/lib/player/detectStreamType";
import { cleanStreamUrlInput, isValidStreamUrl, parseDrm } from "@/lib/streams/validate";
import { iframeEmbedUrl } from "@/lib/player/iframeEmbed";

type Opt = { value: string; label: string; sportId?: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const blank = { name: "", type: "hls", url: "", quality: "HD", language: "English", enabled: true, drm: "", player_slot: "" };

export default function StreamsAdmin({ sb, matches: allMatches, sports = [] }: { sb: SupabaseClient; matches: Opt[]; sports?: Opt[] }) {
  // Sport buttons (Cricket, Football, UFC…) narrow the match list below; taken from the Sports tab.
  const [sportId, setSportId] = useState<string | null>(null);
  const matches = useMemo(() => (sportId ? allMatches.filter((m) => m.sportId === sportId) : allMatches), [allMatches, sportId]);
  const countFor = (id: string | null) => (id ? allMatches.filter((m) => m.sportId === id).length : allMatches.length);
  const [matchId, setMatchId] = useState(allMatches[0]?.value ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<(typeof blank & { id?: string }) | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // If the chosen match is not in the filtered list any more, jump to the first match of that sport.
  useEffect(() => {
    if (!matches.some((m) => m.value === matchId)) setMatchId(matches[0]?.value ?? "");
  }, [matches, matchId]);

  const load = useCallback(async () => {
    if (!matchId) return setRows([]);
    const { data, error } = await sb.from("streams").select("*").eq("match_id", matchId).order("sort_order");
    if (error) setMsg({ ok: false, text: error.message });
    setRows(data ?? []);
  }, [sb, matchId]);

  useEffect(() => { setForm(null); void load(); }, [load]);

  const edit = (r: Row) => setForm({ id: r.id, name: r.name, type: r.type, url: r.url, quality: r.quality ?? "", language: r.language ?? "", enabled: r.enabled, drm: r.drm ? JSON.stringify(r.drm, null, 2) : "", player_slot: r.player_slot ? String(r.player_slot) : "" });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) return setMsg({ ok: false, text: "Stream name is required." });
    if (!isValidStreamUrl(form.url)) return setMsg({ ok: false, text: "Enter a valid http(s) stream URL without a username or password." });
    const detected = detectFromUrl(form.url);
    if (detected && detected !== form.type && !window.confirm(`The URL looks like ${detected.toUpperCase()} but the type is ${form.type.toUpperCase()}. Save anyway? (The type you choose is used for playback.)`)) return;
    const drm = parseDrm(form.drm.trim());
    if (!drm.ok) return setMsg({ ok: false, text: drm.error });

    const playerSlot = form.player_slot === "" ? null : Number(form.player_slot);
    if (playerSlot !== null && playerSlot !== 1 && playerSlot !== 2) return setMsg({ ok: false, text: "Player button must be Stream 1, Stream 2, or Not assigned." });
    if (playerSlot !== null) {
      const duplicate = rows.find((r) => r.id !== form.id && Number(r.player_slot ?? 0) === playerSlot && r.enabled !== false);
      if (duplicate && !window.confirm(`Player ${playerSlot} is already assigned to “${duplicate.name}”. Replace that assignment?`)) return;
      if (duplicate) {
        const { error: clearError } = await sb.from("streams").update({ player_slot: null }).eq("id", duplicate.id);
        if (clearError) return setMsg({ ok: false, text: clearError.message });
      }
    }

    const payload = { match_id: matchId, name: form.name.trim(), type: form.type === "mpd" ? "dash" : form.type, url: form.url.trim(), quality: form.quality.trim() || null, language: form.language.trim() || null, enabled: form.enabled, drm: drm.value, player_slot: playerSlot };
    setSaving(true);
    const { error } = form.id
      ? await sb.from("streams").update(payload).eq("id", form.id)
      : await sb.from("streams").insert({ ...payload, sort_order: (rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0)) + 1 });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setForm(null);
    setMsg({ ok: true, text: "Stream saved." });
    await load();
  };

  const toggle = async (r: Row) => {
    const { error } = await sb.from("streams").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) setMsg({ ok: false, text: error.message });
    await load();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete stream “${r.name}”?`)) return;
    const { error } = await sb.from("streams").delete().eq("id", r.id);
    if (error) setMsg({ ok: false, text: error.message });
    await load();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = rows[i], b = rows[i + dir];
    if (!a || !b) return;
    // Give both a fresh, distinct order so equal values never block the swap.
    const [ao, bo] = [b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order, a.sort_order];
    const r1 = await sb.from("streams").update({ sort_order: ao }).eq("id", a.id);
    const r2 = await sb.from("streams").update({ sort_order: bo }).eq("id", b.id);
    if (r1.error || r2.error) setMsg({ ok: false, text: (r1.error ?? r2.error)!.message });
    await load();
  };

  if (!allMatches.length) return <p className="muted">Create a match first, then add its streams here.</p>;

  return (
    <div>
      <p className="muted">
        Most matches don&apos;t need this: if a match&apos;s competition already has channels attached (see
        Channel mapping), those show up automatically. Only add a stream here for something extra or
        match-specific that isn&apos;t covered by the competition&apos;s usual channels.
      </p>
      {sports.length > 0 && (
        <div className="sport-filter" role="group" aria-label="Filter matches by sport">
          <button type="button" className={`sport-btn ${sportId === null ? "active" : ""}`} onClick={() => setSportId(null)}>
            All sports <span className="status-count">{countFor(null)}</span>
          </button>
          {sports.map((o) => (
            <button key={o.value} type="button" className={`sport-btn ${sportId === o.value ? "active" : ""}`} onClick={() => setSportId(o.value)}>
              {o.label} <span className="status-count">{countFor(o.value)}</span>
            </button>
          ))}
        </div>
      )}
      <label className="form" style={{ maxWidth: 520 }}>
        <span>Match</span>
        <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
          {matches.length === 0 && <option value="">No matches in this sport</option>}
          {matches.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      {matches.length === 0 && <p className="muted">No matches for this sport yet.</p>}

      <div className="admin-layout admin-single">
        <div>
          <div className="section-head">
            <h2>Streams</h2>
            <button className="btn btn-primary btn-sm" disabled={!matchId} onClick={() => { setForm({ ...blank, name: `Stream ${rows.length + 1}` }); setMsg(null); }}>Add stream</button>
          </div>
          {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
          {rows.length === 0 ? <p className="muted">No streams for this match yet.</p> : (
            <ul className="admin-list">
              {rows.map((r, i) => (
                <li key={r.id} className={r.enabled ? "" : "off"}>
                  <div className="grow">
                    <strong>{r.name}</strong>
                    <small>{[r.player_slot ? `Player: Stream ${r.player_slot}` : "Player: Auto", r.type.toUpperCase(), r.quality, r.language, r.enabled ? "Enabled" : "Disabled"].filter(Boolean).join(", ")}</small>
                  </div>
                  <button className="btn btn-sm" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}>Up</button>
                  <button className="btn btn-sm" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => void move(i, 1)}>Down</button>
                  <button className="btn btn-sm" onClick={() => void toggle(r)}>{r.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn btn-sm" onClick={() => edit(r)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(r)}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {form && (
          <FormModal label={form.id ? "Edit stream" : "New stream"} onClose={() => setForm(null)}>
          <form className="form card" onSubmit={save}>
            <h2>{form.id ? "Edit stream" : "New stream"}</h2>
            <label>Stream name<input value={form.name} maxLength={60} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <div className="row">
              <label>Type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="dash">DASH / MPD</option>
                </select>
              </label>
              <label>Quality<input value={form.quality} maxLength={12} onChange={(e) => setForm({ ...form, quality: e.target.value })} /></label>
            </div>
            <label>Stream URL (or a YouTube link / the whole YouTube embed code)
              <input value={form.url} type="text" required maxLength={4096} onChange={(e) => { const url = cleanStreamUrlInput(e.target.value); setForm({ ...form, url, type: iframeEmbedUrl(url) ? "hls" : form.type }); }} placeholder="https://… or <iframe src=&quot;https://www.youtube.com/embed/…&quot;>" />
            </label>
            {iframeEmbedUrl(form.url) && <small className="muted">Embed link recognised: it plays inside the provider&apos;s own player (YouTube / Rutube). Type does not matter here.</small>}
            <label>Playing-screen button<select value={form.player_slot} onChange={(e) => setForm({ ...form, player_slot: e.target.value })}><option value="">Auto / not assigned</option><option value="1">Stream 1</option><option value="2">Stream 2</option></select></label>
            <label>Language<input value={form.language} maxLength={30} onChange={(e) => setForm({ ...form, language: e.target.value })} /></label>
            <label>DRM config (optional JSON, only credentials supplied by the stream owner)
              <textarea rows={3} value={form.drm} onChange={(e) => setForm({ ...form, drm: e.target.value })} placeholder={'{"clearKeys":{"<KID>":"<KEY>"}}  OR  <KID>:<KEY>'} />
            </label>
            <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
            <div className="row-btns">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save stream"}</button>
              <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
          </FormModal>
        )}
      </div>
    </div>
  );
}
