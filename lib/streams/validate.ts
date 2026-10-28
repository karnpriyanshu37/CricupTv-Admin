import type { DrmConfig } from "../types";

/** Only plain http(s) URLs without embedded credentials are allowed. */
export function isValidStreamUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

const HEX32 = /^[0-9a-fA-F]{32}$/;

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, "").replace(/[\s-]/g, "").toLowerCase();
}

function normalizeClearKeys(input: unknown): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return { ok: true, value: {} };
    try {
      return normalizeClearKeys(JSON.parse(text));
    } catch {
      // Friendly shorthand: KID:KEY. Multiple pairs may be separated by newlines or commas.
      const pairs = text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
      const out: Record<string, string> = {};
      for (const pair of pairs) {
        const idx = pair.indexOf(":");
        if (idx <= 0) return { ok: false, error: "ClearKey shorthand must be KID:KEY (optionally one pair per line)." };
        const k = normalizeHex(pair.slice(0, idx));
        const v = normalizeHex(pair.slice(idx + 1));
        if (!HEX32.test(k) || !HEX32.test(v)) return { ok: false, error: "Each ClearKey KID and key must be 32 hexadecimal characters." };
        out[k] = v;
      }
      return { ok: true, value: out };
    }
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "ClearKey config must be an object or KID:KEY text." };
  const o = input as Record<string, unknown>;
  const source = o.clearKeys !== undefined ? o.clearKeys : o;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return { ok: false, error: "clearKeys must be an object." };
  const out: Record<string, string> = {};
  for (const [rawK, rawV] of Object.entries(source as Record<string, unknown>)) {
    if (rawK === "servers" || rawK === "clearKeys") continue;
    if (typeof rawV !== "string") return { ok: false, error: "ClearKey values must be strings." };
    const k = normalizeHex(rawK);
    const v = normalizeHex(rawV);
    if (!HEX32.test(k) || !HEX32.test(v)) return { ok: false, error: "Each ClearKey KID and key must be 32 hexadecimal characters." };
    out[k] = v;
  }
  return { ok: true, value: out };
}

/** Accepts the common JSON form plus the convenient KID:KEY shorthand. */
export function parseDrm(input: unknown): { ok: true; value: DrmConfig | null } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, value: null };
  let obj: unknown = input;
  if (typeof input === "string") {
    try { obj = JSON.parse(input); }
    catch {
      const shorthand = normalizeClearKeys(input);
      if (!shorthand.ok) return shorthand;
      return shorthand.value && Object.keys(shorthand.value).length ? { ok: true, value: { clearKeys: shorthand.value } } : { ok: true, value: null };
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { ok: false, error: "DRM config must be a JSON object or KID:KEY text." };
  const o = obj as Record<string, unknown>;
  const out: DrmConfig = {};

  if (o.clearKeys !== undefined) {
    const ck = normalizeClearKeys(o.clearKeys);
    if (!ck.ok) return ck;
    if (Object.keys(ck.value).length) out.clearKeys = ck.value;
  } else {
    // Also accept a flat JSON map: { "KID": "KEY" }
    const hasLikelyPair = Object.entries(o).some(([k, v]) => HEX32.test(normalizeHex(k)) && typeof v === "string");
    if (hasLikelyPair) {
      const ck = normalizeClearKeys(o);
      if (!ck.ok) return ck;
      if (Object.keys(ck.value).length) out.clearKeys = ck.value;
    }
  }

  if (o.servers !== undefined) {
    if (typeof o.servers !== "object" || o.servers === null || Array.isArray(o.servers)) return { ok: false, error: "servers must be an object." };
    for (const [k, v] of Object.entries(o.servers as Record<string, unknown>)) {
      if (typeof v !== "string" || !isValidStreamUrl(v) || !/^[a-z0-9.\-]+$/i.test(k)) return { ok: false, error: "servers must map a key system name to an http(s) license URL." };
    }
    out.servers = o.servers as Record<string, string>;
  }

  return { ok: true, value: Object.keys(out).length ? out : null };
}

/**
 * What the admin may paste into a "Stream URL" box. Besides a plain link it accepts a whole embed code, e.g.
 *   <iframe width="560" height="315" src="https://www.youtube.com/embed/XXXX" ...></iframe>
 * and keeps only the address inside src="...". Anything else is returned untouched.
 */
export function cleanStreamUrlInput(value: string): string {
  if (!/<iframe/i.test(value)) return value;
  const m = value.match(/\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  let src = (m?.[1] ?? m?.[2] ?? "").trim().replace(/&amp;/gi, "&");
  if (src.startsWith("//")) src = `https:${src}`;
  return src || value;
}
