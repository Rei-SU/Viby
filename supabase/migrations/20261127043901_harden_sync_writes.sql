-- Old clients still call sync_push(p_records). Only the validated function
-- may write. Hold an account-specific transaction lock before taking revisions
-- so a committed row cannot jump ahead of an in-flight revision for that user.
create schema if not exists viby_private;
revoke all on schema viby_private from public, anon, authenticated;
grant usage on schema viby_private to authenticated, service_role;

create function viby_private.sync_push(p_records jsonb)
returns table (kind text, record_id text, rev bigint, updated_at bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_ceiling bigint;
  v_row record;
begin
  if v_user is null then
    raise exception 'sync_push requires an authenticated user' using errcode = '42501';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'sync_push expects a JSON array of records' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 500 or octet_length(p_records::text) > 4194304 then
    raise exception 'sync_push batch is too large' using errcode = '22023';
  end if;
  -- New clients bind a queued batch to its account. The JWT is still the
  -- authority, including for older clients that omit this precondition.
  if exists (
    select 1 from jsonb_array_elements(p_records) as supplied(item)
    where item ? 'user_id' and item->>'user_id' is distinct from v_user::text
  ) then
    raise exception 'sync_push account does not match the signed-in user' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  v_ceiling := (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000;

  for v_row in
    select distinct on (x.kind, x.record_id)
      x.kind, x.record_id,
      case when x.deleted then '{}'::jsonb else coalesce(x.payload, '{}'::jsonb) end as payload,
      greatest(0, least(x.updated_at, v_ceiling)) as updated_at,
      x.device_id, coalesce(x.deleted, false) as deleted
    from jsonb_to_recordset(p_records) as x (
      kind text, record_id text, payload jsonb, updated_at bigint, device_id text, deleted boolean
    )
    where x.kind in ('favorite', 'playlist', 'playlist_track', 'album', 'history', 'setting')
      and char_length(x.record_id) between 1 and 512
      and char_length(x.device_id) between 1 and 128
      and x.updated_at is not null
      and (x.deleted is true or x.payload is null or (
        jsonb_typeof(x.payload) = 'object' and octet_length(x.payload::text) <= 65536
      ))
    order by x.kind, x.record_id, greatest(0, least(x.updated_at, v_ceiling)) desc,
      x.device_id desc, coalesce(x.deleted, false) desc
  loop
    return query
      insert into public.sync_records as s
        (user_id, kind, record_id, payload, updated_at, device_id, deleted, rev)
      values (v_user, v_row.kind, v_row.record_id, v_row.payload, v_row.updated_at,
        v_row.device_id, v_row.deleted, nextval('public.sync_rev_seq'))
      on conflict (user_id, kind, record_id) do update
        set payload = excluded.payload, updated_at = excluded.updated_at,
            device_id = excluded.device_id, deleted = excluded.deleted,
            rev = excluded.rev, updated_server_at = clock_timestamp()
        where (excluded.updated_at, excluded.device_id, excluded.deleted)
          > (s.updated_at, s.device_id, s.deleted)
      returning s.kind, s.record_id, s.rev, s.updated_at;
  end loop;
end;
$$;

revoke all on function viby_private.sync_push(jsonb) from public, anon, authenticated;
grant execute on function viby_private.sync_push(jsonb) to authenticated, service_role;

drop function public.sync_push(jsonb);
create function public.sync_push(p_records jsonb)
returns table (kind text, record_id text, rev bigint, updated_at bigint)
language sql
security invoker
set search_path = ''
as $$
  select * from viby_private.sync_push(p_records)
$$;
revoke all on function public.sync_push(jsonb) from public, anon, authenticated;
grant execute on function public.sync_push(jsonb) to authenticated, service_role;

revoke all on public.sync_records from public, anon, authenticated;
grant select on public.sync_records to authenticated;
revoke all on sequence public.sync_rev_seq from public, anon, authenticated;
drop policy sync_records_insert_own on public.sync_records;
drop policy sync_records_update_own on public.sync_records;
drop policy sync_records_delete_own on public.sync_records;
alter policy sync_records_select_own on public.sync_records using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
