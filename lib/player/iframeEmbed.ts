/**
 * Streams that must be played in the provider's own embed player (an iframe) instead of our HLS/DASH player.
 *
 * Rutube live links such as
 *   https://bl.rutube.ru/livestream/<id>/index.m3u8?s=...&e=...
 * only play inside Rutube's own player: their server does not allow other websites to load the manifest
 * (CORS), so the HLS player can never open them. They are recognised automatically from the URL and shown with
 * Rutube's official embed page: https://rutube.ru/play/embed/<id>
 *
 * YouTube links (watch, youtu.be, live, shorts, embed, or a channel's /live page) are recognised the same way and
 * shown with YouTube's official embed player: https://www.youtube.com/embed/<id>
 */
const RUTUBE_ID = /([0-9a-f]{32})/i;
const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

// autoplay: start by itself (the browser may still ask for a tap), playsinline: stay in the page on iPhones,
// rel=0: only suggest videos of the same channel afterwards, modestbranding: smaller YouTube logo.
const YT_PARAMS = "autoplay=1&playsinline=1&rel=0&modestbranding=1";

function youtubeEmbed(host: string, u: URL): string | null {
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;

  if (host === "youtu.be") {
    id = parts[0] ?? null;
  } else if (parts[0] === "watch") {
    id = u.searchParams.get("v");
  } else if (parts[0] === "embed" && parts[1] === "live_stream") {
    const ch = u.searchParams.get("channel");
    return ch && YT_CHANNEL_ID.test(ch) ? `https://www.youtube.com/embed/live_stream?channel=${ch}&${YT_PARAMS}` : null;
  } else if (parts[0] === "channel" && parts[2] === "live" && YT_CHANNEL_ID.test(parts[1] ?? "")) {
    return `https://www.youtube.com/embed/live_stream?channel=${parts[1]}&${YT_PARAMS}`;
  } else if (parts[0] === "embed" || parts[0] === "live" || parts[0] === "shorts" || parts[0] === "v") {
    id = parts[1] ?? null;
  }

  return id && YT_VIDEO_ID.test(id) ? `https://www.youtube.com/embed/${id}?${YT_PARAMS}` : null;
}

export function iframeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");

  // YouTube: youtube.com/watch?v=<id>, youtu.be/<id>, youtube.com/live/<id>, youtube.com/embed/<id>, ...
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    return youtubeEmbed(host, u);
  }

  // Rutube: bl.rutube.ru/livestream/<id>/..., rutube.ru/play/embed/<id>, rutube.ru/video/<id>/, rutube.ru/live/video/<id>/
  const rawHost = u.hostname.toLowerCase();
  if (rawHost === "rutube.ru" || rawHost.endsWith(".rutube.ru")) {
    const m = u.pathname.match(/^\/(?:livestream|play\/embed|video(?:\/private)?|live\/video)\/([0-9a-f]{32})(?:\/|$)/i)
      ?? (rawHost !== "rutube.ru" ? u.pathname.match(RUTUBE_ID) : null);
    if (m) return `https://rutube.ru/play/embed/${m[1].toLowerCase()}`;
  }
  return null;
}
