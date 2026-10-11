import type { StreamType } from "../types";

export type StreamTypeInput = { type?: string | null; url: string };

/** Metadata wins. The URL extension is only a fallback for "auto"/missing types. */
export function detectStreamType({ type, url }: StreamTypeInput): StreamType | null {
  const t = type?.toLowerCase();
  if (t === "hls" || t === "dash") return t;
  return detectFromUrl(url);
}

export function detectFromUrl(url: string): StreamType | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* fall through with raw string */
  }
  path = path.toLowerCase();
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  return null;
}
