"use client";

import FormModal from "./FormModal";
import { autoEndAtMs, FINISHED_KEEP_MS, isAutoEnded, isAutoLive } from "@/lib/matchEnd";
import { matchStartMs } from "@/lib/matchTime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import ImageUpload from "./ImageUpload";
import MatchDetailsPanel from "./MatchDetailsPanel";
import { removeIfUnreferenced } from "@/lib/supabase/adminImages";
import { imageUrl } from "@/lib/supabase/storage";
import { cleanStreamUrlInput, isValidStreamUrl } from "@/lib/streams/validate";
import { iframeEmbedUrl } from "@/lib/player/iframeEmbed";
import { detectFromUrl } from "@/lib/player/detectStreamType";

type Opt = { value: string; label: string; /** the row is switched off (shown as "(OFF)" in drop-downs) */ off?: boolean };
export type Field = {
  key: string;
  label: string;
  type: "text" | "select" | "image" | "date" | "time" | "number" | "checkbox" | "url" | "textarea";
  required?: boolean;
  /** Starting value of a new row (checkboxes otherwise start ticked). */
  defaultValue?: boolean | string;
  rows?: number;
  options?: Opt[];
  /** for select: key in the refs map */
  ref?: string;
  folder?: string;
  maxMB?: number;
  /** For image fields: crop box ratio (default 1, square) and shape (default round). */
  aspect?: number;
  round?: boolean;
  maxLength?: number;
  placeholder?: string;
  /** For a "url" field: the key of a sibling select field (hls/dash) to check
   *  against the URL's own extension. If they disagree, saving asks the admin
   *  to confirm rather than silently keeping a probably-wrong type. */
  detectMismatchWith?: string;
  /** For a select tied to `ref`: lets the admin create a new row in that
   *  table right here (e.g. add a Team while filling in a Match) instead of
   *  leaving the form to use that table's own tab first. */
  quickAdd?: {
    table: string;
    title: string;
    fields: Field[];
    /** copy this form's `sport_id` (or given key) onto the new row, if the target table has that column */
    inheritSportFrom?: string;
  };
};

export type EntityConfig = {
  table: string;
  title: string;
  fields: Field[];
  orderBy: string;
  label: (row: Row) => string;
  sub?: (row: Row) => string;
  imageKey?: string;
  /** Show one button per value of `key` (e.g. Live / Upcoming / Ended); only the selected status is listed. */
  /** Matches: UPCOMING / LIVE rows past their auto-end time are listed as Ended (same rule as the website). */
  autoEnd?: boolean;
  /** Matches: a row of sport buttons (taken from the Sports tab, so new sports appear by themselves). */
  sportFilter?: boolean;
  /** A one-click on/off button on every row (e.g. Hot). Saves straight to the database. */
  rowToggle?: { key: string; on: string; off: string };
  /** Matches: the edit window also shows the match's streaming links and the team / competition logos. */
  detailPanel?: boolean;
  /** Refuse to create a row (or change it to one) whose `field` points to a row of `table` that is switched off (enabled = false). */
  blockIfOff?: { field: string; table: string; what: string };
  columns?: { key: string; items: { value: string; label: string; tone: "live" | "upcoming" | "finished"; empty: string }[] };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface Props {
  sb: SupabaseClient;
  config: EntityConfig;
  refs: Record<string, Opt[]>;
  onChanged: () => void;
}

const blank = (fields: Field[]): Row => Object.fromEntries(fields.map((f) => [f.key, f.defaultValue !== undefined ? f.defaultValue : f.type === "checkbox" ? true : f.type === "select" && f.options ? f.options[0].value : ""]));

export default function EntityAdmin({ sb, config, refs, onChanged }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null); // original row (or {} for new)
  const [form, setForm] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  // For lists split by a status (Matches): which status button is selected. null = first one.
  const [filter, setFilter] = useState<string | null>(null);
  // Matches: only this sport (id from the Sports tab). null = all sports.
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  // The search box above the list.
  const [query, setQuery] = useState("");
  const refsRef = useRef(refs);
  refsRef.current = refs;
  // Matches: rows ticked for "Delete selected".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Options created via quick-add, merged on top of the parent-supplied refs.
  const [extraRefs, setExtraRefs] = useState<Record<string, Opt[]>>({});
  const [quickAddKey, setQuickAddKey] = useState<string | null>(null);
  const [quickAddForm, setQuickAddForm] = useState<Row>({});
  const [quickAddErr, setQuickAddErr] = useState("");
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb.from(config.table).select("*").order(config.orderBy, { ascending: config.orderBy === "name" || config.orderBy === "sort_order" });
    if (error) setMsg({ ok: false, text: error.message });
    let list: Row[] = data ?? [];

    // Matches: save "ended" for matches past their auto-end time, and delete for good the ones that ended 3+ hours ago.
    if (config.autoEnd && list.length) {
      const r = refsRef.current;
      const now = Date.now();
      const toDelete: Row[] = [];
      const toEnd: { row: Row; at: number }[] = [];
      for (const row of list) {
        if (row.status === "FINISHED") {
          const t = Date.parse(String(row.finished_at ?? row.updated_at ?? ""));
          if (!Number.isNaN(t) && now - t >= FINISHED_KEEP_MS) toDelete.push(row);
          continue;
        }
        const sport = r.sports?.find((o) => o.value === row.sport_id)?.label ?? "";
        const comp = r.competitions?.find((o) => o.value === row.competition_id)?.label ?? "";
        const end = autoEndAtMs(row, sport, comp, String(row.title ?? ""));
        if (end === null || now < end) continue;
        if (now >= end + FINISHED_KEEP_MS) toDelete.push(row);
        else toEnd.push({ row, at: end });
      }
      try {
        for (let i = 0; i < toDelete.length; i += 40) {
          const chunk = toDelete.slice(i, i + 40);
          const { error: delErr } = await sb.from(config.table).delete().in("id", chunk.map((x) => x.id));
          if (!delErr) {
            const gone = new Set(chunk.map((x) => x.id));
            list = list.filter((x) => !gone.has(x.id));
            for (const x of chunk) for (const f of config.fields) if (f.type === "image") await removeIfUnreferenced(sb, x[f.key]);
          }
        }
        for (const { row, at } of toEnd) {
          const first = await sb.from(config.table).update({ status: "FINISHED", finished_at: new Date(at).toISOString() }).eq("id", row.id);
          // the finished_at column only exists after supabase/auto-delete-finished.sql was run
          if (first.error) await sb.from(config.table).update({ status: "FINISHED" }).eq("id", row.id);
          row.status = "FINISHED";
        }
      } catch {
        /* the list is still shown correctly; the clean-up simply runs again on the next load */
      }
    }

    setRows(list);
    setLoading(false);
  }, [sb, config.table, config.orderBy, config.autoEnd, config.fields]);

  useEffect(() => {
    setEditing(null);
    setForm(null);
    setMsg(null);
    void load();
  }, [load]);

  const imageFields = config.fields.filter((f) => f.type === "image");

  const startNew = () => { setEditing({}); setForm(blank(config.fields)); setMsg(null); };
  const startEdit = (r: Row) => {
    setEditing(r);
    setForm(Object.fromEntries(config.fields.map((f) => [f.key, r[f.key] ?? (f.type === "checkbox" ? false : "")])));
    setMsg(null);
  };

  /** Drop images uploaded during this edit that were never saved. */
  const cancel = async () => {
    if (form && editing) for (const f of imageFields) if (form[f.key] && form[f.key] !== editing[f.key]) await removeIfUnreferenced(sb, form[f.key]);
    setEditing(null); setForm(null); setQuickAddKey(null);
  };

  const setImage = async (f: Field, path: string | null) => {
    if (!form || !editing) return;
    const prev = form[f.key];
    setForm({ ...form, [f.key]: path ?? "" });
    if (prev && prev !== editing[f.key]) await removeIfUnreferenced(sb, prev); // unsaved intermediate upload
  };

  const validateFields = (fields: Field[], values: Row): string | null => {
    for (const f of fields) {
      const v = values[f.key];
      if (f.required && !String(v ?? "").trim()) return `${f.label} is required.`;
      if (f.type === "url" && v && !isValidStreamUrl(String(v))) return `${f.label} must be a valid http(s) URL.`;
    }
    return null;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !editing) return;
    const err = validateFields(config.fields, form);
    if (err) return setMsg({ ok: false, text: err });

    for (const f of config.fields) {
      if (f.type !== "url" || !f.detectMismatchWith) continue;
      const url = String(form[f.key] ?? "").trim();
      const declared = form[f.detectMismatchWith];
      const detected = url ? detectFromUrl(url) : null;
      if (detected && declared && detected !== declared) {
        const sibling = config.fields.find((x) => x.key === f.detectMismatchWith);
        const ok = window.confirm(
          `This URL looks like ${detected.toUpperCase()}, but ${sibling?.label ?? "the type"} is set to ${String(declared).toUpperCase()}. Save anyway? (The type you choose is what's used for playback.)`,
        );
        if (!ok) return;
      }
    }

    const payload: Row = {};
    for (const f of config.fields) {
      const v = form[f.key];
      payload[f.key] = f.type === "checkbox" ? Boolean(v) : f.type === "number" ? (v === "" ? 0 : Number(v)) : typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
    }
    const isNew = !editing.id;
    // A competition that is switched off gets no new matches (the same rule the JSON import and the hourly cron follow).
    const guard = config.blockIfOff;
    if (guard && form[guard.field] && (isNew || form[guard.field] !== editing[guard.field])) {
      const { data: target } = await sb.from(guard.table).select("name,enabled").eq("id", form[guard.field]).maybeSingle();
      if (target && target.enabled === false) {
        return setMsg({ ok: false, text: `The ${guard.what} “${target.name}” is switched OFF, so no match can be created for it. Turn it ON in the ${guard.table === "competitions" ? "Competitions" : "list"} tab first, or choose another ${guard.what}.` });
      }
    }
    setSaving(true);
    const { error } = isNew ? await sb.from(config.table).insert(payload) : await sb.from(config.table).update(payload).eq("id", editing.id);
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });

    // Old images are removed only when replaced and no longer referenced.
    if (!isNew) for (const f of imageFields) if (editing[f.key] && editing[f.key] !== payload[f.key]) await removeIfUnreferenced(sb, editing[f.key]);

    setEditing(null); setForm(null);
    if (config.columns && payload[config.columns.key]) setFilter(String(payload[config.columns.key]));
    setMsg({ ok: true, text: isNew ? "Created." : "Saved." });
    await load();
    onChanged();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete “${config.label(r)}”? This cannot be undone.`)) return;
    const { error } = await sb.from(config.table).delete().eq("id", r.id);
    if (error) return setMsg({ ok: false, text: error.message.includes("violates foreign key") ? "This item is still used by a match. Remove or change those matches first." : error.message });
    for (const f of imageFields) await removeIfUnreferenced(sb, r[f.key]);
    setMsg({ ok: true, text: "Deleted." });
    await load();
    onChanged();
  };

  /* ---------- quick-add: create a row in a referenced table without leaving this form ---------- */

  const openQuickAdd = (f: Field) => {
    setQuickAddKey(f.key);
    setQuickAddErr("");
    setQuickAddForm(blank(f.quickAdd!.fields));
  };
  const closeQuickAdd = async (fields: Field[]) => {
    for (const qf of fields) if (qf.type === "image" && quickAddForm[qf.key]) await removeIfUnreferenced(sb, quickAddForm[qf.key]);
    setQuickAddKey(null);
  };
  const saveQuickAdd = async (f: Field) => {
    const qa = f.quickAdd!;
    const err = validateFields(qa.fields, quickAddForm);
    if (err) return setQuickAddErr(err);
    const payload: Row = {};
    for (const qf of qa.fields) {
      const v = quickAddForm[qf.key];
      payload[qf.key] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
    }
    if (qa.inheritSportFrom && form?.[qa.inheritSportFrom]) payload.sport_id = form[qa.inheritSportFrom];
    setQuickAddSaving(true);
    const { data, error } = await sb.from(qa.table).insert(payload).select().single();
    setQuickAddSaving(false);
    if (error) return setQuickAddErr(error.message);

    const label = data.name ?? data.title ?? "New item";
    setExtraRefs((prev) => ({ ...prev, [f.ref!]: [...(prev[f.ref!] ?? []), { value: data.id, label }] }));
    setForm((prevForm) => (prevForm ? { ...prevForm, [f.key]: data.id } : prevForm));
    setQuickAddKey(null);
    onChanged(); // refresh the shared refs in the background too
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** Deletes every ticked row for good (the public website stops showing them straight away). */
  const removeSelected = async () => {
    const targets = rows.filter((r) => selected.has(String(r.id)));
    if (!targets.length) return;
    if (!window.confirm(`Delete ${targets.length} ${config.title.toLowerCase()} permanently? This cannot be undone.`)) return;
    setMsg(null);
    for (let i = 0; i < targets.length; i += 40) {
      const ids = targets.slice(i, i + 40).map((r) => r.id);
      const { error } = await sb.from(config.table).delete().in("id", ids);
      if (error) {
        setMsg({ ok: false, text: error.message });
        await load();
        return;
      }
    }
    for (const r of targets) for (const f of imageFields) await removeIfUnreferenced(sb, r[f.key]);
    setSelected(new Set());
    setMsg({ ok: true, text: `Deleted ${targets.length}.` });
    await load();
    onChanged();
  };

  const toggleRow = async (r: Row) => {
    const t = config.rowToggle;
    if (!t) return;
    const { error } = await sb.from(config.table).update({ [t.key]: !r[t.key] }).eq("id", r.id);
    if (error) return setMsg({ ok: false, text: error.message.includes(t.key) ? `The “${t.key}” column is missing in the database. Run supabase/add-hot-and-channel-matches.sql in the Supabase SQL editor first.` : error.message });
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, [t.key]: !r[t.key] } : x)));
  };

  const renderRow = (r: Row) => {
    const img = config.imageKey ? imageUrl(r[config.imageKey]) : null;
    return (
      <li key={r.id} className={r.enabled === false ? "off" : ""}>
        {config.columns && (
          <input
            type="checkbox"
            className="row-check"
            checked={selected.has(String(r.id))}
            onChange={() => toggleSelected(String(r.id))}
            aria-label={`Select ${config.label(r)}`}
          />
        )}
        {config.imageKey && (img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="thumb" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          : <span className="thumb" aria-hidden="true" />)}
        <div className="grow">
          <strong>{config.label(r)}</strong>
          {config.columns && (activeValue === "ALL" || searching) && (
            <span className={`row-status row-status-${statusOfRow(r).toLowerCase()}`}>{statusOfRow(r) === "FINISHED" ? "Ended" : statusOfRow(r) === "LIVE" ? "Live" : "Upcoming"}</span>
          )}
          {config.sub && <small>{config.sub(r)}</small>}
        </div>
        <div className="row-actions">
          {config.rowToggle && (
            <button className={`btn btn-sm ${r[config.rowToggle.key] ? "btn-hot-on" : ""}`} onClick={() => void toggleRow(r)}>
              {r[config.rowToggle.key] ? config.rowToggle.off : config.rowToggle.on}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => startEdit(r)}>Edit</button>
          <button className="btn btn-sm btn-danger" onClick={() => void remove(r)}>Delete</button>
        </div>
      </li>
    );
  };

  /** Status buttons (Matches): only the selected status is listed. Live/Upcoming soonest first, Ended newest first. */
  const stamp = (r: Row) => `${r.match_date ?? "9999-12-31"}T${String(r.match_time ?? "23:59").slice(0, 5)}`;
  const statusOfRow = (r: Row): string => {
    const raw = String(r[config.columns!.key] ?? "");
    if (!config.autoEnd || raw === "FINISHED") return raw;
    const sport = refs.sports?.find((o) => o.value === r.sport_id)?.label ?? "";
    const competition = refs.competitions?.find((o) => o.value === r.competition_id)?.label ?? "";
    if (isAutoEnded(r, sport, competition, String(r.title ?? ""))) return "FINISHED";
    return isAutoLive(r) ? "LIVE" : raw; // same rule as the website: Upcoming becomes Live when its time arrives
  };
  type FilterItem = { value: string; label: string; tone: string; empty: string };
  const filters: FilterItem[] | undefined = config.columns
    ? [...config.columns.items, { value: "ALL", label: "All", tone: "all", empty: "No matches here yet." }]
    : undefined;
  const activeValue = filters ? (filter && filters.some((f) => f.value === filter) ? filter : filters[0].value) : null;
  const inSport = (r: Row) => !sportFilter || r.sport_id === sportFilter;
  // Search: every word typed must appear somewhere in the title, teams, competition, sport, stadium, date…
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const refLabel = (key: string, id: unknown) => refs[key]?.find((o) => o.value === id)?.label ?? "";
  const haystack = (r: Row) =>
    [config.label(r), config.sub?.(r), r.title, r.name, r.slug, r.stadium, r.round, r.broadcaster, r.match_date, refLabel("sports", r.sport_id), refLabel("competitions", r.competition_id), refLabel("teams", r.team1_id), refLabel("teams", r.team2_id)]
      .filter(Boolean).join(" ").toLowerCase();
  const matchesQuery = (r: Row) => { const h = haystack(r); return words.every((w) => h.includes(w)); };
  const countOf = (value: string) => rows.filter((r) => inSport(r) && (value === "ALL" || statusOfRow(r) === value)).length;
  const RANK: Record<string, number> = { LIVE: 0, UPCOMING: 1, FINISHED: 2 };
  const visibleRows = filters && activeValue
    ? rows
        .filter((r) => (searching ? matchesQuery(r) : inSport(r) && (activeValue === "ALL" || statusOfRow(r) === activeValue)))
        .sort((x, y) => {
          if (activeValue === "ALL" || searching) {
            const d = (RANK[statusOfRow(x)] ?? 3) - (RANK[statusOfRow(y)] ?? 3);
            if (d) return d;
            return statusOfRow(x) === "FINISHED" ? stamp(y).localeCompare(stamp(x)) : stamp(x).localeCompare(stamp(y));
          }
          return filters.find((f) => f.value === activeValue)?.tone === "finished" ? stamp(y).localeCompare(stamp(x)) : stamp(x).localeCompare(stamp(y));
        })
    : rows.filter((r) => !searching || matchesQuery(r));
  // How many live + upcoming matches each sport has (the numbers on the sport buttons).
  const sportCount = (id: string | null) => rows.filter((r) => (id === null || r.sport_id === id) && statusOfRow(r) !== "FINISHED").length;
  const activeFilter = filters?.find((f) => f.value === activeValue);

  const formEl = form && editing ? (
        <form className="form card" onSubmit={save}>
          <h2>{editing.id ? "Edit" : "New"} {config.title.toLowerCase().replace(/s$/, "")}</h2>
          {config.fields.map((f) => {
            const baseOpts = f.ref ? refs[f.ref] ?? [] : [];
            // Once the background refs refresh lands, the quick-added row will
            // also appear in `refs` — drop the local copy then to avoid duplicates.
            const extra = f.ref ? (extraRefs[f.ref] ?? []).filter((e) => !baseOpts.some((b) => b.value === e.value)) : [];
            const opts = f.ref ? [...baseOpts, ...extra] : f.options ?? [];
            if (f.type === "image")
              return <ImageUpload key={f.key} sb={sb} label={f.label} folder={f.folder ?? "misc"} maxMB={f.maxMB} aspect={f.aspect} round={f.round} value={form[f.key] || null} onChange={(p) => void setImage(f, p)} />;
            if (f.type === "checkbox")
              return <label key={f.key} className="check"><input type="checkbox" checked={Boolean(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} /> {f.label}</label>;
            if (f.type === "select")
              return (
                <div key={f.key} className="field-with-add">
                  <label>{f.label}
                    <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.required}>
                      {!f.required && <option value="">None</option>}
                      {f.required && !f.options && <option value="" disabled>Select…</option>}
                      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}{o.off ? " (OFF)" : ""}</option>)}
                    </select>
                  </label>
                  {f.quickAdd && (
                    <button type="button" className="btn btn-sm quick-add-btn" onClick={() => openQuickAdd(f)} title={`Add a new ${f.quickAdd.title.toLowerCase()}`}>
                      + New {f.quickAdd.title}
                    </button>
                  )}
                  {f.quickAdd && quickAddKey === f.key && (
                    <div className="quick-add card">
                      {/* Not a <form>: it lives inside the outer match form, and nested <form> elements are invalid HTML. */}
                      <div className="form">
                        <strong>New {f.quickAdd.title.toLowerCase()}</strong>
                        {f.quickAdd.fields.map((qf) =>
                          qf.type === "image" ? (
                            <ImageUpload key={qf.key} sb={sb} label={qf.label} folder={qf.folder ?? "misc"} maxMB={qf.maxMB} aspect={qf.aspect} round={qf.round} value={quickAddForm[qf.key] || null} onChange={(p) => setQuickAddForm({ ...quickAddForm, [qf.key]: p ?? "" })} />
                          ) : (
                            <label key={qf.key}>{qf.label}
                              <input value={quickAddForm[qf.key] ?? ""} onChange={(e) => setQuickAddForm({ ...quickAddForm, [qf.key]: e.target.value })} required={qf.required} maxLength={qf.maxLength ?? 60} />
                            </label>
                          ),
                        )}
                        {quickAddErr && <p className="form-error">{quickAddErr}</p>}
                        <div className="row-btns">
                          <button className="btn btn-primary btn-sm" type="button" disabled={quickAddSaving} onClick={() => void saveQuickAdd(f)}>{quickAddSaving ? "Saving…" : "Add"}</button>
                          <button className="btn btn-sm" type="button" onClick={() => void closeQuickAdd(f.quickAdd!.fields)}>Cancel</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            if (f.type === "textarea")
              return (
                <label key={f.key}>{f.label}
                  <textarea rows={f.rows ?? 4} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} maxLength={f.maxLength ?? 4000} />
                </label>
              );
            return (
              <label key={f.key}>{f.label}
                <input
                  type={f.type === "url" ? "url" : f.type}
                  value={form[f.key] ?? ""}
                  onChange={(e) => {
                    // A stream URL box also takes a whole <iframe ...> embed code (YouTube etc.): only its src is kept,
                    // and an embed link needs no HLS/DASH type, so the type is set to HLS for it.
                    if (f.type === "url" && f.detectMismatchWith) {
                      const url = cleanStreamUrlInput(e.target.value);
                      setForm({ ...form, [f.key]: url, ...(iframeEmbedUrl(url) ? { [f.detectMismatchWith]: "hls" } : {}) });
                      return;
                    }
                    setForm({ ...form, [f.key]: e.target.value });
                  }}
                  required={f.required}
                  maxLength={f.type === "url" ? 4096 : (f.maxLength ?? 120)}
                  placeholder={f.placeholder}
                />
              </label>
            );
          })}
          {config.detailPanel && (
            <MatchDetailsPanel
              sb={sb}
              matchId={editing.id ?? null}
              team1Id={String(form.team1_id ?? "")}
              team2Id={String(form.team2_id ?? "")}
              competitionId={String(form.competition_id ?? "")}
              onTeamReplaced={(side, newId) => setForm((prev) => (prev ? { ...prev, [side]: newId } : prev))}
            />
          )}
          <div className="row-btns">
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn" type="button" onClick={() => void cancel()}>Cancel</button>
          </div>
        </form>
  ) : null;

  return (
    <div className="admin-layout admin-single">
      <div>
        <div className="section-head">
          <h2>{config.title}</h2>
          <button className="btn btn-primary btn-sm" onClick={startNew}>Add new</button>
        </div>
        <div className="admin-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(new Set()); }}
            placeholder={`Search ${config.title.toLowerCase()}…`}
            aria-label={`Search ${config.title.toLowerCase()}`}
          />
          {query && <button type="button" className="admin-search-clear" onClick={() => { setQuery(""); setSelected(new Set()); }} aria-label="Clear search">✕</button>}
        </div>
        {searching && !loading && <p className="muted admin-search-note">{visibleRows.length} found{config.columns ? ", from all sports and statuses" : ""}.</p>}
        {config.sportFilter && (refs.sports?.length ?? 0) > 0 && (
          <div className="sport-filter" role="group" aria-label="Filter by sport">
            <button type="button" className={`sport-btn ${sportFilter === null ? "active" : ""}`} onClick={() => { setSportFilter(null); setSelected(new Set()); }}>
              All sports <span className="status-count">{sportCount(null)}</span>
            </button>
            {refs.sports.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`sport-btn ${sportFilter === o.value ? "active" : ""}`}
                onClick={() => { setSportFilter(o.value); setFilter("ALL"); setSelected(new Set()); }}
              >
                {o.label} <span className="status-count">{sportCount(o.value)}</span>
              </button>
            ))}
          </div>
        )}
        {filters && (
          <div className="status-filter" role="tablist" aria-label={`${config.title} by status`}>
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={activeValue === f.value}
                className={`status-btn status-${f.tone} ${activeValue === f.value ? "active" : ""}`}
                onClick={() => { setFilter(f.value); setSelected(new Set()); }}
              >
                {f.tone === "live" && <span className="status-live-dot" aria-hidden="true" />}
                {f.label}
                <span className="status-count">{countOf(f.value)}</span>
              </button>
            ))}
          </div>
        )}
        {filters && !loading && visibleRows.length > 0 && (
          <div className="bulk-bar">
            <label className="bulk-all">
              <input
                type="checkbox"
                checked={visibleRows.every((r) => selected.has(String(r.id)))}
                onChange={(e) => setSelected(e.target.checked ? new Set(visibleRows.map((r) => String(r.id))) : new Set())}
              />
              Select all ({visibleRows.length})
            </label>
            {activeFilter?.tone !== "finished" && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelected(new Set(visibleRows.filter((r) => r.match_date && matchStartMs(r.match_date, r.match_time, "00:00") < Date.now()).map((r) => String(r.id))))}
              >
                Select past-time matches
              </button>
            )}
            <button type="button" className="btn btn-sm btn-danger" disabled={selected.size === 0} onClick={() => void removeSelected()}>
              Delete selected ({selected.size})
            </button>
          </div>
        )}
        {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
        {loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">Nothing here yet.</p> : visibleRows.length === 0 ? (
          <p className="status-empty">{activeFilter?.empty ?? "Nothing here yet."}</p>
        ) : (
          <ul className="admin-list">
            {visibleRows.map(renderRow)}
          </ul>
        )}
      </div>

      {formEl && (
        <FormModal label={`${editing?.id ? "Edit" : "New"} ${config.title.toLowerCase().replace(/s$/, "")}`} onClose={() => void cancel()}>
          {formEl}
        </FormModal>
      )}
    </div>
  );
}
