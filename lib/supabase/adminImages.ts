import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET } from "../env";

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Every column that stores a Storage path. Used to avoid deleting shared images. */
const IMAGE_COLUMNS: [string, string][] = [
  ["teams", "logo_url"],
  ["competitions", "logo_url"],
  ["sports", "image_url"],
  ["channels", "logo_url"],
  ["matches", "banner_url"],
  ["blog_posts", "cover_url"],
];

export function validateImage(file: File, maxMB: number): string | null {
  if (!IMAGE_TYPES[file.type]) return "Only PNG, JPG or WEBP images are allowed.";
  if (file.size > maxMB * 1024 * 1024) return `Image is too large. The limit is ${maxMB} MB.`;
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";

/** Uploads to Storage and returns the path to save in the database. */
export async function uploadImage(sb: SupabaseClient, folder: string, file: File): Promise<string> {
  const path = `${folder}/${Date.now()}-${slug(file.name)}.${IMAGE_TYPES[file.type]}`;
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Deletes a Storage file only if no database row still references it. */
export async function removeIfUnreferenced(sb: SupabaseClient, path: string | null | undefined): Promise<void> {
  if (!path || /^https?:\/\//i.test(path)) return;
  for (const [table, column] of IMAGE_COLUMNS) {
    const { count, error } = await sb.from(table).select("id", { count: "exact", head: true }).eq(column, path);
    if (error || (count ?? 0) > 0) return; // when unsure, keep the file
  }
  await sb.storage.from(IMAGE_BUCKET).remove([path]);
}
