import { IMAGE_BUCKET, SUPABASE_URL } from "../env";

/** Turns a stored path ("teams/india.png") into a public Storage URL. */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  // Logos imported from a JSON feed are often http:// links. A https website (Vercel) blocks those as "mixed content",
  // so remote images are always requested over https.
  if (/^https?:\/\//i.test(path)) return path.replace(/^http:\/\//i, "https://");
  if (!SUPABASE_URL) return null;
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${clean}`;
}
