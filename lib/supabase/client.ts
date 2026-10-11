import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../env";

let browserClient: SupabaseClient | null = null;

/** Browser client. Uses the public anon key only; RLS decides what it can do. */
export function getBrowserClient(): SupabaseClient {
  if (!browserClient) browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // AdminApp performs controlled refreshes so a transient Auth 429 does not
      // immediately tear down an otherwise valid persisted session.
    },
  });
  return browserClient;
}
