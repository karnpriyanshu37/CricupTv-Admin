export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

/** Crops `src` to `crop` (in source-image pixels) and returns a File of the given type. */
export async function cropImageToFile(src: string, crop: PixelCrop, fileName: string, mimeType: string): Promise<File> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
  if (!blob) throw new Error("Could not process the cropped image.");
  return new File([blob], fileName, { type: mimeType });
}
