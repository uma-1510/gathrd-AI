// lib/supabaseAdmin.js
import { createClient } from '@supabase/supabase-js';

// Lazily instantiated — created on first use, not at build time.
// This prevents "supabaseAdmin is not defined" during Vercel builds
// where SUPABASE_SERVICE_ROLE_KEY is not available as a build secret.
let _client = null;

function getSupabaseAdmin() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase admin env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}

export default getSupabaseAdmin;