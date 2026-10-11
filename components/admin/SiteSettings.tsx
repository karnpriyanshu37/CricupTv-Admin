"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export default function SiteSettings({ sb }: { sb: SupabaseClient }) {
  const [whatsappUrl, setWhatsappUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await sb.from("site_settings").select("value").eq("key", "whatsapp_channel_url").maybeSingle();
      if (cancelled) return;
      if (error) setMsg({ ok: false, text: error.message });
      setWhatsappUrl(data?.value ?? "");
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [sb]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = whatsappUrl.trim();
    if (value && !/^https:\/\//i.test(value)) {
      setMsg({ ok: false, text: "WhatsApp channel link must start with https://" });
      return;
    }
    setSaving(true);
    const { error } = await sb.from("site_settings").upsert({ key: "whatsapp_channel_url", value: value || null }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Settings saved." });
  };

  return (
    <div className="admin-layout">
      <section className="card">
        <div className="section-head">
          <h2>Website settings</h2>
        </div>
        {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
        {loading ? <p className="muted">Loading…</p> : (
          <form className="form" onSubmit={save}>
            <label>
              WhatsApp channel link
              <input
                type="url"
                value={whatsappUrl}
                onChange={(e) => setWhatsappUrl(e.target.value)}
                placeholder="https://whatsapp.com/channel/..."
                maxLength={2048}
              />
            </label>
            <small className="muted">This controls the Join Now button on the public watch page. Leave it empty to disable the link.</small>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
          </form>
        )}
      </section>
    </div>
  );
}
