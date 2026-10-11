"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadImage, validateImage } from "@/lib/supabase/adminImages";
import { imageUrl } from "@/lib/supabase/storage";
import ImageCropModal from "./ImageCropModal";

interface Props {
  sb: SupabaseClient;
  label: string;
  folder: string;
  value: string | null;
  maxMB?: number;
  onChange: (path: string | null) => void;
  /** width/height ratio for the crop box. Defaults to 1 (square), good for logos. */
  aspect?: number;
  /** Circular crop preview, for round logos. Defaults to true; set false for banners. */
  round?: boolean;
}

export default function ImageUpload({ sb, label, folder, value, maxMB = 2, onChange, aspect = 1, round = true }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ src: string; name: string; type: string } | null>(null);
  const preview = imageUrl(value);

  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.src); }, [pending]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validateImage(file, maxMB);
    if (problem) return setError(problem);
    setError("");
    setPending({ src: URL.createObjectURL(file), name: file.name, type: file.type });
  };

  const afterCrop = async (file: File) => {
    if (pending) URL.revokeObjectURL(pending.src);
    setPending(null);
    setBusy(true);
    try {
      onChange(await uploadImage(sb, folder, file));
    } catch (err) {
      setError(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const cancelCrop = () => {
    if (pending) URL.revokeObjectURL(pending.src);
    setPending(null);
  };

  return (
    <div className="upload">
      <span>{label}</span>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="upload-preview" src={preview} alt={`${label} preview`} referrerPolicy="no-referrer" />
      )}
      <div className="row-btns">
        <label className="btn btn-sm" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={busy} className="sr-only" />
        </label>
        {value && !busy && <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
      <small className="muted">PNG, JPG or WEBP, up to {maxMB} MB. You can crop it after choosing a file.</small>
      {error && <p className="form-error" role="alert">{error}</p>}

      {pending && (
        <ImageCropModal
          src={pending.src}
          fileName={pending.name}
          mimeType={pending.type}
          aspect={aspect}
          round={round}
          onCancel={cancelCrop}
          onCropped={(file) => void afterCrop(file)}
        />
      )}
    </div>
  );
}
