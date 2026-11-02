"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import ImageUpload from "./ImageUpload";
import { removeIfUnreferenced } from "@/lib/supabase/adminImages";
import { detectFromUrl } from "@/lib/player/detectStreamType";
import { cleanStreamUrlInput, isValidStreamUrl, parseDrm } from "@/lib/streams/validate";
import { iframeEmbedUrl } from "@/lib/player/iframeEmbed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Msg = { ok: boolean; text: string } | null;

/* ------------------------------------------------------------------ */
/* One linked row (a team or the competition): name and logo           */
/* ------------------------------------------------------------------ */

interface LinkedField { key: string; label: string; maxLength?: number }

/**
 * Lets the admin change the name and the logo of a team / competition right inside the match window.
 * The logo is saved the moment it is uploaded; the name needs the "Save" button of this block.
 * A competition is shared by all of its matches, so a change shows on every one of them.
 * A TEAM edited here changes THIS MATCH ONLY: when the team row is also used by another match, or by both sides of this
 * match, this side first gets its own copy of the row (and the match points to it), then the change is saved on the copy.
 * So editing Team 2 can never change Team 1, and never changes another match.
 */
function LinkedRowEditor({ sb, table, id, heading, folder, textFields, matchId, side, otherId, onReplace }: {
  sb: SupabaseClient; table: "teams" | "competitions"; id: string; heading: string; folder: string; textFields: LinkedField[];
  matchId?: string; side?: "team1_id" | "team2_id"; otherId?: string; onReplace?: (side: "team1_id" | "team2_id", newId: string) => void;
}) {
  const [row, setRow] = useState<Row | null>(null);
  const [values, setValues] = useState<Row>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setMsg(null);
    void sb.from(table).select("*").eq("id", id).maybeSingle().then(({ data }) => {
      if (!alive) return;
      setRow(data ?? null);
      setValues(Object.fromEntries(textFields.map((f) => [f.key, data?.[f.key] ?? ""])));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, table, id]);

  if (!row) return null;

  /** The id of the team row this match may change: its own row, copied first when the row is shared (see above). */
  const ownId = async (): Promise<string> => {
    if (table !== "teams" || !matchId || !side) return id;
    const { count, error: countError } = await sb.from("matches").select("id", { count: "exact", head: true })
      .or(`team1_id.eq.${id},team2_id.eq.${id}`).neq("id", matchId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) === 0 && otherId !== id) return id; // only this side of this match uses it
    const { id: _oldId, created_at: _c, updated_at: _u, ...copy } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { data: made, error: insertError } = await sb.from("teams").insert(copy).select().single();
    if (insertError || !made) throw new Error(insertError?.message ?? "Could not create the team copy.");
    const { error: moveError } = await sb.from("matches").update({ [side]: made.id }).eq("id", matchId);
    if (moveError) {
      await sb.from("teams").delete().eq("id", made.id);
      throw new Error(moveError.message);
    }
    onReplace?.(side, made.id);
    return made.id as string;
  };

  const setLogo = async (path: string | null) => {
    setBusy(true);
    setMsg(null);
    const old = row.logo_url as string | null;
    let error: { message: string } | null = null;
    try {
      const target = await ownId();
      error = (await sb.from(table).update({ logo_url: path }).eq("id", target)).error;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : "Could not save." };
    }
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setRow({ ...row, logo_url: path });
    if (old && old !== path) await removeIfUnreferenced(sb, old);
    setMsg({ ok: true, text: path ? "Logo saved." : "Logo removed." });
  };

  const saveText = async () => {
    const payload: Row = {};
    for (const f of textFields) payload[f.key] = String(values[f.key] ?? "").trim() || null;
    if (!payload.name) return setMsg({ ok: false, text: "Name is required." });
    setBusy(true);
    let error: { message: string } | null = null;
    try {
      const target = await ownId();
      error = (await sb.from(table).update(payload).eq("id", target)).error;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : "Could not save." };
    }
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setRow({ ...row, ...payload });
    setMsg({ ok: true, text: "Saved." });
  };

  return (
    <div className="detail-block">
      <h4>{heading}</h4>
      <div className="detail-grid">
        <div>
          {textFields.map((f) => (
            <label key={f.key}>{f.label}
              <input value={values[f.key] ?? ""} maxLength={f.maxLength ?? 80} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            </label>
          ))}
          <div className="row-btns">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void saveText()}>Save {heading.toLowerCase().startsWith("team") ? "team" : "name"}</button>
          </div>
        </div>
        <ImageUpload sb={sb} label="Logo" folder={folder} value={row.logo_url || null} onChange={(p) => void setLogo(p)} />
      </div>
      <small className="muted">{table === "teams" ? "Changes only this match." : "Used by every match of this competition."} The logo is saved as soon as you upload it.</small>
      {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Streaming links of this match                                       */
/* ------------------------------------------------------------------ */

const BLANK = { name: "", type: "hls", url: "", quality: "HD", language: "English", enabled: true, drm: "", player_slot: "" };
type StreamForm = typeof BLANK & { id?: string };

function MatchStreams({ sb, matchId, competitionId }: { sb: SupabaseClient; matchId: string; competitionId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [auto, setAuto] = useState<Row[]>([]);
  const [form, setForm] = useState<StreamForm | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("streams").select("*").eq("match_id", matchId).order("sort_order");
    if (error) setMsg({ ok: false, text: error.message });
    setRows(data ?? []);
  }, [sb, matchId]);

  useEffect(() => { setForm(null); void load(); }, [load]);

  // Channels that the competition adds to every one of its matches by itself (read only here).
  useEffect(() => {
    let alive = true;
    if (!competitionId) { setAuto([]); return; }
    void sb.from("competition_channels").select("id,enabled,player_slot,channels(name,quality,language,enabled)").eq("competition_id", competitionId).order("sort_order").then(({ data, error }) => {
      if (alive) setAuto(error ? [] : (data as Row[] | null) ?? []);
    });
    return () => { alive = false; };
  }, [sb, competitionId]);

  const edit = (r: Row) => setForm({ id: r.id, name: r.name, type: r.type, url: r.url, quality: r.quality ?? "", language: r.language ?? "", enabled: r.enabled, drm: r.drm ? JSON.stringify(r.drm, null, 2) : "", player_slot: r.player_slot ? String(r.player_slot) : "" });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return setMsg({ ok: false, text: "Stream name is required." });
    if (!isValidStreamUrl(form.url)) return setMsg({ ok: false, text: "Enter a valid http(s) stream URL without a username or password." });
    const detected = detectFromUrl(form.url);
    if (detected && detected !== form.type && !window.confirm(`The URL looks like ${detected.toUpperCase()} but the type is ${form.type.toUpperCase()}. Save anyway? (The type you choose is used for playback.)`)) return;
    const drm = parseDrm(form.drm.trim());
    if (!drm.ok) return setMsg({ ok: false, text: drm.error });

    const playerSlot = form.player_slot === "" ? null : Number(form.player_slot);
    if (playerSlot !== null && playerSlot !== 1 && playerSlot !== 2) return setMsg({ ok: false, text: "Player button must be Stream 1, Stream 2, or Auto." });
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
      : await sb.from("streams").insert({ ...payload, sort_order: rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1 });
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
    else setMsg({ ok: true, text: "Stream deleted." });
    await load();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = rows[i], b = rows[i + dir];
    if (!a || !b) return;
    const [ao, bo] = [b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order, a.sort_order];
    const r1 = await sb.from("streams").update({ sort_order: ao }).eq("id", a.id);
    const r2 = await sb.from("streams").update({ sort_order: bo }).eq("id", b.id);
    if (r1.error || r2.error) setMsg({ ok: false, text: (r1.error ?? r2.error)!.message });
    await load();
  };

  const autoRows = auto.filter((a) => a.channels);

  return (
    <div className="detail-block">
      <div className="section-head">
        <h4>Streaming links</h4>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { setForm({ ...BLANK, name: `Stream ${rows.length + 1}` }); setMsg(null); }}>Add stream</button>
      </div>
      {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
      {rows.length === 0 ? <p className="muted">No streams saved for this match yet.</p> : (
        <ul className="admin-list">
          {rows.map((r, i) => (
            <li key={r.id} className={r.enabled ? "" : "off"}>
              <div className="grow">
                <strong>{r.name}</strong>
                <small>{[r.player_slot ? `Button: Stream ${r.player_slot}` : "Button: Auto", String(r.type).toUpperCase(), r.quality, r.language, r.enabled ? "Enabled" : "Disabled"].filter(Boolean).join(", ")}</small>
                <small title={r.url}>{r.url}</small>
              </div>
              <button type="button" className="btn btn-sm" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => void move(i, -1)}>Up</button>
              <button type="button" className="btn btn-sm" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => void move(i, 1)}>Down</button>
              <button type="button" className="btn btn-sm" onClick={() => void toggle(r)}>{r.enabled ? "Disable" : "Enable"}</button>
              <button type="button" className="btn btn-sm" onClick={() => edit(r)}>Edit</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(r)}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="detail-stream-form">
          <strong>{form.id ? "Edit stream" : "New stream"}</strong>
          <label>Stream name<input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
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
            <input value={form.url} maxLength={4096} onChange={(e) => { const url = cleanStreamUrlInput(e.target.value); setForm({ ...form, url, type: iframeEmbedUrl(url) ? "hls" : form.type }); }} placeholder="https://… or <iframe src=&quot;https://www.youtube.com/embed/…&quot;>" />
          </label>
          {iframeEmbedUrl(form.url) && <small className="muted">Embed link recognised: it plays inside the provider&apos;s own player (YouTube / Rutube). Type does not matter here.</small>}
          <label>Playing-screen button
            <select value={form.player_slot} onChange={(e) => setForm({ ...form, player_slot: e.target.value })}>
              <option value="">Auto / not assigned</option><option value="1">Stream 1</option><option value="2">Stream 2</option>
            </select>
          </label>
          <label>Language<input value={form.language} maxLength={30} onChange={(e) => setForm({ ...form, language: e.target.value })} /></label>
          <label>DRM config (optional, only credentials supplied by the stream owner)
            <textarea rows={2} value={form.drm} onChange={(e) => setForm({ ...form, drm: e.target.value })} placeholder={'{"clearKeys":{"<KID>":"<KEY>"}}  OR  <KID>:<KEY>'} />
          </label>
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
          <div className="row-btns">
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save stream"}</button>
            <button type="button" className="btn btn-sm" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {autoRows.length > 0 && (
        <div className="detail-auto">
          <small className="muted">Also added automatically from the competition (change them in the Channels tab):</small>
          <ul>
            {autoRows.map((a) => (
              <li key={a.id} className={a.enabled && a.channels.enabled !== false ? "" : "off"}>
                {a.channels.name}
                <small>{[a.player_slot ? `Stream ${a.player_slot}` : "", a.channels.quality, a.channels.language].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      <small className="muted">Stream changes are saved as soon as you press “Save stream”, “Disable” or “Delete”; they do not wait for the Save button of the match.</small>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The whole panel shown inside "Edit match"                           */
/* ------------------------------------------------------------------ */

export default function MatchDetailsPanel({ sb, matchId, team1Id, team2Id, competitionId, onTeamReplaced }: {
  sb: SupabaseClient; matchId: string | null; team1Id: string; team2Id: string; competitionId: string;
  /** A side got its own copy of the team: the match form must use the new id (otherwise Save would put the old one back). */
  onTeamReplaced?: (side: "team1_id" | "team2_id", newId: string) => void;
}) {
  if (!matchId) {
    return <p className="muted detail-note">Save the match first. After that, open Edit again to add its streaming links and to change the team and competition logos here.</p>;
  }
  return (
    // Pressing Enter inside these boxes must not submit the match form behind them.
    <div className="match-detail" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <h3>All details of this match</h3>
      <MatchStreams sb={sb} matchId={matchId} competitionId={competitionId || null} />
      {team1Id && <LinkedRowEditor sb={sb} table="teams" id={team1Id} matchId={matchId} side="team1_id" otherId={team2Id} onReplace={onTeamReplaced} heading="Team 1" folder="teams" textFields={[{ key: "name", label: "Team name", maxLength: 60 }, { key: "short_name", label: "Short name", maxLength: 6 }]} />}
      {team2Id && <LinkedRowEditor sb={sb} table="teams" id={team2Id} matchId={matchId} side="team2_id" otherId={team1Id} onReplace={onTeamReplaced} heading="Team 2" folder="teams" textFields={[{ key: "name", label: "Team name", maxLength: 60 }, { key: "short_name", label: "Short name", maxLength: 6 }]} />}
      {competitionId && <LinkedRowEditor sb={sb} table="competitions" id={competitionId} heading="Competition" folder="competitions" textFields={[{ key: "name", label: "Competition name", maxLength: 80 }]} />}
    </div>
  );
}
