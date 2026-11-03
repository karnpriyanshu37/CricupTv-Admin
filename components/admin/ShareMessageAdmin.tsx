"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Share message": the text that viewers share with their friends when they tap "Share with friends" on the playing
 * screen and choose WhatsApp, Telegram, Messenger, Facebook, X, e-mail ... Write {link} where the website link should go
 * (if it is missing, the link is added at the end).
 */
const KEY = "share_message";
const DEFAULT_MESSAGE = "Watch all live cricket and sports matches free on Cricup TV 🏏\n{link}";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://your-website.com").replace(/\/+$/, "");

export default function ShareMessageAdmin({ sb }: { sb: SupabaseClient }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sb.from("site_settings").select("value").eq("key", KEY).maybeSingle().then(({ data, error }: { data: { value?: string | null } | null; error: { message: string } | null }) => {
      if (cancelled) return;
      if (error) setMsg({ ok: false, text: error.message });
      setText(data?.value ?? "");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [sb]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const value = text.trim();
    const { error } = await sb.from("site_settings").upsert({ key: KEY, value: value || null }, { onConflict: "key" });
    setSaving(false);
    setMsg(error
      ? { ok: false, text: `${error.message} (run supabase/share-message.sql in the Supabase SQL editor first)` }
      : { ok: true, text: "Saved. The Share button shows this message within about a minute." });
  };

  const base = text.trim() || DEFAULT_MESSAGE;
  const final = base.includes("{link}") ? base.split("{link}").join(SITE) : `${base}\n${SITE}`;

  return (
    <div className="admin-layout">
      <section className="card">
        <div className="section-head">
          <h2>Share message</h2>
        </div>
        <p className="muted">
          When a viewer taps <strong>Share with friends</strong> on the playing screen, a list of apps opens (WhatsApp, Messenger, Facebook,
          Telegram, X, e-mail, copy, and more). Whatever app they choose, this is the message that goes to their friends.
        </p>
        {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
        {loading ? <p className="muted">Loading…</p> : (
          <form className="form" onSubmit={save}>
            <label>
              Write the message here
              <textarea
                rows={6}
                value={text}
                maxLength={800}
                onChange={(e) => setText(e.target.value)}
                placeholder={DEFAULT_MESSAGE}
              />
            </label>
            <small className="muted">
              {text.length} / 800. Write <strong>{"{link}"}</strong> where your website link should go. If you do not write it, the link is added at the end.
              Leave the box empty to use the default message. Facebook, Messenger and X only take the link and a short text, so there the message may be shown shorter.
            </small>

            <div className="announce-preview" aria-label="Preview">
              <small className="muted">What a friend receives (for example on WhatsApp):</small>
              <div className="announce-preview-card" style={{ textAlign: "left" }}>
                <p>{final}</p>
              </div>
            </div>

            <div className="row-btns">
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save share message"}</button>
              <button className="btn" type="button" onClick={() => setText("")} disabled={saving}>Use default message</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
