// Browser-side Supabase client for the admin area.
//
// This uses the PUBLISHABLE key, which is meant to be public — it grants
// nothing on its own. Every read and write is decided by the RLS policies in
// supabase/migrations/0002, evaluated against the signed-in user's JWT.
// The service role key must never appear in this file or anything it imports.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key);

export const supabase = configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'srd.admin.auth',
      },
    })
  : null;

/** The signed-in user's profile row, or null. Drives what the UI renders. */
export async function currentProfile() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;
  return data;
}
