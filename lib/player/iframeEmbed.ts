/**
 * Streams that must be played in the provider's own embed player (an iframe) instead of our HLS/DASH player.
 *
 * Rutube live links such as
 *   https://bl.rutube.ru/livestream/<id>/index.m3u8?s=...&e=...
 * only play inside Rutube's own player: their server does not allow other websites to load the manifest
 * (CORS), so the HLS player can never open them. They are recognised automatically from the URL and shown with
 * Rutube's official embed page: https://rutube.ru/play/embed/<id>
 */
const RUTUBE_ID = /([0-9a-f]{32})/i;

export function iframeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();

  // Rutube: bl.rutube.ru/livestream/<id>/..., rutube.ru/play/embed/<id>, rutube.ru/video/<id>/, rutube.ru/live/video/<id>/
  if (host === "rutube.ru" || host.endsWith(".rutube.ru")) {
    const m = u.pathname.match(/^\/(?:livestream|play\/embed|video(?:\/private)?|live\/video)\/([0-9a-f]{32})(?:\/|$)/i)
      ?? (host !== "rutube.ru" ? u.pathname.match(RUTUBE_ID) : null);
    if (m) return `https://rutube.ru/play/embed/${m[1].toLowerCase()}`;
  }
  return null;
}
