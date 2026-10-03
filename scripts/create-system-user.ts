import { createClient } from '@supabase/supabase-js';

/* One-off: create the auth user that owns every MCP booking.

   bookings.user_id must reference a profile, and MCP callers have no account,
   so all MCP bookings belong to this one user; the real customer is stored in
   booking_contacts. The existing handle_new_user trigger creates its profile.

   The user has no password, an address on the reserved .invalid TLD (so no
   magic link can ever be delivered), and is banned, so nobody can sign in as
   it and read the MCP bookings through own_bookings_select.

   Run once:  npm run create-system-user
   Then put the printed id in ORRBI_MCP_USER_ID.

   Never delete this user: bookings.user_id is ON DELETE CASCADE, so deleting
   it would delete every MCP booking. */

const EMAIL = (process.env.ORRBI_MCP_USER_EMAIL ?? 'mcp-system@orrbi.invalid').toLowerCase();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;

async function findExisting(): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findExisting();
if (existing) {
  console.log(`System user already exists.\nORRBI_MCP_USER_ID=${existing}`);
  process.exit(0);
}

const { data, error } = await admin.createUser({
  email: EMAIL,
  email_confirm: true,
  user_metadata: { full_name: 'Orrbi MCP' },
  ban_duration: '876000h'   // ~100 years: cannot sign in
});

if (error || !data.user) {
  console.error('Could not create the system user:', error?.message);
  process.exit(1);
}

console.log(`Created system user ${EMAIL}.\nORRBI_MCP_USER_ID=${data.user.id}`);
