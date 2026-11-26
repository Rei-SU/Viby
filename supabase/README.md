# Supabase backend for Viby accounts

This directory is the whole server side of the optional account and sync
feature: the database migration, the local CLI configuration and one edge
function. It was applied and deployed to project `pnemhyszhbgmhnaudpze` on
2026-11-25/26 through the Supabase MCP (`sync_records` and its `sync_push`
ambiguity fix, `delete-account` v1, `send-email` and `auth-open`). The remaining
manual steps — auth redirect URLs, the Send Email hook and Resend secrets — are
sections 4–5 below.

**Security model.** Records are encrypted at rest by Supabase, and that is all.
The backend can read a user's library. There is no end-to-end encryption in
Viby, and no document, comment or UI copy should say there is.

The JSON stores on the device remain authoritative; this backend is a mirror
that lets a second device converge on the same data. With no account signed in,
the app makes no Supabase call at all.

## What is here

| Path | Purpose |
| --- | --- |
| `config.toml` | Local CLI config: API, DB, auth redirects, edge runtime, telemetry off |
| `migrations/20261125052234_sync_records.sql` | `sync_records` table, pull index, RLS, `sync_push` RPC |
| `migrations/20261126220939_playlist_items_clock_clamp.sql` | Per-entry playlist records, backfill, future-clock clamp |
| `migrations/20261126221541_sync_push_accepted_only.sql` | Returns only accepted writes so losing edits are reconciled, not dropped |
| `migrations/20261126231617_prune_sync_tombstones.sql` | `prune_sync_tombstones()` for 90-day server cleanup |
| `functions/delete-account/index.ts` | Verifies the caller's JWT, deletes the auth user with the service role |
| `functions/send-email/index.ts` | Auth Send Email hook: verifies Supabase's signature and sends through Resend |
| `functions/auth-open/index.ts` | HTTPS landing page that hands the verified code to `viby://auth/callback` |
| `.gitignore` | Keeps CLI scratch state and local `.env` files out of git |

## Data model

One row per `(user_id, kind, record_id)`:

- `kind` is one of `favorite`, `playlist`, `playlist_track`, `album`, `history`,
  `setting`;
- `record_id` is the track id, playlist id, `playlistId:trackId` for one
  playlist entry, release id, `trackId + ':' + playedAt` for history, or the
  setting key (`audioQuality`, `shuffle`, `repeat`, `autoplay`,
  `discordPresence` only);
- `payload` is the record body as JSON. A `playlist` row is metadata only
  (`id`, `name`, `createdAt`, `updatedAt`); each `playlist_track` carries
  `{ playlistId, track, position }`, so adding or removing one song never
  replaces the whole playlist on other devices. Positions are integers today;
  drag-reorder will upgrade them to fractional keys.
- `updated_at` is the client clock in epoch milliseconds (clamped to server time
  plus five minutes), `device_id` is the pushing device, `deleted` marks a
  tombstone (kept 90 days);
- `rev` comes from `sync_rev_seq` and is the pull cursor: clients ask for
  `rev > cursor order by rev asc limit 500`.

Merge rule, enforced identically in the client and in `sync_push`: higher
`updated_at` wins; an equal `updated_at` is broken by the higher `device_id`;
an exact tie is won by the tombstone. `sync_push` takes a JSON array (100 per
batch in normal use, 500 hard ceiling), assigns a fresh `rev` to every row it
actually changes, and returns `(kind, record_id, rev)` **only for the writes it
accepted**. A record missing from the response lost to a newer copy; the client
pulls the winner back and reports the replaced edit as a conflict instead of
silently dropping it.

Never synced: downloads, cache, session, stream URLs, lyrics.

## Manual setup, in order

Run these from the repository root. They are not automated and are not part of
`npm run` or CI.

### 1. Restore or create the project

Restore the existing Viby Supabase project from its backup if one exists;
otherwise create a fresh project in the dashboard. Note the project ref (the
subdomain in `https://<ref>.supabase.co`). Keep the database password in a
password manager — it is not needed by the app.

### 2. Link the CLI

```sh
supabase login
supabase link --project-ref <ref>
```

`supabase link` asks for the database password. It writes link state to
`supabase/.temp/`, which is gitignored.

### 3. Apply the migration

Already applied to the hosted project on 2026-11-25; the steps here are for a
fresh project or a restore. It is a manual step; neither the app nor this
repository applies it.

```sh
supabase migration list      # confirms 20261125052234_sync_records is pending
supabase db push             # applies it to the linked project
```

What this creates: `public.sync_rev_seq`, `public.sync_records`, the
`sync_records_pull_idx` index, four RLS policies scoped to `auth.uid()`, and
`public.sync_push(jsonb)`. It is safe to run on an empty project and it does
not touch auth users. Sign-in itself works without the migration; sync does
not.

If you prefer the SQL editor, paste the migration file and run it once.

### 4. Auth redirect URL

Dashboard → Authentication → URL Configuration:

- **Site URL**: the project URL (`https://<ref>.supabase.co`), or
  `http://127.0.0.1:54321` when testing against the local stack. It is only used
  when a request carries no `redirect_to`.
- **Additional Redirect URLs**: add exactly

  ```
  viby://auth/callback
  ```

The app uses PKCE. Magic-link and recovery emails carry `redirect_to` pointing
at that custom scheme, the OS hands the URL to the main process, and the code
is exchanged there — the renderer never sees a token. If the scheme is missing
from this list, Supabase refuses the redirect and the link silently fails.

For local development, `supabase start` serves the same setting from
`config.toml`; the hosted project still needs the entry added by hand.

### 5. Email templates

The built-in SMTP service is deliberately tiny: while **Confirm email** is on it
sends only a couple of messages per hour for the whole project, then returns
`429 over_email_send_rate_limit`. That limit is not adjustable in the project;
connect custom SMTP (section 7), enable the Send Email hook below, or turn
**Confirm email** off for local sync testing (no mail is sent and the hourly
email cap does not apply).

#### Send Email hook with Resend

`send-email` is already deployed with `verify_jwt: false` (the hook signature is
the authentication). Finish the wiring in the dashboard:

1. Create a Resend account and API key. For quick testing, `onboarding@resend.dev`
   can send to the Resend account's own address; for real users, verify a domain
   and set `RESEND_FROM` to an address on it.
2. Project Settings → Edge Functions → Secrets: add `RESEND_API_KEY` and,
   optionally, `RESEND_FROM` (for example `Viby <hello@yourdomain>`).
3. Authentication → Hooks → **Send Email**: create the secret, set the URL to
   `https://pnemhyszhbgmhnaudpze.supabase.co/functions/v1/send-email`, paste the
   same secret into the function environment as `SEND_EMAIL_HOOK_SECRET`
   (the dashboard shows it as `v1,whsec_…`), and enable the hook.
4. Authentication → Rate Limits: raise the email limit now that a hook handles
   delivery.
5. Authentication → URL Configuration: optional for the code flow. If you also
   use Supabase-generated links, add
   `https://pnemhyszhbgmhnaudpze.supabase.co/functions/v1/auth-open` (the HTTPS
   landing page) and keep `viby://auth/callback` as well.

The hook replaces the inbuilt SMTP sender entirely, so the project-wide
couple-per-hour cap no longer applies. The test-address guard still rejects
addresses that look like test accounts.

**Emails carry a 6-digit code, not a link.** The app verifies it with
`verifyOtp` and moves straight to the signed-in state, so there is no browser
hand-off and no blank page. `auth-open` is still deployed as a fallback landing
page for Supabase-generated links (for example if the hook is disabled); add
`https://pnemhyszhbgmhnaudpze.supabase.co/functions/v1/auth-open` to the redirect
allowlist if you use those links. The code flow itself needs no redirect URL.

Dashboard → Authentication → Email Templates:

- keep `{{ .ConfirmationURL }}` in the sign-up confirmation, magic link and
  recovery templates — replacing it with a hand-built URL drops `redirect_to`
  and breaks the `viby://` hand-off;
- keep **Confirm email** on so sign-up lands in `pending-verification` until the
  address is clicked through;
- magic link and recovery links are single-use and short-lived by default
  (one hour). Raise the OTP expiry only if you also accept the wider window;
- corporate mail scanners sometimes pre-fetch links and burn the one-time code.
  That is a mail-path problem, not a server one: the user just requests another
  link;
- with the local stack, mail is captured by Inbucket at
  `http://127.0.0.1:54324` and nothing leaves the machine.

### 6. Deploy the edge function

Already deployed as `delete-account` version 1 with `verify_jwt: true` on
2026-11-25. To redeploy after a change:

```sh
supabase functions deploy delete-account
```

Deploying needs Docker only for `supabase start`, not for deploy. JWT
verification stays on (`verify_jwt = true` in `config.toml`); the function also
calls `auth.getUser()` on the caller's token before doing anything. It deletes
the auth user with the service role, and `sync_records` follows through the
`on delete cascade` foreign key.

### 7. Environment and secrets

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
  injected into the function runtime by Supabase. There is usually nothing to
  set; do not copy them anywhere else.
- The app needs the project URL and the **publishable / anon** key only. Those
  are public by design and belong in the app's own configuration, not in a
  committed `.env`.
- The **service-role key must never appear in this repository**, in the
  renderer, in a log line, or in a bug report. It exists in the function
  environment only. Do not run `supabase db push` with `--debug` against a
  project whose credentials you would not paste into a ticket.
- No telemetry is configured anywhere in this backend.

### 8. Verify by hand

1. With two test users signed in to two clients, push the same `favorite` from
   both with different `updated_at` and confirm the later one survives.
2. `select count(*) from public.sync_records` as anon returns zero rows (RLS),
   and returns only that user's rows when run with a user JWT.
3. Call `sync_push` with a known batch and confirm the returned revs match the
   rows, then a pull with `rev > <max returned>` returns nothing new.
4. `POST` the delete-account function with no `Authorization` header → `401`;
   with a valid token → `{ "deleted": true }`, and the user's `sync_records`
   rows are gone.

## Optional housekeeping

Tombstones are meant to live 90 days. The client drops its own on that schedule;
the server exposes `prune_sync_tombstones()` for the same window. It is
`service_role` only, so run it by hand or schedule it with pg_cron:

```sql
select public.prune_sync_tombstones();
-- or, once pg_cron is enabled:
select cron.schedule('viby-prune-tombstones', '15 4 * * *', 'select public.prune_sync_tombstones()');
```

History is capped at 5,000 entries per device in the app. The server stores
what it is given and does not enforce that cap, so a client that ignores it can
store more. A play the local cap evicts is not turned into a tombstone: it
stays on the server and on devices that have not hit the cap.

## Known gaps

- The live end-to-end smoke test (inbox delivery, deep links, two devices,
  password reset, delete-account) has not been run yet; the auth redirect URL,
  the Send Email hook and its Resend secrets in sections 4–5 still need to be set
  in the dashboard.
- A single install still shares one local library across accounts (client-side
  isolation is a separate refactor). `playlist_track.position` is an integer
  until drag-reorder ships.
- Local `supabase start` was not run while authoring this; `config.toml` covers
  what the CLI needs for this project but omits unrelated defaults.
- No server-side history cap and no automatic tombstone pruning (above).
- Delete-account is the only function; anything else that needs the service
  role would need its own function and its own review.
