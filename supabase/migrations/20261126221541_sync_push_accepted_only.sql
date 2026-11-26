-- sync_push must return only the writes it actually accepted.
--
-- It used to return the winning rev for every record sent, including ones that
-- lost. The client took a returned row as "accepted", dropped its pending
-- write and never pulled the winner back — a silent data loss. A missing row
-- now means "lost", so the client reconciles and can report a conflict.

create or replace function public.sync_push(p_records jsonb)
returns table (kind text, record_id text, rev bigint)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_record_id text;
  v_payload jsonb;
  v_updated_at bigint;
  v_device_id text;
  v_deleted boolean;
  v_rev bigint;
begin
  if v_user is null then
    raise exception 'sync_push requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'sync_push expects a JSON array of records'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_records) > 500 then
    raise exception 'sync_push accepts at most 500 records per call'
      using errcode = '22023';
  end if;

  for v_kind, v_record_id, v_payload, v_updated_at, v_device_id, v_deleted in
    select distinct on (x.kind, x.record_id)
      x.kind,
      x.record_id,
      coalesce(x.payload, '{}'::jsonb),
      x.updated_at,
      x.device_id,
      coalesce(x.deleted, false)
    from jsonb_to_recordset(p_records) as x (
      kind text,
      record_id text,
      payload jsonb,
      updated_at bigint,
      device_id text,
      deleted boolean
    )
    where x.kind in ('favorite', 'playlist', 'playlist_track', 'album', 'history', 'setting')
      and x.record_id is not null
      and x.updated_at is not null
      and x.device_id is not null
    order by
      x.kind,
      x.record_id,
      x.updated_at desc,
      x.device_id desc,
      coalesce(x.deleted, false) desc
  loop
    v_rev := null;
    v_updated_at := greatest(0, least(v_updated_at,
      (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000));

    insert into public.sync_records as s
      (user_id, kind, record_id, payload, updated_at, device_id, deleted, rev)
    values
      (v_user, v_kind, v_record_id, v_payload, v_updated_at, v_device_id, v_deleted,
       nextval('public.sync_rev_seq'))
    on conflict (user_id, kind, record_id) do update
      set payload = excluded.payload,
          updated_at = excluded.updated_at,
          device_id = excluded.device_id,
          deleted = excluded.deleted,
          rev = nextval('public.sync_rev_seq'),
          updated_server_at = now()
      where (excluded.updated_at, excluded.device_id, excluded.deleted)
          > (s.updated_at, s.device_id, s.deleted)
    returning s.kind, s.record_id, s.rev
    into v_kind, v_record_id, v_rev;

    if v_rev is not null then
      kind := v_kind;
      record_id := v_record_id;
      rev := v_rev;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.sync_push(jsonb) is
  'Applies a batch of client sync records with the last-writer-wins comparator, clamps future client clocks and returns only accepted writes; missing rows lost to a newer copy.';

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated, service_role;
