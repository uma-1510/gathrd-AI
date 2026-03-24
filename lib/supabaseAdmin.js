import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL missing");
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
export default supabaseAdmin;