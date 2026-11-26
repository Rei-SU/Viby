-- Server-side tombstone pruning. Safe to call repeatedly; only deletes rows
-- tombstoned more than 90 days ago. Execute is restricted to service_role, so
-- schedule it with pg_cron or run it manually from the dashboard.

create or replace function public.prune_sync_tombstones()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.sync_records
    where deleted
      and updated_server_at < now() - interval '90 days'
    returning 1
  )
  select count(*) from deleted
$$;

comment on function public.prune_sync_tombstones() is
  'Deletes tombstones older than 90 days. Run manually or schedule with pg_cron; execute is service_role only.';

revoke all on function public.prune_sync_tombstones() from public, anon, authenticated;
grant execute on function public.prune_sync_tombstones() to service_role;
