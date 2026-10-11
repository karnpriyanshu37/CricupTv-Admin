export type StreamType = "hls" | "dash";
export type MatchStatus = "LIVE" | "UPCOMING" | "FINISHED";

/** DRM config supplied by the authorised stream owner. Kept out of the UI. */
export interface DrmConfig {
  /** { "KID hex": "KEY hex" } for ClearKey-protected streams */
  clearKeys?: Record<string, string>;
  /** { "com.widevine.alpha": "https://license.example/..." } */
  servers?: Record<string, string>;
}

export interface Stream {
  id: string;
  match_id: string;
  name: string;
  type: StreamType;
  url: string;
  quality: string | null;
  language: string | null;
  enabled: boolean;
  sort_order: number;
  player_slot?: 1 | 2 | null;
  drm?: DrmConfig | null;
}

/** Stream info that is safe to render on pages that do not play video. */
export type PublicStream = Pick<Stream, "id" | "match_id" | "name" | "type" | "quality" | "language">;

export interface Match {
  id: string;
  title: string;
  competition: string;
  competitionLogo: string | null;
  sport: string;
  sportSlug: string;
  team1: string;
  team1Short: string;
  team1Logo: string | null;
  team2: string;
  team2Short: string;
  team2Logo: string | null;
  status: MatchStatus;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  banner: string | null;
  stadium: string | null;
  round: string | null;
  broadcaster: string | null;
}

export interface Sport {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
}
