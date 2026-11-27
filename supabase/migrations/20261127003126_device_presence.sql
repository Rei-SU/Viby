-- Private Realtime channel for account device presence and hand-off commands.
--
-- Topic: account:<auth.uid()>:devices. Only the account's own devices may read
-- or send Presence and Broadcast messages on it; the payload never leaves the
-- account. Postgres Changes are not used, so no table publication is needed.
--
-- realtime.messages already has RLS enabled (and the schema is locked down);
-- adding ALTER TABLE here would abort the migration.

create policy "account devices can read presence and broadcast"
on "realtime"."messages"
for select
to authenticated
using (
  (select realtime.topic()) = 'account:' || (select auth.uid())::text || ':devices'
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "account devices can send presence and broadcast"
on "realtime"."messages"
for insert
to authenticated
with check (
  (select realtime.topic()) = 'account:' || (select auth.uid())::text || ':devices'
  and realtime.messages.extension in ('broadcast', 'presence')
);
