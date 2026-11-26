-- Viby account sync: server-side record store.
--
-- Security model: at-rest encryption on the server only. The backend can read
-- users' libraries; there is no end-to-end encryption here and none should be
-- claimed anywhere.
--
-- The JSON stores on the device stay authoritative. This table is a mirror that
-- lets a second device converge on the same favourites, playlists, albums,
-- history and whitelisted settings.

create sequence public.sync_rev_seq;

create table public.sync_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('favorite', 'playlist', 'album', 'history', 'setting')),
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null,
  device_id text not null,
  deleted boolean not null default false,
  rev bigint not null default nextval('public.sync_rev_seq'),
  updated_server_at timestamptz not null default now(),
  primary key (user_id, kind, record_id)
);

comment on table public.sync_records is
  'Cross-device sync mirror. One row per (user, kind, record id). rev is the pull cursor.';

comment on column public.sync_records.updated_at is
  'Client clock, epoch milliseconds. Wins ties by device_id, then tombstones.';

-- Pull path: `where user_id = auth.uid() and rev > cursor order by rev limit 500`.
create index sync_records_pull_idx on public.sync_records (user_id, rev);

alter table public.sync_records enable row level security;

create policy sync_records_select_own on public.sync_records
  for select to authenticated
  using (auth.uid() = user_id);

create policy sync_records_insert_own on public.sync_records
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy sync_records_update_own on public.sync_records
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy sync_records_delete_own on public.sync_records
  for delete to authenticated
  using (auth.uid() = user_id);

-- Supabase grants broad table privileges in public by default; narrow them so
-- only signed-in users (and service_role, for maintenance) can reach the table.
-- RLS is what actually scopes rows; these grants remove the anonymous surface.
revoke all on table public.sync_records from anon;
grant select, insert, update, delete on table public.sync_records to authenticated;
grant usage, select on sequence public.sync_rev_seq to authenticated;
grant all on table public.sync_records to service_role;
grant usage, select on sequence public.sync_rev_seq to service_role;

-- sync_push: apply a client batch, return the winning rev for every record the
-- client sent. The client stores the returned revs as its pull cursor so it
-- does not have to fetch its own writes back.
--
-- Merge rule, identical on both sides: higher updated_at wins; an equal
-- updated_at is broken by device_id (higher wins); an exact tie is won by the
-- tombstone. Written as a row comparison: (false, true) sorts below (true), so
-- deleted = true beats deleted = false; text device_id compares by collation.
--
-- security invoker + RLS: a caller can only ever write their own rows, even if
-- they tamper with the request. user_id is taken from auth.uid(), never from
-- the payload.
create function public.sync_push(p_records jsonb)
returns table (kind text, record_id text, rev bigint)
language plpgsql
security invoker
set search_path = ''
as $$
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

  -- Batches are 100 in normal use; the ceiling only guards against abuse.
  if jsonb_array_length(p_records) > 500 then
    raise exception 'sync_push accepts at most 500 records per call'
      using errcode = '22023';
  end if;

  -- Unknown kinds are skipped rather than failing the batch, so an older client
  -- cannot wedge sync for a newer one. Duplicate (kind, record_id) pairs inside
  -- one batch are collapsed to the winning row, because ON CONFLICT cannot touch
  -- the same row twice in a single statement.
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
    where x.kind in ('favorite', 'playlist', 'album', 'history', 'setting')
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

    -- The pushed row lost the comparison: report the row that won instead.
    -- kind and record_id are the loop's own values, so only rev changes.
    if v_rev is null then
      select s.rev
      into v_rev
      from public.sync_records s
      where s.user_id = v_user
        and s.kind = v_kind
        and s.record_id = v_record_id;
    end if;

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
  'Applies a batch of client sync records with the last-writer-wins comparator and returns the winning rev per record.';

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated, service_role;
