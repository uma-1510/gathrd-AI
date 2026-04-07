import { createClient } from '@supabase/supabase-js';

let _client = null;

function getClient() {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _client;
}

const supabaseAdmin = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  }
});

export default supabaseAdmin;