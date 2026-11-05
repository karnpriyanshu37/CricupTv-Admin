"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Message to viewers": a note (with an optional button) that appears in the middle of the playing screen of everybody who
 * is watching, in real time, and can be closed with a cross. Sending a new message replaces the one that is on now.
 */
interface Announcement {
  id: string;
  message: string;
  button_label: string | null;
  button_url: string | null;
  active: boolean;
  created_at: string;
  close_after_seconds?: number | null;
}
type Msg = { ok: boolean; text: string } | null;

const MAX_MESSAGE = 500;
const MAX_CLOSE_AFTER = 300;
const NEEDS_SQL = " (run supabase/announcement-close-delay.sql in the Supabase SQL editor first)";

export default function AnnouncementsAdmin({ sb }: { sb: SupabaseClient }) {
  const [message, setMessage] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  // seconds after which the cross shows up on the viewer's screen (typed as text so the field can be emptied while typing)
  const [closeAfter, setCloseAfter] = useState("2");
  const [rows, setRows] = useState<Announcement[]>([]);
  const [whatsappUrl, setWhatsappUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(20);
    if (error) return setMsg({ ok: false, text: `${error.message} (run supabase/announcements.sql in the Supabase SQL editor first)` });
    setRows((data ?? []) as Announcement[]);
  }, [sb]);

  useEffect(() => {
    void load();
    void sb.from("site_settings").select("value").eq("key", "whatsapp_channel_url").maybeSingle().then(({ data }: { data: { value?: string | null } | null }) => {
      setWhatsappUrl((data?.value ?? "").trim());
    });
  }, [sb, load]);

  const live = rows.find((r) => r.active) ?? null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    const label = buttonLabel.trim();
    const url = buttonUrl.trim();
    if (!text) return setMsg({ ok: false, text: "Write the message first." });
    if (url && !/^https:\/\//i.test(url)) return setMsg({ ok: false, text: "The button link must start with https://" });
    if (url && !label) return setMsg({ ok: false, text: "Write the text of the button (for example: Join WhatsApp)." });
    if (label && !url) return setMsg({ ok: false, text: "Paste the link the button should open, or clear the button text." });

    const secs = Number(closeAfter.trim() === "" ? "2" : closeAfter);
    if (!Number.isInteger(secs) || secs < 0 || secs > MAX_CLOSE_AFTER) {
      return setMsg({ ok: false, text: `"Show the cross after" must be a whole number of seconds from 0 to ${MAX_CLOSE_AFTER}.` });
    }

    setBusy(true);
    setMsg(null);
    const { data, error } = await sb.from("announcements")
      .insert({ message: text, button_label: label || null, button_url: url || null, active: true, close_after_seconds: secs })
      .select("id").single();
    if (error || !data) {
      setBusy(false);
      const missingColumn = /close_after_seconds/i.test(error?.message ?? "");
      return setMsg({ ok: false, text: `${error?.message ?? "Could not send."}${missingColumn ? NEEDS_SQL : ""}` });
    }
    // Only one message is on at a time: switch every older one off.
    const { error: offError } = await sb.from("announcements").update({ active: false }).eq("active", true).neq("id", data.id);
    setBusy(false);
    if (offError) return setMsg({ ok: false, text: `Sent, but an older message could not be switched off: ${offError.message}` });
    setMsg({ ok: true, text: "Sent. Everybody who is watching sees it now." });
    setMessage(""); setButtonLabel(""); setButtonUrl("");
    void load();
  };

  const hide = async (id: string) => {
    setBusy(true);
    const { error } = await sb.from("announcements").update({ active: false }).eq("id", id);
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Hidden. It disappears from every screen." });
    void load();
  };

  const showAgain = async (id: string) => {
    setBusy(true);
    const { error } = await sb.from("announcements").update({ active: true, created_at: new Date().toISOString() }).eq("id", id);
    if (!error) await sb.from("announcements").update({ active: false }).eq("active", true).neq("id", id);
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Sent again." });
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this message?")) return;
    setBusy(true);
    const { error } = await sb.from("announcements").delete().eq("id", id);
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Deleted." });
    void load();
  };

  const link = buttonUrl.trim();
  const preview = message.trim();

  return (
    <div className="admin-layout">
      <section className="card">
        <div className="section-head">
          <h2>Message to viewers</h2>
        </div>
        <p className="muted">
          The message appears in the middle of the playing screen of everybody who is watching, at once. They can close it with the cross.
          A new message replaces the one that is on now.
        </p>
        {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}

        <form className="form" onSubmit={send}>
          <label>
            Message
            <textarea rows={4} value={message} maxLength={MAX_MESSAGE} onChange={(e) => setMessage(e.target.value)} placeholder="Example: Join our WhatsApp channel for live match updates!" />
          </label>
          <small className="muted">{message.length} / {MAX_MESSAGE}</small>

          <label>
            Button text (optional)
            <input value={buttonLabel} maxLength={40} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Join WhatsApp" />
          </label>
          <label>
            Button link (optional)
            <input type="url" value={buttonUrl} maxLength={2048} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://whatsapp.com/channel/..." />
          </label>
          {whatsappUrl && (
            <div className="row-btns">
              <button type="button" className="btn btn-sm" onClick={() => { setButtonUrl(whatsappUrl); if (!buttonLabel.trim()) setButtonLabel("Join WhatsApp"); }}>
                Use my WhatsApp channel link
              </button>
            </div>
          )}

          {preview && (
            <div className="announce-preview" aria-label="Preview">
              <small className="muted">What viewers will see:</small>
              <div className="announce-preview-card">
                <span className="announce-preview-x" aria-hidden="true">×</span>
                <p>{preview}</p>
                {link && buttonLabel.trim() && <span className="announce-preview-btn">{buttonLabel.trim()}</span>}
              </div>
            </div>
          )}

          <label>
            Show the cross (close button) after (seconds)
            <input type="number" inputMode="numeric" min={0} max={MAX_CLOSE_AFTER} step={1} value={closeAfter} onChange={(e) => setCloseAfter(e.target.value)} placeholder="2" />
          </label>
          <small className="muted">
            The viewer can only close the message this many seconds after it appears. 0 = the cross is there at once. Example: 10 = the message
            stays at least 10 seconds.
          </small>

          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send to all viewers"}</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2>On screen now</h2>
        </div>
        {live ? (
          <div className="announce-row">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{live.message}</p>
            <small className="muted">Cross appears after {live.close_after_seconds ?? 2} s{live.button_url ? ` · button “${live.button_label}” → ${live.button_url}` : ""}</small>
            <div className="row-btns">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void hide(live.id)}>Hide for everyone</button>
            </div>
          </div>
        ) : <p className="muted">No message is on screen.</p>}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2>Earlier messages</h2>
        </div>
        {rows.filter((r) => !r.active).length === 0 ? <p className="muted">Nothing yet.</p> : (
          <div className="announce-list">
            {rows.filter((r) => !r.active).map((r) => (
              <div key={r.id} className="announce-row">
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.message}</p>
                <small className="muted">{new Date(r.created_at).toLocaleString()} · cross after {r.close_after_seconds ?? 2} s{r.button_url ? ` · button “${r.button_label}”` : ""}</small>
                <div className="row-btns">
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void showAgain(r.id)}>Send again</button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void remove(r.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
