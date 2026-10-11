"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { cropImageToFile, type PixelCrop } from "@/lib/image/crop";

interface Props {
  src: string;
  fileName: string;
  mimeType: string;
  /** width/height ratio, e.g. 1 for a square logo, 16/9 for a banner. */
  aspect: number;
  /** Circular crop preview (logos), vs. rectangular (banners). */
  round?: boolean;
  onCancel: () => void;
  onCropped: (file: File) => void;
}

export default function ImageCropModal({ src, fileName, mimeType, aspect, round, onCancel, onCropped }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  const confirm = async () => {
    if (!area) return;
    setBusy(true);
    setErr("");
    try {
      const px: PixelCrop = { x: area.x, y: area.y, width: area.width, height: area.height };
      const file = await cropImageToFile(src, px, fileName, mimeType);
      onCropped(file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not crop this image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="Crop image">
      <div className="crop-dialog">
        <div className="crop-stage">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={round ? "round" : "rect"}
            showGrid={!round}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="crop-controls">
          <label className="crop-zoom">
            Zoom
            <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          {err && <p className="form-error">{err}</p>}
          <div className="row-btns">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirm()} disabled={busy || !area}>
              {busy ? "Cropping…" : "Crop & use"}
            </button>
            <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
