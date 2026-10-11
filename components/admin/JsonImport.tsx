"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAnyFeed } from "@/lib/import/feedAdapters";
import { statusOf, streamUrl } from "@/lib/import/sportsJson";
import type { ParsedFeed } from "@/lib/import/sportsJson";
import { runFeedImport, type Report } from "@/lib/import/runImport";

export default function JsonImport({ sb, onChanged }: { sb: SupabaseClient; onChanged: () => void }) {
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ParsedFeed | null>(null);
  const [parseError, setParseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  const summary = useMemo(() => {
    if (!preview) return null;
    let live = 0, upcoming = 0, finished = 0, streams = 0;
    for (const m of preview.matches) {
      const s = statusOf(m.status);
      if (s === "LIVE") live++;
      else if (s === "UPCOMING") upcoming++;
      else finished++;
      streams += Array.isArray(m.streams) ? m.streams.filter((x) => !!streamUrl(x)).length : 0;
    }
    return { live, upcoming, finished, streams };
  }, [preview]);

  const parse = () => {
    try {
      const parsed = parseAnyFeed(json);
      setPreview(parsed);
      setParseError("");
      setReport(null);
    } catch (error) {
      setPreview(null);
      setParseError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  const importFeed = async () => {
    let parsed = preview;
    if (!parsed) {
      try { parsed = parseAnyFeed(json); setPreview(parsed); setParseError(""); }
      catch (error) { setParseError(error instanceof Error ? error.message : "Invalid JSON"); return; }
    }

    setBusy(true);
    setReport(null);
    setProgress("Loading existing data…");
    try {
      const result = await runFeedImport(sb, parsed, { onProgress: setProgress });
      setReport(result);
      if (result.ok) onChanged();
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>JSON Import</h2>
          <p className="muted">Paste your Live / Upcoming sports JSON or upload a .json file. If a match already exists, no second card is made: only its streaming links / channels are added or changed. The GitHub feed is also imported automatically every hour (see README).</p>
        </div>
      </div>

      <div className="json-import-card card">
        <div className="row-btns">
          <label className="btn btn-sm">
            Choose JSON file
            <input type="file" accept="application/json,.json,text/plain" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setJson(await file.text());
              setPreview(null);
              setReport(null);
              setParseError("");
            }} />
          </label>
          {fileName && <span className="muted">{fileName}</span>}
        </div>
        <textarea rows={20} value={json} onChange={(e) => { setJson(e.target.value); setPreview(null); setParseError(""); setReport(null); }} placeholder={'{\n  "name": "Live and Upcoming Sports Data",\n  "matches": [\n    ...\n  ]\n}'} />
        {parseError && <p className="form-error" role="alert">{parseError}</p>}
        <div className="row-btns">
          <button className="btn" type="button" disabled={!json.trim() || busy} onClick={parse}>Preview JSON</button>
          <button className="btn btn-primary" type="button" disabled={!json.trim() || busy} onClick={() => void importFeed()}>{busy ? "Importing…" : "Import matches"}</button>
        </div>
        {progress && <p className="muted" aria-live="polite">{progress}</p>}
      </div>

      {preview && summary && (
        <div className="card json-preview">
          <h3>Preview</h3>
          <div className="json-stat-grid">
            <div><strong>{preview.matches.length}</strong><span>Total matches</span></div>
            <div><strong>{summary.live}</strong><span>Live</span></div>
            <div><strong>{summary.upcoming}</strong><span>Upcoming</span></div>
            <div><strong>{summary.finished}</strong><span>Finished</span></div>
            <div><strong>{summary.streams}</strong><span>Streams</span></div>
          </div>
          <p className="muted">Live matches → Live cards · Upcoming → Upcoming cards · streams[] → Match Live Telecast + player slots.</p>
          <p className="muted">First two streams without an explicit player slot are assigned to Stream 1 and Stream 2. You can change those assignments later in Match Streams.</p>
        </div>
      )}

      {report && (
        <div className="card">
          <h3>{report.ok ? "Import complete" : "Import failed"}</h3>
          <p className={report.ok ? "form-ok" : "form-error"}>{report.text}</p>
          {report.ok && <p className="muted">Sports created: {report.createdSports} · Teams created: {report.createdTeams} · Competitions created: {report.createdCompetitions}.</p>}
          {report.warnings.length > 0 && (
            <details>
              <summary>{report.warnings.length} warning(s)</summary>
              <ul>{report.warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>What gets mapped automatically</h3>
        <p className="muted">Category → Sport · eventInfo.eventName → Competition · teamA/teamB + flags → Teams · eventInfo.startTime → Date/Time · stadium/round/broadcaster → Match Info · streams[] → all streaming sources.</p>
        <p className="muted">ClearKey is accepted from <code>drm</code>, <code>clearKeys</code>, or <code>kid + key</code>. Markdown-style links such as <code>[URL](URL)</code> are also accepted.</p>
        <p className="muted">Referer/User-Agent fields are preserved as imported metadata when present; browsers do not allow a webpage to arbitrarily spoof those protected request headers.</p>
      </div>
    </div>
  );
}

