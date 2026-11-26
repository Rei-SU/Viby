// delete-account: erase the caller's account and, by cascade, their synced
// library.
//
// Security:
//   - the caller is identified from their own JWT via auth.getUser(); no user
//     id is ever read from the request body;
//   - the service-role key is read from the function environment only, is used
//     for exactly one admin call, and is never returned, logged or echoed;
//   - sync_records.user_id references auth.users(id) on delete cascade, so
//     deleting the auth user removes every synced record.
//
// Deploy with `supabase functions deploy delete-account` (verify_jwt is on in
// config.toml). Nothing here is deployed by the repository.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405)
  }

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing-token' }, 401)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: 'function-not-configured' }, 500)
  }

  // Client bound to the caller's token: getUser() validates the JWT against this
  // project's auth server, so an anon key or a forged token cannot get through.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })

  const { data: userData, error: userError } = await asCaller.auth.getUser()
  const user = userData?.user

  if (userError || !user) {
    return json({ error: 'invalid-token' }, 401)
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

  if (deleteError) {
    console.error('delete-account failed', deleteError.message)
    return json({ error: 'delete-failed' }, 500)
  }

  // The user row is gone and sync_records cascaded with it. The caller's access
  // token is now unusable; the app drops its session on the response.
  return json({ deleted: true }, 200)
})
